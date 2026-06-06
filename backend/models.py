# models.py
# Pydantic data models for every generator in Niswins Tavern.
#
# Character / NPC:   GenerateRequest, SaveRequest, Character (with full D&D 5e stat block —
#                    ability scores, AC, HP, saving throws, skills, attacks, spellcasting,
#                    features, equipment, proficiencies).
# Item:              GenerateItemRequest, SaveItemRequest, Item (bonuses, abilities, attunement).
# Shop:              GenerateShopRequest, SaveShopRequest, Shop, ShopKeeper, ShopItem, ShopStaff,
#                    LinkShopNpcRequest, RegenerateShopStaffRequest.
# Faction:           GenerateFactionRequest, SaveFactionRequest, Faction, FactionLeader,
#                    FactionMember, LinkFactionNpcRequest, RegenerateMemberRequest.
# Settings / Util:   SettingsUpdate, TestPageUrlRequest, UpdateEntryRequest.

from pydantic import BaseModel, field_validator
from typing import Optional

# Runtime validation limits — updated by set_validation_limits() on startup and after settings save.
_limits: dict = {
    "max_concept_length": 1000,
    "max_notes_length": 500,
    "max_character_level": 20,
    "max_shop_items": 20,
}


def set_validation_limits(limits: dict) -> None:
    _limits.update({k: v for k, v in limits.items() if k in _limits})


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
    player_name: Optional[str] = None
    is_player_character: bool = False
    manual_ability_scores: Optional[dict] = None  # {str, dex, con, int, wis, cha: int}
    parent_context_id: Optional[str] = None

    @field_validator('concept', 'appearance')
    @classmethod
    def _check_concept_length(cls, v: str) -> str:
        if len(v) > _limits['max_concept_length']:
            raise ValueError(f'Must be at most {_limits["max_concept_length"]} characters ({len(v)} given)')
        return v

    @field_validator('additional_notes')
    @classmethod
    def _check_notes_length(cls, v: str) -> str:
        if len(v) > _limits['max_notes_length']:
            raise ValueError(f'Must be at most {_limits["max_notes_length"]} characters ({len(v)} given)')
        return v

    @field_validator('level')
    @classmethod
    def _check_level(cls, v: int) -> int:
        if v < 1 or v > _limits['max_character_level']:
            raise ValueError(f'Level must be between 1 and {_limits["max_character_level"]}')
        return v


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
    parent_context_id: Optional[str] = None

    @field_validator('concept')
    @classmethod
    def _check_concept_length(cls, v: str) -> str:
        if len(v) > _limits['max_concept_length']:
            raise ValueError(f'Must be at most {_limits["max_concept_length"]} characters ({len(v)} given)')
        return v

    @field_validator('additional_notes')
    @classmethod
    def _check_notes_length(cls, v: str) -> str:
        if len(v) > _limits['max_notes_length']:
            raise ValueError(f'Must be at most {_limits["max_notes_length"]} characters ({len(v)} given)')
        return v

    @field_validator('target_level_min', 'target_level_max')
    @classmethod
    def _check_target_level(cls, v: int) -> int:
        if v < 1 or v > 20:
            raise ValueError('Target level must be between 1 and 20')
        return v


class SaveItemRequest(BaseModel):
    item: Item
    history_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Shop models
# ---------------------------------------------------------------------------

class ShopStaff(BaseModel):
    name: str
    role: str
    description: str


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
    staff: list[ShopStaff] = []


class GenerateShopRequest(BaseModel):
    shop_type: str = "building"
    category: str = "General"
    item_count: int = 8
    under_table: bool = False
    rarities: list[str] = ["Common", "Uncommon"]
    detail_level: str = "medium"
    additional_notes: str = ""
    parent_context_id: Optional[str] = None

    @field_validator('item_count')
    @classmethod
    def _check_item_count(cls, v: int) -> int:
        if v < 1 or v > _limits['max_shop_items']:
            raise ValueError(f'Item count must be between 1 and {_limits["max_shop_items"]}')
        return v

    @field_validator('additional_notes')
    @classmethod
    def _check_notes_length(cls, v: str) -> str:
        if len(v) > _limits['max_notes_length']:
            raise ValueError(f'Must be at most {_limits["max_notes_length"]} characters ({len(v)} given)')
        return v


