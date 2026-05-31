import json
import os
import anthropic
from models import Character, GenerateRequest

ABILITY_NAMES = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"]
ALL_SKILLS = [
    "acrobatics", "animal_handling", "arcana", "athletics", "deception",
    "history", "insight", "intimidation", "investigation", "medicine",
    "nature", "perception", "performance", "persuasion", "religion",
    "sleight_of_hand", "stealth", "survival"
]

SYSTEM_PROMPT = """You are a D&D 5e (2014) NPC and character generator. You produce detailed, complete character sheets as structured JSON.

Rules you must follow precisely:
- Ability modifier = floor((score - 10) / 2)
- Proficiency bonus by level: 1-4 = +2, 5-8 = +3, 9-12 = +4, 13-16 = +5, 17-20 = +6
- AC breakdown must list every component (base 10, armor value, DEX modifier, shield, magic, class features like Unarmored Defense)
- Skill totals = ability modifier + proficiency bonus (if proficient) + expertise bonus (if expertise) + other bonuses
- Saving throw totals = ability modifier + proficiency bonus (if proficient)
- Spell attack bonus = proficiency bonus + spellcasting ability modifier
- Spell save DC = 8 + proficiency bonus + spellcasting ability modifier
- Passive Perception = 10 + Perception skill total
- Initiative = DEX modifier

Always separate base ability scores from racial bonuses so both are visible.
Always show the formula/breakdown for every calculated stat.
Return ONLY valid JSON matching the schema — no prose, no markdown fences."""

