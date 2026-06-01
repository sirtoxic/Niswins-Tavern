from pydantic import BaseModel
from typing import Optional


class AbilityScore(BaseModel):
    base: int
    racial_bonus: int = 0
    other_bonus: int = 0
    other_bonus_source: str = ""
    total: int
    modifier: int


class AbilityScores(BaseModel):
    strength: AbilityScore
    dexterity: AbilityScore
    constitution: AbilityScore
    intelligence: AbilityScore
    wisdom: AbilityScore
    charisma: AbilityScore


class ACComponent(BaseModel):
    source: str
    value: int
    type: str  # "base", "armor", "shield", "dex", "ability", "magic", "other"


class ArmorClass(BaseModel):
    total: int
    components: list[ACComponent]
    notes: str = ""


class HitPoints(BaseModel):
    maximum: int
    hit_die: str
    formula: str  # e.g. "8 (d8) + 2 (CON mod) = 10 at level 1"


class SavingThrow(BaseModel):
    ability: str
    base_modifier: int
    proficient: bool
    proficiency_bonus: int
    total: int
    breakdown: str  # e.g. "WIS +1 + Prof +2 = +3"


class SavingThrows(BaseModel):
    strength: SavingThrow
    dexterity: SavingThrow
    constitution: SavingThrow
    intelligence: SavingThrow
    wisdom: SavingThrow
    charisma: SavingThrow


class Skill(BaseModel):
    ability: str
    base_modifier: int
    proficient: bool
    expertise: bool = False
    proficiency_bonus: int
    other_bonus: int = 0
    other_bonus_source: str = ""
    total: int
    breakdown: str  # e.g. "DEX +2 + Prof +2 = +4"


class Skills(BaseModel):
    acrobatics: Skill
    animal_handling: Skill
    arcana: Skill
    athletics: Skill
    deception: Skill
    history: Skill
    insight: Skill
    intimidation: Skill
    investigation: Skill
    medicine: Skill
    nature: Skill
    perception: Skill
    performance: Skill
    persuasion: Skill
    religion: Skill
    sleight_of_hand: Skill
    stealth: Skill
    survival: Skill


class AttackBonus(BaseModel):
    ability_modifier: int
    ability_used: str
    proficiency_bonus: int
    magic_bonus: int = 0
    total: int
    breakdown: str


class Attack(BaseModel):
    name: str
    attack_bonus: AttackBonus
    damage_dice: str
    damage_bonus: int
    damage_bonus_source: str
    damage_type: str
    properties: list[str]
    range: str = "5 ft."
    notes: str = ""


class SpellSlots(BaseModel):
    level_1: int = 0
    level_2: int = 0
    level_3: int = 0
    level_4: int = 0
    level_5: int = 0
    level_6: int = 0
    level_7: int = 0
    level_8: int = 0
    level_9: int = 0


class Spell(BaseModel):
    name: str
    level: int
    school: str
    casting_time: str
    range: str
    components: str
    duration: str
    description: str


class Spellcasting(BaseModel):
    ability: str
    ability_modifier: int
    proficiency_bonus: int
    spell_attack_bonus: int
    spell_attack_breakdown: str
    spell_save_dc: int
    spell_save_breakdown: str
    spell_slots: SpellSlots
    cantrips: list[Spell] = []
    spells_known: list[Spell] = []


class Feature(BaseModel):
    name: str
    source: str  # e.g. "Fighter 1", "Background: Soldier", "Race: Half-Elf"
    description: str


class Proficiencies(BaseModel):
    armor: list[str]
    weapons: list[str]
    tools: list[str]
    languages: list[str]
    saving_throws: list[str]
    skills: list[str]