class SaveShopRequest(BaseModel):
    shop: Shop
    history_id: Optional[str] = None


class LinkShopNpcRequest(BaseModel):
    member_name: str
    member_role: str
    npc_name: str
    npc_docmost_url: str
    npc_history_id: str
    is_shopkeeper: bool = False


class RegenerateShopStaffRequest(BaseModel):
    is_shopkeeper: bool = False
    staff_index: Optional[int] = None  # None = add new staff member


# ---------------------------------------------------------------------------
# Faction models
# ---------------------------------------------------------------------------

class FactionLeader(BaseModel):
    name: str
    title: str
    race: str
    description: str


class FactionMember(BaseModel):
    name: str
    role: str
    description: str


class Faction(BaseModel):
    name: str
    faction_type: str
    size: str
    alignment: str
    motto: str
    overview: str
    history: str
    goals: list[str]
    methods: list[str]
    headquarters: str
    wealth: str
    public_reputation: str
    secrets: list[str]
    symbols: str
    leader: FactionLeader
    notable_members: list[FactionMember]
    allies: list[str]
    enemies: list[str]


class GenerateFactionRequest(BaseModel):
    concept: str = ""
    faction_type: str = "Guild"
    size: str = "Medium"
    alignment: str = "True Neutral"
    wealth: str = "Moderate"
    reputation: str = "Neutral"
    region: str = ""
    additional_notes: str = ""
    parent_context_id: Optional[str] = None

    @field_validator('concept', 'region')
    @classmethod
    def _check_concept_length(cls, v: str) -> str:
        if len(v) > _limits['max_concept_length']:
            raise ValueError(f'Must be at most {_limits["max_concept_length"]} characters ({len(v)} given)')
        return v

    @field_validator('additional_notes')
    @classmethod
    def _check_notes_length(cls, v: str) -> str:
        if len(v) > _limits['max_notes_length']:
            raise ValueError(f'Must be at most {_limits["max_notes_length"]} characters ({len(v)} given)')
        return v


class SaveFactionRequest(BaseModel):
    faction: Faction
    history_id: Optional[str] = None


class LinkFactionNpcRequest(BaseModel):
    member_name: str
    member_role: str
    npc_name: str
    npc_docmost_url: str
    npc_history_id: str


class RegenerateMemberRequest(BaseModel):
    is_leader: bool = False
    member_index: Optional[int] = None  # None = add new notable member


# ---------------------------------------------------------------------------
# Bestiary models
# ---------------------------------------------------------------------------

class MonsterSpeed(BaseModel):
    walk: int = 30
    fly: int = 0
    swim: int = 0
    burrow: int = 0
    climb: int = 0
    hover: bool = False


class MonsterAbilityScore(BaseModel):
    score: int
    modifier: int


class MonsterAbilityScores(BaseModel):
    strength: MonsterAbilityScore
    dexterity: MonsterAbilityScore
    constitution: MonsterAbilityScore
    intelligence: MonsterAbilityScore
    wisdom: MonsterAbilityScore
    charisma: MonsterAbilityScore


class MonsterTrait(BaseModel):
    name: str
    description: str


class MonsterAction(BaseModel):
    name: str
    description: str


class LegendaryAction(BaseModel):
    name: str
    cost: int = 1
    description: str


class Monster(BaseModel):
    name: str
    size: str
    monster_type: str
    subtype: str = ""
    alignment: str
    armor_class: int
    armor_type: str = ""
    hit_points: int
    hit_dice: str
    speed: MonsterSpeed
    ability_scores: MonsterAbilityScores
    proficiency_bonus: int
    saving_throws: dict = {}
    skills: dict = {}
    damage_vulnerabilities: list[str] = []
    damage_resistances: list[str] = []
    damage_immunities: list[str] = []
    condition_immunities: list[str] = []
    senses: list[str] = []
    passive_perception: int
    languages: list[str] = []
    challenge_rating: str
    xp: int
    special_traits: list[MonsterTrait] = []
    actions: list[MonsterAction] = []
    bonus_actions: list[MonsterTrait] = []
    reactions: list[MonsterTrait] = []
    legendary_actions: list[LegendaryAction] = []
    legendary_resistance_count: int = 0
    lair_actions: list[MonsterTrait] = []
    description: str = ""
    ecology: str = ""
    tactics: str = ""
    lore: str = ""


