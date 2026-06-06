# location_generator.py
# Generates D&D 5e locations — from Continents down to individual Buildings — via Claude.
#
# Features:
#   - Six location tiers: Continent, Country, Region/Province, City/Town, District/Quarter,
#     Building/Location. Each tier uses appropriate fields in the JSON output.
#   - Type-specific prompt sections: climate/culture for large-scale, government/economy for
#     settlements, building type/condition/owner for buildings.
#   - Parent/child hierarchy tracked in history entries (not in the Location model itself).
#   - Three detail levels (low/medium/high) scale description length accordingly.

from __future__ import annotations

import json
from models import Location, GenerateLocationRequest
from ai_client import call_claude

_SYSTEM_PROMPT = """You are a D&D 5e worldbuilder specialising in creating vivid, usable locations for tabletop RPGs. You produce structured content as JSON.

Rules:
- Locations should feel like real, living places with history and character
- Descriptions should be immediately useful at the table — sensory details, mood, colour
- Scale appropriately: a building needs intimate detail; a continent needs sweeping overview
- Secrets and plot hooks must be specific and immediately actionable, not generic
- NPC entries give name, role, and a one-sentence generation concept
- Return ONLY valid JSON — no prose, no markdown fences"""

_TIER_FIELDS = {
    "Continent":       {"climate": True,  "terrain": False, "population": False, "government": False, "economy": False, "dominant_culture": True,  "building_type": False, "condition": False, "owner": False},
    "Country":         {"climate": True,  "terrain": True,  "population": True,  "government": True,  "economy": True,  "dominant_culture": True,  "building_type": False, "condition": False, "owner": False},
    "Region/Province": {"climate": False, "terrain": True,  "population": False, "government": True,  "economy": True,  "dominant_culture": False, "building_type": False, "condition": False, "owner": False},
    "City/Town":       {"climate": False, "terrain": False, "population": True,  "government": True,  "economy": True,  "dominant_culture": False, "building_type": False, "condition": False, "owner": False},
    "District/Quarter":{"climate": False, "terrain": False, "population": False, "government": False, "economy": True,  "dominant_culture": False, "building_type": False, "condition": False, "owner": False},
    "Building/Location":{"climate": False,"terrain": False, "population": False, "government": False, "economy": False, "dominant_culture": False, "building_type": True,  "condition": True,  "owner": True},
}


def _detail_instructions(detail_level: str, location_type: str) -> str:
    focus = {
        "Continent":        "the continent's major geographic regions, dominant civilisations, climate zones, and defining history",
        "Country":          "the country's landscape, capital and major settlements, political structure, cultural identity, and current state of affairs",
        "Region/Province":  "the region's terrain, key settlements and landmarks, local governance, character of the people, and recent events",
        "City/Town":        "the settlement's layout, distinct districts, street-level atmosphere, the mix of people, and what makes it memorable",
        "District/Quarter": "the district's streets and alleys, dominant trades and activities, social character, and its sensory texture at different times of day",
        "Building/Location": "the building's exterior, approach, interior rooms and layout, atmosphere, the people found there, and how it fits into the neighbourhood",
    }.get(location_type, "the location's appearance, character, and feel")

    if detail_level == "low":
        return f"2–3 paragraphs covering {focus}"
    elif detail_level == "high":
        return (
            f"7–10 paragraphs thoroughly covering {focus}, "
            "notable history, current tensions or events, sensory atmosphere at different times, "
            "and how it relates to the wider world"
        )
    else:
        return (
            f"4–5 paragraphs covering {focus}, "
            "one interesting current event or tension, and how it feels to arrive there for the first time"
        )