def build_user_prompt(req: GenerateRequest) -> str:
    backstory_guidance = {
        "short": "1-2 sentences of backstory covering origin and motivation",
        "medium": "2-3 paragraphs covering origin, key life events, and what drives them",
        "long": "4-6 paragraphs with rich detail: origin, formative experiences, relationships, traumas, goals, and secrets",
    }
    backstory_instruction = backstory_guidance.get(req.background_detail, backstory_guidance["medium"])

    appearance_instruction = (
        f'Use this appearance description: "{req.appearance}"' if req.appearance.strip()
        else "Generate a vivid appearance description appropriate to their race and background."
    )

    notes_section = f"\nAdditional notes: {req.additional_notes}" if req.additional_notes.strip() else ""

    return f"""Generate a complete D&D 5e character sheet for:
- Concept: {req.concept}
- Race: {req.race}
- Class: {req.character_class}
- Level: {req.level}
- Alignment: {req.alignment}
- Appearance: {appearance_instruction}
- Backstory detail: {backstory_instruction}{notes_section}

Return a JSON object matching this exact schema. Every field is required unless marked optional.

{{
  "name": "string",
  "race": "string",
  "subrace": "string (empty if none)",
  "character_class": "string",
  "subclass": "string (empty if level < 3 or no subclass)",
  "level": {req.level},
  "background": "string",
  "alignment": "{req.alignment}",
  "appearance": "string",
  "personality_traits": "string",
  "ideals": "string",
  "bonds": "string",
  "flaws": "string",
  "backstory": "string",

  "ability_scores": {{
    "strength":     {{"base": int, "racial_bonus": int, "other_bonus": int, "other_bonus_source": "string", "total": int, "modifier": int}},
    "dexterity":    {{"base": int, "racial_bonus": int, "other_bonus": int, "other_bonus_source": "string", "total": int, "modifier": int}},
    "constitution": {{"base": int, "racial_bonus": int, "other_bonus": int, "other_bonus_source": "string", "total": int, "modifier": int}},
    "intelligence": {{"base": int, "racial_bonus": int, "other_bonus": int, "other_bonus_source": "string", "total": int, "modifier": int}},
    "wisdom":       {{"base": int, "racial_bonus": int, "other_bonus": int, "other_bonus_source": "string", "total": int, "modifier": int}},
    "charisma":     {{"base": int, "racial_bonus": int, "other_bonus": int, "other_bonus_source": "string", "total": int, "modifier": int}}
  }},

  "proficiency_bonus": int,
  "initiative": int,
  "initiative_breakdown": "string (e.g. 'DEX modifier +2')",
  "speed": int,
  "passive_perception": int,
  "passive_perception_breakdown": "string (e.g. '10 + Perception +3 = 13')",

  "hit_points": {{
    "maximum": int,
    "hit_die": "string (e.g. 'd8')",
    "formula": "string (e.g. '8 (d8 max at level 1) + 2 (CON mod +2) = 10')"
  }},

  "armor_class": {{
    "total": int,
    "components": [
      {{"source": "string", "value": int, "type": "base|armor|shield|dex|ability|magic|other"}}
    ],
    "notes": "string (e.g. 'Wearing Chain Mail. DEX not added due to heavy armor.')"
  }},

  "saving_throws": {{
    "strength":     {{"ability": "STR", "base_modifier": int, "proficient": bool, "proficiency_bonus": int, "total": int, "breakdown": "string"}},
    "dexterity":    {{"ability": "DEX", "base_modifier": int, "proficient": bool, "proficiency_bonus": int, "total": int, "breakdown": "string"}},
    "constitution": {{"ability": "CON", "base_modifier": int, "proficient": bool, "proficiency_bonus": int, "total": int, "breakdown": "string"}},
    "intelligence": {{"ability": "INT", "base_modifier": int, "proficient": bool, "proficiency_bonus": int, "total": int, "breakdown": "string"}},
    "wisdom":       {{"ability": "WIS", "base_modifier": int, "proficient": bool, "proficiency_bonus": int, "total": int, "breakdown": "string"}},
    "charisma":     {{"ability": "CHA", "base_modifier": int, "proficient": bool, "proficiency_bonus": int, "total": int, "breakdown": "string"}}
  }},

  "skills": {{
    "acrobatics":       {{"ability": "DEX", "base_modifier": int, "proficient": bool, "expertise": bool, "proficiency_bonus": int, "other_bonus": int, "other_bonus_source": "string", "total": int, "breakdown": "string"}},
    "animal_handling":  {{"ability": "WIS", "base_modifier": int, "proficient": bool, "expertise": bool, "proficiency_bonus": int, "other_bonus": int, "other_bonus_source": "string", "total": int, "breakdown": "string"}},
    "arcana":           {{"ability": "INT", "base_modifier": int, "proficient": bool, "expertise": bool, "proficiency_bonus": int, "other_bonus": int, "other_bonus_source": "string", "total": int, "breakdown": "string"}},
    "athletics":        {{"ability": "STR", "base_modifier": int, "proficient": bool, "expertise": bool, "proficiency_bonus": int, "other_bonus": int, "other_bonus_source": "string", "total": int, "breakdown": "string"}},
    "deception":        {{"ability": "CHA", "base_modifier": int, "proficient": bool, "expertise": bool, "proficiency_bonus": int, "other_bonus": int, "other_bonus_source": "string", "total": int, "breakdown": "string"}},
    "history":          {{"ability": "INT", "base_modifier": int, "proficient": bool, "expertise": bool, "proficiency_bonus": int, "other_bonus": int, "other_bonus_source": "string", "total": int, "breakdown": "string"}},
    "insight":          {{"ability": "WIS", "base_modifier": int, "proficient": bool, "expertise": bool, "proficiency_bonus": int, "other_bonus": int, "other_bonus_source": "string", "total": int, "breakdown": "string"}},
    "intimidation":     {{"ability": "CHA", "base_modifier": int, "proficient": bool, "expertise": bool, "proficiency_bonus": int, "other_bonus": int, "other_bonus_source": "string", "total": int, "breakdown": "string"}},
    "investigation":    {{"ability": "INT", "base_modifier": int, "proficient": bool, "expertise": bool, "proficiency_bonus": int, "other_bonus": int, "other_bonus_source": "string", "total": int, "breakdown": "string"}},
    "medicine":         {{"ability": "WIS", "base_modifier": int, "proficient": bool, "expertise": bool, "proficiency_bonus": int, "other_bonus": int, "other_bonus_source": "string", "total": int, "breakdown": "string"}},
    "nature":           {{"ability": "INT", "base_modifier": int, "proficient": bool, "expertise": bool, "proficiency_bonus": int, "other_bonus": int, "other_bonus_source": "string", "total": int, "breakdown": "string"}},
    "perception":       {{"ability": "WIS", "base_modifier": int, "proficient": bool, "expertise": bool, "proficiency_bonus": int, "other_bonus": int, "other_bonus_source": "string", "total": int, "breakdown": "string"}},
    "performance":      {{"ability": "CHA", "base_modifier": int, "proficient": bool, "expertise": bool, "proficiency_bonus": int, "other_bonus": int, "other_bonus_source": "string", "total": int, "breakdown": "string"}},
    "persuasion":       {{"ability": "CHA", "base_modifier": int, "proficient": bool, "expertise": bool, "proficiency_bonus": int, "other_bonus": int, "other_bonus_source": "string", "total": int, "breakdown": "string"}},
    "religion":         {{"ability": "INT", "base_modifier": int, "proficient": bool, "expertise": bool, "proficiency_bonus": int, "other_bonus": int, "other_bonus_source": "string", "total": int, "breakdown": "string"}},
    "sleight_of_hand":  {{"ability": "DEX", "base_modifier": int, "proficient": bool, "expertise": bool, "proficiency_bonus": int, "other_bonus": int, "other_bonus_source": "string", "total": int, "breakdown": "string"}},
    "stealth":          {{"ability": "DEX", "base_modifier": int, "proficient": bool, "expertise": bool, "proficiency_bonus": int, "other_bonus": int, "other_bonus_source": "string", "total": int, "breakdown": "string"}},
    "survival":         {{"ability": "WIS", "base_modifier": int, "proficient": bool, "expertise": bool, "proficiency_bonus": int, "other_bonus": int, "other_bonus_source": "string", "total": int, "breakdown": "string"}}
  }},

  "attacks": [
    {{
      "name": "string",
      "attack_bonus": {{
        "ability_modifier": int,
        "ability_used": "string (e.g. 'STR')",
        "proficiency_bonus": int,
        "magic_bonus": int,
        "total": int,
        "breakdown": "string (e.g. 'STR +3 + Prof +2 = +5')"
      }},
      "damage_dice": "string (e.g. '1d8')",
      "damage_bonus": int,
      "damage_bonus_source": "string (e.g. 'STR modifier')",
      "damage_type": "string",
      "properties": ["string"],
      "range": "string",
      "notes": "string"
    }}
  ],

  "spellcasting": null,

  "features_and_traits": [
    {{"name": "string", "source": "string", "description": "string"}}
  ],

  "equipment": ["string"],

  "proficiencies": {{
    "armor": ["string"],
    "weapons": ["string"],
    "tools": ["string"],
    "languages": ["string"],
    "saving_throws": ["string"],
    "skills": ["string"]
  }},

  "death_saves_notes": "",
  "inspiration": false
}}

For spellcasting classes, replace null with:
{{
  "ability": "string",
  "ability_modifier": int,
  "proficiency_bonus": int,
  "spell_attack_bonus": int,
  "spell_attack_breakdown": "string (e.g. 'Prof +2 + WIS +3 = +5')",
  "spell_save_dc": int,
  "spell_save_breakdown": "string (e.g. '8 + Prof +2 + WIS +3 = 13')",
  "spell_slots": {{"level_1": int, "level_2": int, "level_3": int, "level_4": int, "level_5": int, "level_6": int, "level_7": int, "level_8": int, "level_9": int}},
  "cantrips": [{{"name": "string", "level": 0, "school": "string", "casting_time": "string", "range": "string", "components": "string", "duration": "string", "description": "string"}}],
  "spells_known": [{{"name": "string", "level": int, "school": "string", "casting_time": "string", "range": "string", "components": "string", "duration": "string", "description": "string"}}]
}}"""


async def generate_character(req: GenerateRequest) -> Character:
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=8192,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": build_user_prompt(req)}],
    )

    raw = message.content[0].text.strip()

    # Strip markdown code fences if Claude adds them despite instructions
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1]
        raw = raw.rsplit("```", 1)[0]

    data = json.loads(raw)
    return Character(**data)
