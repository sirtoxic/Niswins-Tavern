# faction_generator.py
# Generates political factions for D&D 5e via Claude.
#
# Features:
#   - Faction generation: configurable type (Government, Guild, Rebel Group, Traveling Group,
#     Military Order, Criminal Syndicate, Religious Order, Secret Society, Merchant Company),
#     size (Tiny → Massive), alignment, wealth, public reputation, region, and free-text concept.
#   - Full output includes name, motto, overview, history, goals, methods, headquarters, secrets,
#     symbols, a named leader (with title, race, description), and 2–4 notable members.
#   - Allies and enemies lists for immediate plot hook use.
#   - Member generation: generate_faction_member() produces a new leader or notable member using
#     the faction's name, type, size, alignment, and overview as context, allowing Add / Regenerate
#     from the faction sheet without touching the rest of the faction.
#   - Token and cost reporting returned with each generation.

from __future__ import annotations

import json
from models import Faction, FactionLeader, FactionMember, GenerateFactionRequest
from ai_client import call_claude, get_low_token_mode, HAIKU_MODEL

_SYSTEM_PROMPT = """You are a D&D 5e worldbuilder specialising in creating rich, politically complex factions for tabletop RPGs. You produce detailed, immediately usable content as structured JSON.

Rules:
- Factions should feel grounded and real — they have history, internal politics, and rivalries
- Goals and methods should be specific enough to generate actual plot hooks
- Secrets should be genuinely surprising and immediately usable by a DM
- Notable members should each have a clear role and a hook that makes them memorable
- Return ONLY valid JSON — no prose, no markdown fences"""


def _build_prompt(req: GenerateFactionRequest) -> str:
    size_guide = {
        "Tiny":    "5–15 active members",
        "Small":   "15–50 active members",
        "Medium":  "50–200 active members",
        "Large":   "200–1,000 active members",
        "Massive": "1,000+ members, potentially a nation-spanning organisation",
    }.get(req.size, req.size)

    extras = []
    if req.concept.strip():
        extras.append(f"Concept / theme: {req.concept}")
    if req.region.strip():
        extras.append(f"Region / setting: {req.region}")
    if req.additional_notes.strip():
        extras.append(f"Additional notes: {req.additional_notes}")
    extra_block = ("\n" + "\n".join(extras)) if extras else ""

    return f"""Generate a D&D 5e faction with the following parameters:
- Type: {req.faction_type}
- Size: {req.size} ({size_guide})
- Alignment: {req.alignment}
- Wealth: {req.wealth}
- Public Reputation: {req.reputation}{extra_block}

Return a JSON object matching this exact schema. Every field is required.

{{
  "name": "string — the faction's name",
  "faction_type": "{req.faction_type}",
  "size": "{req.size}",
  "alignment": "{req.alignment}",
  "motto": "string — a short motto or slogan (may include a Latin phrase with translation)",
  "overview": "string — 2–3 paragraphs describing the faction, its purpose, and its place in the world",
  "history": "string — 1–2 paragraphs on founding, key events, and how it reached its current state",
  "goals": ["string", "string", "string"],
  "methods": ["string", "string", "string"],
  "headquarters": "string — where the faction is based or where leadership meets",
  "wealth": "{req.wealth}",
  "public_reputation": "string — one sentence on how common people and authorities perceive them",
  "secrets": ["string", "string"],
  "symbols": "string — sigil, colours, uniform markings, or other identifying signs",
  "leader": {{
    "name": "string — full name",
    "title": "string — official title or rank",
    "race": "string — D&D 5e race",
    "description": "string — 1–2 sentences on appearance and personality"
  }},
  "notable_members": [
    {{
      "name": "string",
      "role": "string — their function or rank in the faction",
      "description": "string — 1 sentence on what makes them notable or dangerous"
    }}
  ],
  "allies": ["string"],
  "enemies": ["string"]
}}

Generate 3–5 goals, 3–5 methods, 2–3 secrets, 2–4 notable members, 1–3 allies, and 1–3 enemies."""


async def generate_faction(req: GenerateFactionRequest) -> tuple:
    raw, usage = await call_claude(_build_prompt(req), max_tokens=4096, system=_SYSTEM_PROMPT)

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"Claude returned malformed JSON: {e}\n\nRaw output:\n{raw[:500]}")

    return Faction(**data), usage


async def generate_faction_member(faction: Faction, is_leader: bool = False) -> dict:
    """Generate a new leader or notable member for an existing faction. Returns raw dict."""
    overview_excerpt = faction.overview[:400] if faction.overview else ""

    if is_leader:
        schema = '{"name": "string", "title": "string — their rank or title", "race": "string — D&D 5e race", "description": "string — 1–2 sentences on appearance and personality"}'
        role_desc = "a new leader"
    else:
        schema = '{"name": "string", "role": "string — their function or rank in the faction", "description": "string — 1 sentence on what makes them notable or dangerous"}'
        role_desc = "a new notable member (not the leader)"

    prompt = f"""Generate {role_desc} for the following faction. The character must fit the faction's theme, alignment, and culture.

Faction: {faction.name}
Type: {faction.faction_type}
Size: {faction.size}
Alignment: {faction.alignment}
Overview: {overview_excerpt}

Return ONLY a JSON object matching this schema:
{schema}"""

    sub_model = HAIKU_MODEL if get_low_token_mode() else None
    raw, _ = await call_claude(prompt, max_tokens=512, model=sub_model)
    return json.loads(raw)