def _build_prompt(req: GenerateLocationRequest) -> str:
    tier_fields = _TIER_FIELDS.get(req.location_type, _TIER_FIELDS["City/Town"])
    detail = _detail_instructions(req.detail_level, req.location_type)

    params = [f"- Location type: {req.location_type}"]
    if req.concept.strip():
        params.append(f"- Concept / theme: {req.concept}")
    if req.climate.strip() and tier_fields.get("climate"):
        params.append(f"- Climate: {req.climate}")
    if req.terrain.strip() and tier_fields.get("terrain"):
        params.append(f"- Terrain: {req.terrain}")
    if req.population_scale.strip() and tier_fields.get("population"):
        params.append(f"- Population scale: {req.population_scale}")
    if req.government_type.strip() and tier_fields.get("government"):
        params.append(f"- Government type: {req.government_type}")
    if req.building_type.strip() and tier_fields.get("building_type"):
        params.append(f"- Building type: {req.building_type}")
    if req.atmosphere_hint.strip():
        params.append(f"- Atmosphere / tone: {req.atmosphere_hint}")
    if req.additional_notes.strip():
        params.append(f"- Additional notes: {req.additional_notes}")
    params_block = "\n".join(params)

    # Build the JSON schema, only including type-specific fields that apply
    schema_lines = [
        '  "name": "string — the location\'s name",',
        f'  "location_type": "{req.location_type}",',
        f'  "description": "string — {detail}",',
        '  "atmosphere": "string — one evocative sentence capturing the immediate feel",',
        '  "history": "string — notable history in 1–3 paragraphs",',
    ]
    if tier_fields.get("climate"):
        schema_lines.append('  "climate": "string — climate description",')
    else:
        schema_lines.append('  "climate": null,')
    if tier_fields.get("terrain"):
        schema_lines.append('  "terrain": "string — dominant terrain",')
    else:
        schema_lines.append('  "terrain": null,')
    if tier_fields.get("population"):
        schema_lines.append('  "population": "string — e.g. \'~12,000 inhabitants\' or \'~3 million\'",')
    else:
        schema_lines.append('  "population": null,')
    if tier_fields.get("government"):
        schema_lines.append('  "government": "string — government type and key power holder",')
    else:
        schema_lines.append('  "government": null,')
    if tier_fields.get("economy"):
        schema_lines.append('  "economy": "string — main economic activities and wealth level",')
    else:
        schema_lines.append('  "economy": null,')
    if tier_fields.get("dominant_culture"):
        schema_lines.append('  "dominant_culture": "string — dominant races/cultures and their character",')
    else:
        schema_lines.append('  "dominant_culture": null,')
    if tier_fields.get("building_type"):
        schema_lines.append('  "building_type": "string — specific type e.g. Tavern, Temple, Blacksmith, Tower",')
    else:
        schema_lines.append('  "building_type": null,')
    if tier_fields.get("condition"):
        schema_lines.append('  "condition": "string — physical state e.g. well-maintained, run-down, ancient",')
    else:
        schema_lines.append('  "condition": null,')
    if tier_fields.get("owner"):
        schema_lines.append('  "owner": "string — who runs or owns this location",')
    else:
        schema_lines.append('  "owner": null,')

    npc_count = {"Continent": 2, "Country": 3, "Region/Province": 3, "City/Town": 4, "District/Quarter": 3, "Building/Location": 2}.get(req.location_type, 3)
    schema_lines += [
        '  "notable_features": ["string — 4–6 specific, usable features or landmarks"],',
        f'  "notable_npcs": [{{"name": "string", "role": "string", "concept": "string — one-sentence generation prompt"}}],  // {npc_count}–{npc_count + 1} NPCs',
        '  "secrets": ["string — 2–3 DM-only secrets, genuinely surprising"],',
        '  "plot_hooks": ["string — 3–4 specific adventure hooks"],',
        '  "factions": ["string — relevant power groups, factions, or organisations"]',
    ]

    schema = "{\n" + "\n".join(schema_lines) + "\n}"

    return f"""Generate a D&D 5e location with the following parameters:
{params_block}

Return a JSON object matching this schema. Every field is required (use null for fields marked null).

{schema}"""


async def generate_location(req: GenerateLocationRequest) -> tuple:
    raw, usage = await call_claude(_build_prompt(req), max_tokens=8192, system=_SYSTEM_PROMPT)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"Claude returned malformed JSON: {e}\n\nRaw output:\n{raw[:500]}")
    return Location(**data), usage
