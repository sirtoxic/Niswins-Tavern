# bestiary_generator.py
# Generates D&D 5e monster stat blocks via Claude.
#
# Features:
#   - Full monster stat block: all ability scores, AC, HP, speed, saving throws,
#     skills, damage vulnerabilities/resistances/immunities, senses, languages,
#     challenge rating, special traits, actions, bonus actions, reactions,
#     legendary actions, lair actions.
#   - Flavor content: description, ecology, tactics, lore.
#   - XP and proficiency bonus auto-calculated from CR using lookup dicts.
#   - Token and cost reporting returned with each generation.

from __future__ import annotations

import json
import os
import anthropic
from models import Monster, GenerateBestiaryRequest
from character_generator import _get_model_pricing, MODEL

_CR_XP = {
    "0": 10, "1/8": 25, "1/4": 50, "1/2": 100,
    "1": 200, "2": 450, "3": 700, "4": 1100,
    "5": 1800, "6": 2300, "7": 2900, "8": 3900,
    "9": 5000, "10": 5900, "11": 7200, "12": 8400,
    "13": 10000, "14": 11500, "15": 13000, "16": 15000,
    "17": 18000, "18": 20000, "19": 22000, "20": 25000,
    "21": 33000, "22": 41000, "23": 50000, "24": 62000,
}

_CR_PROF = {
    "0": 2, "1/8": 2, "1/4": 2, "1/2": 2,
    "1": 2, "2": 2, "3": 2, "4": 2,
    "5": 3, "6": 3, "7": 3, "8": 3,
    "9": 4, "10": 4, "11": 4, "12": 4,
    "13": 5, "14": 5, "15": 5, "16": 5,
    "17": 6, "18": 6, "19": 6, "20": 6,
    "21": 7, "22": 7, "23": 7, "24": 7,
    "25": 8, "26": 8, "27": 8, "28": 8,
    "29": 9, "30": 9,
}

_SYSTEM_PROMPT = """You are a D&D 5e monster designer. You create complete, balanced, immediately usable monster stat blocks for tabletop RPGs. You produce structured JSON that exactly matches the requested schema.

Rules:
- All ability scores must have both score and modifier (modifier = floor((score-10)/2))
- Hit points should be appropriate for the CR and size
- Actions should be written as full D&D 5e formatted text, e.g. "Bite. Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 10 (2d6 + 3) piercing damage."
- Saving throws dict: only include abilities the monster is proficient in; values are total bonus integers (ability modifier + proficiency bonus)
- Skills dict: only include skills the monster is proficient in; values are total bonus integers
- Special traits, legendary actions, and lair actions: only include if appropriate for this CR and type
- legendary_resistance_count: 0 for most monsters, 3 for legendary CR 17+ monsters
- Return ONLY valid JSON — no prose, no markdown fences"""


def _build_prompt(req: GenerateBestiaryRequest) -> str:
    xp = _CR_XP.get(req.cr, 200)
    prof = _CR_PROF.get(req.cr, 2)

    extras = []
    if req.concept.strip():
        extras.append(f"Concept / theme: {req.concept}")
    if req.environment.strip():
        extras.append(f"Environment / habitat: {req.environment}")
    if req.additional_notes.strip():
        extras.append(f"Additional notes: {req.additional_notes}")
    extra_block = ("\n" + "\n".join(extras)) if extras else ""

    return f"""Generate a D&D 5e monster with the following parameters:
- Type: {req.monster_type}
- Size: {req.size}
- Challenge Rating: {req.cr} (XP: {xp}, Proficiency Bonus: +{prof})
- Alignment: {req.alignment}{extra_block}

Return a JSON object matching this exact schema. Every required field must be present.

{{
  "name": "string — the monster's name",
  "size": "{req.size}",
  "monster_type": "{req.monster_type}",
  "subtype": "string — subtype in parentheses if applicable (e.g. 'shapechanger'), else empty string",
  "alignment": "{req.alignment}",
  "armor_class": integer,
  "armor_type": "string — e.g. 'natural armor', 'leather armor', 'unarmored' — describes what provides the AC",
  "hit_points": integer,
  "hit_dice": "string — e.g. '4d8+8' — the dice formula that averages to hit_points",
  "speed": {{
    "walk": integer,
    "fly": integer,
    "swim": integer,
    "burrow": integer,
    "climb": integer,
    "hover": boolean
  }},
  "ability_scores": {{
    "strength":     {{"score": integer, "modifier": integer}},
    "dexterity":    {{"score": integer, "modifier": integer}},
    "constitution": {{"score": integer, "modifier": integer}},
    "intelligence": {{"score": integer, "modifier": integer}},
    "wisdom":       {{"score": integer, "modifier": integer}},
    "charisma":     {{"score": integer, "modifier": integer}}
  }},
  "proficiency_bonus": {prof},
  "saving_throws": {{"ability_name": total_bonus_int}},
  "skills": {{"skill_name": total_bonus_int}},
  "damage_vulnerabilities": ["string"],
  "damage_resistances": ["string"],
  "damage_immunities": ["string"],
  "condition_immunities": ["string"],
  "senses": ["string — e.g. 'darkvision 60 ft.'"],
  "passive_perception": integer,
  "languages": ["string"],
  "challenge_rating": "{req.cr}",
  "xp": {xp},
  "special_traits": [
    {{"name": "string", "description": "string — full trait text"}}
  ],
  "actions": [
    {{"name": "string", "description": "string — full action text formatted as D&D 5e stat block"}}
  ],
  "bonus_actions": [
    {{"name": "string", "description": "string"}}
  ],
  "reactions": [
    {{"name": "string", "description": "string"}}
  ],
  "legendary_actions": [
    {{"name": "string", "cost": integer, "description": "string"}}
  ],
  "legendary_resistance_count": integer,
  "lair_actions": [
    {{"name": "string", "description": "string"}}
  ],
  "description": "string — 1–2 paragraphs on appearance and physical characteristics",
  "ecology": "string — 1–2 paragraphs on habitat, behaviour, diet, and social structure",
  "tactics": "string — 1 paragraph on how this monster fights",
  "lore": "string — 1–2 paragraphs on what player characters might know about this creature"
}}

Notes:
- For CR {req.cr}, xp must be {xp} and proficiency_bonus must be {prof}
- saving_throws: only include proficient saves (dict may be empty)
- skills: only include proficient skills (dict may be empty)
- bonus_actions, reactions, legendary_actions, lair_actions: include only if appropriate (arrays may be empty)
- legendary_resistance_count: 0 unless this is a legendary monster (CR 17+)
- passive_perception = 10 + wisdom modifier (+ proficiency if perception is proficient)"""


async def generate_bestiary(req: GenerateBestiaryRequest) -> tuple:
    client = anthropic.AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    message = await client.messages.create(
        model=MODEL,
        max_tokens=4096,
        system=_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": _build_prompt(req)}],
    )

    raw = message.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1]
        raw = raw.rsplit("```", 1)[0]

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"Claude returned malformed JSON: {e}\n\nRaw output:\n{raw[:500]}")

    input_tokens = message.usage.input_tokens
    output_tokens = message.usage.output_tokens
    input_cost, output_cost = await _get_model_pricing(MODEL)
    cost_usd = input_tokens * input_cost + output_tokens * output_cost

    usage = {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": input_tokens + output_tokens,
        "cost_usd": round(cost_usd, 6),
        "model": MODEL,
    }

    return Monster(**data), usage