class GenerateBestiaryRequest(BaseModel):
    concept: str = ""
    monster_type: str = "Beast"
    size: str = "Medium"
    cr: str = "1"
    alignment: str = "Unaligned"
    environment: str = ""
    additional_notes: str = ""
    parent_context_id: Optional[str] = None

    @field_validator('concept', 'environment')
    @classmethod
    def _check_concept_length(cls, v: str) -> str:
        if len(v) > _limits['max_concept_length']:
            raise ValueError(f'Must be at most {_limits["max_concept_length"]} characters ({len(v)} given)')
        return v

    @field_validator('additional_notes')
    @classmethod
    def _check_notes_length(cls, v: str) -> str:
        if len(v) > _limits['max_notes_length']:
            raise ValueError(f'Must be at most {_limits["max_notes_length"]} characters ({len(v)} given)')
        return v


class SaveBestiaryRequest(BaseModel):
    monster: Monster
    history_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Location
# ---------------------------------------------------------------------------

class LocationNotableNpc(BaseModel):
    name: str
    role: str
    concept: str = ""


class Location(BaseModel):
    name: str
    location_type: str
    description: str
    atmosphere: str
    history: str = ""
    climate: Optional[str] = None
    terrain: Optional[str] = None
    population: Optional[str] = None
    government: Optional[str] = None
    economy: Optional[str] = None
    dominant_culture: Optional[str] = None
    building_type: Optional[str] = None
    condition: Optional[str] = None
    owner: Optional[str] = None
    notable_features: list[str] = []
    notable_npcs: list[LocationNotableNpc] = []
    secrets: list[str] = []
    plot_hooks: list[str] = []
    factions: list[str] = []


class GenerateLocationRequest(BaseModel):
    concept: str = ""
    location_type: str = "City/Town"
    climate: str = ""
    terrain: str = ""
    population_scale: str = ""
    government_type: str = ""
    building_type: str = ""
    atmosphere_hint: str = ""
    additional_notes: str = ""
    detail_level: str = "medium"
    parent_context_id: Optional[str] = None

    @field_validator('concept')
    @classmethod
    def _check_concept_length(cls, v: str) -> str:
        if len(v) > _limits['max_concept_length']:
            raise ValueError(f'Must be at most {_limits["max_concept_length"]} characters ({len(v)} given)')
        return v

    @field_validator('additional_notes')
    @classmethod
    def _check_notes_length(cls, v: str) -> str:
        if len(v) > _limits['max_notes_length']:
            raise ValueError(f'Must be at most {_limits["max_notes_length"]} characters ({len(v)} given)')
        return v


class SaveLocationRequest(BaseModel):
    location: Location
    history_id: Optional[str] = None
    parent_location_id: Optional[str] = None


class LinkLocationChildRequest(BaseModel):
    child_history_id: str
    child_name: str
    child_type: str
    child_docmost_url: Optional[str] = None


class LinkLocationParentRequest(BaseModel):
    parent_history_id: str
    parent_name: str
    parent_type: str
    parent_docmost_url: Optional[str] = None


class SettingsUpdate(BaseModel):
    campaign_name: str = ""
    anthropic_api_key: str = ""
    claude_model: str = "claude-sonnet-4-6"
    low_token_mode: bool = False
    docmost_url: str = ""
    docmost_username: str = ""
    docmost_password: str = ""
    folder_url_npcs: str = ""
    folder_url_bestiary: str = ""
    folder_url_locations: str = ""
    folder_url_encounters: str = ""
    folder_url_items: str = ""
    folder_url_factions: str = ""
    folder_url_players: str = ""
    max_concept_length: int = 1000
    max_notes_length: int = 500
    max_character_level: int = 20
    max_shop_items: int = 20


class TestPageUrlRequest(BaseModel):
    url: str


class UpdateEntryRequest(BaseModel):
    updates: dict
