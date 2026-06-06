# shop_generator.py
# Generates shops and their contents for D&D 5e via Claude.
#
# Features:
#   - Shop generation: configurable physical form (building / stall / cart / ship / cave),
#     category (Blacksmith, Alchemist, General, etc.), item count, rarity mix, and detail level
#     (low / medium / high description length).
#   - Under-the-table mode: marks illegal or stolen items separately for the DM.
#   - Shopkeeper: name, race, class/occupation, gender, appearance, personality, motivation, and
#     a pre-filled NPC concept prompt for full character generation.
#   - Each shop item includes a pre-filled concept prompt for full item generation.
#   - Staff generation: generate_shop_staff() produces a new shopkeeper or staff member
#     (assistant, guard, apprentice, etc.) using the shop's name, category, and atmosphere as
#     context, allowing Add / Regenerate from the shop sheet.

from __future__ import annotations

import json
from models import Shop, GenerateShopRequest, ShopStaff
from ai_client import call_claude, get_low_token_mode, HAIKU_MODEL

_SYSTEM_PROMPT = """You are a D&D 5e worldbuilder specialising in creating vivid, memorable shops and merchants for tabletop RPGs. You produce detailed, flavourful content as structured JSON.

Rules:
- Shops and shopkeepers should feel grounded and real — they have history, personality, and quirks
- Items should feel curated, not random — a good merchant knows their stock
- Descriptions should be immediately usable at the table
- D&D 5e PHB prices as baseline; adjust for rarity and setting
- Return ONLY valid JSON — no prose, no markdown fences"""


def _detail_instructions(detail_level: str) -> str:
    if detail_level == "low":
        return "1 paragraph (4-6 sentences) covering the shop's appearance and feel"
    elif detail_level == "high":
        return (
            "5-10 paragraphs covering: exterior appearance, interior layout, atmosphere and smells, "
            "the shop's history and reputation, notable features, regular clientele, any secrets or hooks, "
            "and how it fits into the surrounding neighbourhood"
        )
    else:
        return "3 paragraphs covering: the shop's appearance and layout, its atmosphere and clientele, and one interesting detail or story hook"


def _build_prompt(req: GenerateShopRequest) -> str:
    rarity_str = ", ".join(req.rarities) if req.rarities else "Common, Uncommon"
    detail = _detail_instructions(req.detail_level)

    if req.under_table:
        under_table_note = (
            "Include a mix of legitimate stock and some under-the-table items that are illegal, "
            "stolen, or that the shopkeeper shouldn't openly have. Mark under-the-table items with "
            "is_under_table: true. These should be plausible for this shop type but risky to buy openly."
        )
    else:
        under_table_note = "All items are legitimate stock. Set is_under_table: false for every item."

    extras = []
    if req.additional_notes.strip():
        extras.append(f"Additional notes: {req.additional_notes}")
    extra_block = ("\n" + "\n".join(extras)) if extras else ""

    return f"""Generate a D&D 5e shop with the following parameters:
- Physical form: {req.shop_type}
- Category / speciality: {req.category}
- Number of items to stock: {req.item_count}
- Item rarities to include: {rarity_str}
- {under_table_note}
- Shop description detail: {detail}
- Shopkeeper description: 1-2 sentences each for appearance and personality{extra_block}

Return a JSON object matching this exact schema. Every field is required.

{{
  "name": "string — the shop's name (e.g. 'The Crooked Compass', 'Mira's Potions')",
  "shop_type": "{req.shop_type}",
  "category": "{req.category}",
  "description": "string — {detail}",
  "atmosphere": "string — one evocative sentence capturing the immediate feel of the place",
  "shopkeeper": {{
    "name": "string — full name",
    "race": "string — D&D 5e race",
    "character_class": "string — occupation class e.g. Commoner, Merchant, Wizard, Rogue, Fighter",
    "gender": "string — optional, may be empty",
    "appearance": "string — 1-2 sentences: build, clothing, notable features, mannerisms",
    "personality": "string — 1-2 sentences: temperament, speech style, attitude to customers",
    "motivation": "string — one sentence: what drives them (profit, passion, debt, hiding something, etc.)",
    "concept": "string — a punchy NPC concept for use as a generation prompt, e.g. 'A half-elf alchemist who secretly brews illegal paralytic agents for the city watch'"
  }},
  "items": [
    {{
      "name": "string — item name",
      "item_type": "string — category e.g. Potion, Longsword, Cloak, Ring, Ration, Map, Tool",
      "rarity": "string — exactly one of: Common, Uncommon, Rare, Epic, Legendary",
      "price_gp": integer or null,
      "description": "string — 1-2 sentences: what it looks like and what it does or is used for",
      "is_under_table": boolean,
      "concept": "string — a concise item concept prompt for full item generation, e.g. 'A dagger that always returns to the thrower'"
    }}
  ]
}}

Generate exactly {req.item_count} items. Distribute rarities naturally across: {rarity_str}."""


async def generate_shop(req: GenerateShopRequest) -> tuple:
    raw, usage = await call_claude(_build_prompt(req), max_tokens=8192, system=_SYSTEM_PROMPT)

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"Claude returned malformed JSON: {e}\n\nRaw output:\n{raw[:500]}")

    return Shop(**data), usage


async def generate_shop_staff(shop: Shop, is_shopkeeper: bool = False) -> dict:
    """Generate a new shopkeeper or staff member for an existing shop. Returns raw dict."""
    overview_excerpt = shop.description[:400] if shop.description else ""

    if is_shopkeeper:
        schema = (
            '{"name": "string", "race": "string — D&D 5e race", '
            '"character_class": "string — occupation e.g. Commoner, Merchant, Wizard", '
            '"gender": "string — optional, may be empty", '
            '"appearance": "string — 1-2 sentences", '
            '"personality": "string — 1-2 sentences", '
            '"motivation": "string — one sentence", '
            '"concept": "string — punchy NPC concept prompt"}'
        )
        role_desc = "a new shopkeeper"
    else:
        schema = '{"name": "string", "role": "string — their job in the shop e.g. Assistant, Guard, Apprentice", "description": "string — 1 sentence on what makes them memorable"}'
        role_desc = "a new staff member (not the shopkeeper)"

    prompt = f"""Generate {role_desc} for the following shop. The character must fit the shop's theme and atmosphere.

Shop: {shop.name}
Category: {shop.category}
Type: {shop.shop_type}
Atmosphere: {shop.atmosphere}
Description: {overview_excerpt}

Return ONLY a JSON object matching this schema:
{schema}"""

    sub_model = HAIKU_MODEL if get_low_token_mode() else None
    raw, _ = await call_claude(prompt, max_tokens=512, model=sub_model)
    return json.loads(raw)
