# character_generator.py
# Generates D&D 5e characters and generic NPCs via Claude.
#
# Features:
#   - Full stat block generation: ability scores, AC breakdown, HP, saving throws, all 18 skills,
#     attacks with to-hit and damage, spellcasting (spell slots + known spells), features & traits,
#     equipment, and proficiencies.
#   - Adjustable backstory depth: short / medium / long.
#   - Generic NPC mode: streamlined output without full combat stats (suitable for shopkeepers,
#     town folk, quest givers, etc.).
#   - Model pricing lookup via LiteLLM price list (cached per session) for cost reporting.
#   - Cost and token usage returned with every generation for display in the UI.

import json
import os
import httpx
import anthropic
from models import Character, GenerateRequest

_LITELLM_URL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json"
_pricing_cache: dict = {}

# Known fallback in case the model isn't in the LiteLLM dataset yet
_FALLBACK_INPUT_PER_TOKEN = 0.000003   # $3/MTok
_FALLBACK_OUTPUT_PER_TOKEN = 0.000015  # $15/MTok


async def _get_model_pricing(model: str) -> tuple[float, float]:
    """Return (input_cost_per_token, output_cost_per_token) for the given model."""
    global _pricing_cache
    if not _pricing_cache:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.get(_LITELLM_URL)
                if r.status_code == 200:
                    _pricing_cache = r.json()
        except Exception:
            pass

    entry = (
        _pricing_cache.get(model)
        or _pricing_cache.get(f"anthropic/{model}")
    )
    if entry:
        return (
            entry.get("input_cost_per_token", _FALLBACK_INPUT_PER_TOKEN),
            entry.get("output_cost_per_token", _FALLBACK_OUTPUT_PER_TOKEN),
        )
    return _FALLBACK_INPUT_PER_TOKEN, _FALLBACK_OUTPUT_PER_TOKEN

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

GENERIC_NPC_SYSTEM_ADDENDUM = """
GENERIC NPC MODE is active. Simplify the output as follows:
- backstory: exactly 2 sentences covering who they are and what they want
- personality_traits, ideals, bonds, flaws: one short sentence each
- features_and_traits: include at most 3 entries — only the most essential class/race features
- attacks: include exactly 1 attack at level 1; add 1 additional attack for every 4 levels (so 2 at level 5, 3 at level 9, etc.)
- spellcasting (if applicable): include spellcasting stats and spell slots, but spells_known should contain at most 1 spell per 2 levels (rounded up), plus up to 2 cantrips. Do not list more spells than this.
- equipment: list only 3-5 essential items
All 5e math rules still apply exactly. The stat block must still be correct and complete."""


def build_user_prompt(req: GenerateRequest) -> str:
    if req.generic_npc:
        backstory_instruction = "exactly 2 sentences covering their origin and motivation (GENERIC NPC MODE)"
    else:
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
    generic_note = "\n\nNOTE: GENERIC NPC MODE is active — follow the simplified output rules from the system prompt." if req.generic_npc else ""

    manual_scores_section = ""
    if req.manual_ability_scores:
        s = req.manual_ability_scores
        manual_scores_section = (
            f"\n\nFIXED ABILITY SCORES — these totals have been pre-rolled and must be used exactly:\n"
            f"STR: {s.get('str', 10)}, DEX: {s.get('dex', 10)}, CON: {s.get('con', 10)}, "
            f"INT: {s.get('int', 10)}, WIS: {s.get('wis', 10)}, CHA: {s.get('cha', 10)}\n"
            f"Set the total field for each ability score to exactly these values. "
            f"Distribute base + racial_bonus to reach these totals (use sensible racial bonuses for the race, "
            f"but the total MUST equal the provided values). Do not invent different scores."
        )

    return f"""Generate a complete D&D 5e character sheet for:
- Concept: {req.concept}
- Race: {req.race}
- Class: {req.character_class}
- Level: {req.level}
- Alignment: {req.alignment}
- Appearance: {appearance_instruction}
- Backstory detail: {backstory_instruction}{notes_section}{generic_note}{manual_scores_section}

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


MODEL = "claude-sonnet-4-6"


async def generate_character(req: GenerateRequest) -> tuple:
    client = anthropic.AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    system = SYSTEM_PROMPT + (GENERIC_NPC_SYSTEM_ADDENDUM if req.generic_npc else "")

    message = await client.messages.create(
        model=MODEL,
        max_tokens=16000,
        system=system,
        messages=[{"role": "user", "content": build_user_prompt(req)}],
    )

    raw = message.content[0].text.strip()

    # Strip markdown code fences if Claude adds them despite instructions
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1]
        raw = raw.rsplit("```", 1)[0]

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(
            f"Claude returned malformed JSON (likely truncated). "
            f"Try using 'Short' backstory detail to reduce output size. Error: {e}"
        )

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

    return Character(**data), usage