class Character(BaseModel):
    name: str
    race: str
    subrace: str = ""
    character_class: str
    subclass: str = ""
    level: int
    background: str
    alignment: str
    appearance: str
    personality_traits: str
    ideals: str
    bonds: str
    flaws: str
    backstory: str

    ability_scores: AbilityScores
    proficiency_bonus: int
    initiative: int
    initiative_breakdown: str
    speed: int
    passive_perception: int
    passive_perception_breakdown: str

    hit_points: HitPoints
    armor_class: ArmorClass
    saving_throws: SavingThrows
    skills: Skills
    attacks: list[Attack]
    spellcasting: Optional[Spellcasting] = None
    features_and_traits: list[Feature]
    equipment: list[str]
    proficiencies: Proficiencies
    death_saves_notes: str = ""
    inspiration: bool = False


class GenerateRequest(BaseModel):
    concept: str
    race: str
    character_class: str
    level: int = 1
    alignment: str
    appearance: str
    background_detail: str  # "short", "medium", "long"
    additional_notes: str = ""
    generic_npc: bool = False


class SaveRequest(BaseModel):
    character: Character
    folder: str = "npcs"
    history_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Item models
# ---------------------------------------------------------------------------

class ItemBonus(BaseModel):
    stat: str
    value: int


class ItemAbility(BaseModel):
    name: str
    description: str
    usage: str
    activation: str = "Passive"


class Item(BaseModel):
    name: str
    item_type: str
    rarity: str
    target_level_min: int
    target_level_max: int
    requires_attunement: bool = False
    attunement_by: str = ""
    description: str
    lore: str
    bonuses: list[ItemBonus]
    abilities: list[ItemAbility]
    weight_lbs: Optional[float] = None
    value_gp: Optional[int] = None


class GenerateItemRequest(BaseModel):
    concept: str
    item_type: str
    rarity: str = "Uncommon"
    target_level_min: int = 1
    target_level_max: int = 5
    additional_notes: str = ""
    magic_theme: str = ""          # e.g. "Fire", "Shadow", "Nature"
    material: str = ""             # e.g. "Mithral", "Obsidian", "Bone"
    stat_bonus_target: str = ""    # e.g. "Strength", "Attack Rolls", "Dexterity Saving Throws"
    damage_type: str = ""          # e.g. "Fire", "Cold", "Necrotic" — relevant for weapons
    attunement: str = "auto"       # "auto" | "required" | "none"


class SaveItemRequest(BaseModel):
    item: Item
    history_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Shop models
# ---------------------------------------------------------------------------

class ShopItem(BaseModel):
    name: str
    item_type: str
    rarity: str
    price_gp: Optional[int] = None
    description: str
    is_under_table: bool = False
    concept: str  # pre-filled concept for full item generation


class ShopKeeper(BaseModel):
    name: str
    race: str
    character_class: str = "Commoner"
    gender: str = ""
    appearance: str
    personality: str
    motivation: str = ""
    concept: str  # pre-filled concept for full NPC generation


class Shop(BaseModel):
    name: str
    shop_type: str
    category: str
    description: str
    atmosphere: str = ""
    shopkeeper: ShopKeeper
    items: list[ShopItem]


class GenerateShopRequest(BaseModel):
    shop_type: str = "building"
    category: str = "General"
    item_count: int = 8
    under_table: bool = False
    rarities: list[str] = ["Common", "Uncommon"]
    detail_level: str = "medium"
    additional_notes: str = ""


class SaveShopRequest(BaseModel):
    shop: Shop
    history_id: Optional[str] = None


class SettingsUpdate(BaseModel):
    anthropic_api_key: str = ""
    claude_model: str = "claude-sonnet-4-6"
    docmost_url: str = ""
    docmost_username: str = ""
    docmost_password: str = ""
    folder_url_npcs: str = ""
    folder_url_bestiary: str = ""
    folder_url_locations: str = ""
    folder_url_encounters: str = ""
    folder_url_items: str = ""


class TestPageUrlRequest(BaseModel):
    url: str


class UpdateEntryRequest(BaseModel):
    updates: dict
