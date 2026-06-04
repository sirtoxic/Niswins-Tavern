# item_generator.py
# Generates magic items and equipment for D&D 5e via Claude.
#
# Features:
#   - Configurable rarity (Common → Legendary), target level range, item type, and magic theme.
#   - Optional material flavour (e.g. Mithral, Obsidian), damage type, and stat bonus target so
#     Claude can produce thematically cohesive items.
#   - Attunement handling: "auto" lets Claude decide; "required" / "none" force the choice.
#   - Output includes mechanical bonuses (stat/attack bonuses), named abilities with activation
#     rules and usage limits, lore paragraph, weight, and GP value.
#   - Token and cost reporting returned with each generation.

from __future__ import annotations

import json
from models import Item, GenerateItemRequest
from ai_client import call_claude

RARITY_GUIDELINES: dict[str, str] = {
    "Common": (
        "No stat bonuses. Purely flavourful or cosmetic. May have one very minor "
        "convenience feature (keeps drinks cold, never gets dirty, always smells faintly of pine). "
        "bonuses array must be empty. abilities array must be empty."
    ),
    "Uncommon": (
        "A single +1 bonus to ONE relevant stat (attack rolls, AC, a specific ability check, "
        "or saving throws). No active magical abilities. bonuses array has exactly one entry. "
        "abilities array must be empty."
    ),
    "Rare": (
        "Either: (A) a +2 bonus to a single stat, OR (B) a +1 stat bonus PLUS exactly ONE "
        "magical ability (usable once per long rest, or a minor passive effect). "
        "Attunement may be required."
    ),
    "Epic": (
        "Either: (A) a +3 bonus to a single stat, OR (B) a +2 stat bonus PLUS exactly ONE "
        "significant magical ability (powerful effect, once per day or limited charges). "
        "Attunement very likely required. The ability should be impactful in combat or exploration."
    ),
    "Legendary": (
        "A +3 or +4 stat bonus AND exactly TWO distinct magical abilities. One of a kind — "
        "it has a name and a history. Attunement required. Both abilities should be powerful "
        "and flavourful with clear D&D 5e mechanics (save DCs, damage dice, etc.). "
        "This item should feel unique and storied."
    ),
}

_SYSTEM_PROMPT = """You are a D&D 5e magic item designer. You produce detailed, flavourful, mechanically sound magic items as structured JSON.

Rules:
- Follow the rarity guidelines strictly — especially for number of bonuses and abilities
- All bonuses must use realistic D&D 5e values: no single stat bonus above +4
- Abilities must have clear, gameable mechanics: save DCs (8 + prof + ability), damage dice, duration, charges
- Description: 2-3 sentences on appearance, material, sensory details
- Lore: 2-4 sentences of in-world history and origin
- Return ONLY valid JSON — no prose, no markdown fences"""


def _build_prompt(req: GenerateItemRequest) -> str:
    rarity_guide = RARITY_GUIDELINES.get(req.rarity, RARITY_GUIDELINES["Uncommon"])

    extras: list[str] = []
    if req.magic_theme.strip():
        extras.append(f"- Magic theme / element: {req.magic_theme} — lean into this throughout name, description, lore, and ability flavour")
    if req.material.strip():
        extras.append(f"- Primary material: {req.material} — use this in the description and name where appropriate")
    if req.stat_bonus_target.strip():
        extras.append(f"- Preferred stat for bonuses: {req.stat_bonus_target} — use this stat in the bonuses array unless it genuinely conflicts with the rarity rule")
    if req.damage_type.strip():
        extras.append(f"- Damage type (weapons): {req.damage_type} — attacks and ability damage should use this type")
    if req.attunement == "required":
        extras.append("- Attunement: REQUIRED — requires_attunement must be true")
    elif req.attunement == "none":
        extras.append("- Attunement: NOT required — requires_attunement must be false")
    if req.additional_notes.strip():
        extras.append(f"- Additional notes: {req.additional_notes}")

    extra_block = ("\n" + "\n".join(extras)) if extras else ""

    return f"""Design a D&D 5e magic item:
- Concept: {req.concept}
- Item type: {req.item_type}
- Rarity: {req.rarity}
- Target character level range: {req.target_level_min}–{req.target_level_max}
- Rarity rule: {rarity_guide}{extra_block}

Return a JSON object matching this exact schema. Every field is required.

{{
  "name": "string — evocative proper name for the item",
  "item_type": "{req.item_type}",
  "rarity": "{req.rarity}",
  "target_level_min": {req.target_level_min},
  "target_level_max": {req.target_level_max},
  "requires_attunement": bool,
  "attunement_by": "string (e.g. 'a spellcaster', 'a paladin or cleric'; empty string if not required)",
  "description": "string — 2-3 sentences: appearance, material, weight, sensory details",
  "lore": "string — 2-4 sentences of in-world origin and history",
  "bonuses": [
    {{"stat": "string (e.g. 'Attack Rolls', 'Armor Class', 'Strength Checks', 'Constitution Saving Throws', 'Spell Attack Rolls')", "value": int}}
  ],
  "abilities": [
    {{
      "name": "string",
      "description": "string — full mechanical description: save DC if any, damage if any, duration, range",
      "usage": "string (e.g. 'Passive', 'Once per day (recharge at dawn)', '3 charges (1 per use, recharges 1d3 at dawn)', 'At will')",
      "activation": "string (e.g. 'None', 'Bonus Action', 'Action', 'Reaction', 'Passive')"
    }}
  ],
  "weight_lbs": number or null,
  "value_gp": int or null
}}

Strictly follow the rarity rule above for how many bonuses and abilities to include."""


async def generate_item(req: GenerateItemRequest) -> tuple:
    raw, usage = await call_claude(_build_prompt(req), max_tokens=4000, system=_SYSTEM_PROMPT)

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"Claude returned malformed JSON: {e}")

    return Item(**data), usage
