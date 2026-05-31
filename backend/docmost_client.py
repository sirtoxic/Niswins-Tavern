"""
Docmost community edition REST client.

Discovered API behaviour:
  POST /api/auth/login       → sets authToken cookie (JWT)
  POST /api/spaces           → lists spaces  { data: { items: [...] } }
  POST /api/pages/create     → create page   { title, spaceId, parentPageId?, content, format }
  POST /api/pages/update     → update page   { pageId, operation, content, format }
  GET  /api/pages/:id        → fetch page    { data: { content, ... } }

Auth: Bearer token in Authorization header (extracted from authToken cookie after login).
"""

from __future__ import annotations

import httpx
import yaml
import logging
from pathlib import Path
from models import Character

logger = logging.getLogger(__name__)

CONFIG_PATH = Path(__file__).parent.parent / "config.yaml"


def _load_config() -> dict:
    with open(CONFIG_PATH) as f:
        return yaml.safe_load(f)


def _sign(n: int) -> str:
    return f"+{n}" if n >= 0 else str(n)


class DocmostClient:
    def __init__(self):
        cfg = _load_config()["docmost"]
        self.base_url = cfg["url"].rstrip("/")
        self.username = cfg["username"]
        self.password = cfg["password"]
        self.folder_names: dict[str, str] = cfg["folders"]
        self._token: str | None = None
        self._space_cache: dict[str, str] = {}   # name → id
        self._folder_cache: dict[str, str] = {}  # "space_id:folder_name" → page_id

    # ------------------------------------------------------------------
    # Auth
    # ------------------------------------------------------------------

    async def _ensure_auth(self):
        if self._token:
            return
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{self.base_url}/auth/login",
                json={"email": self.username, "password": self.password},
            )
            r.raise_for_status()
            self._token = r.cookies.get("authToken")
            if not self._token:
                raise RuntimeError("Docmost login succeeded but no authToken cookie returned")
            logger.info("Docmost auth successful")

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self._token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    # ------------------------------------------------------------------
    # Spaces  (POST /spaces returns list)
    # ------------------------------------------------------------------

    async def _get_spaces(self) -> list[dict]:
        async with httpx.AsyncClient() as client:
            r = await client.post(f"{self.base_url}/spaces", json={}, headers=self._headers())
            r.raise_for_status()
            data = r.json()
            return data.get("data", {}).get("items", [])

    async def _get_first_space(self) -> str:
        """Returns the ID of the first available space (Docmost community has one space)."""
        if "default" in self._space_cache:
            return self._space_cache["default"]
        spaces = await self._get_spaces()
        if not spaces:
            raise RuntimeError("No spaces found in Docmost workspace")
        space_id = spaces[0]["id"]
        self._space_cache["default"] = space_id
        logger.info(f"Using Docmost space: {spaces[0]['name']} ({space_id})")
        return space_id

    # ------------------------------------------------------------------
    # Pages
    # ------------------------------------------------------------------

    async def _get_page(self, page_id: str) -> dict:
        async with httpx.AsyncClient() as client:
            r = await client.get(f"{self.base_url}/pages/{page_id}", headers=self._headers())
            r.raise_for_status()
            return r.json().get("data", r.json())

    async def _create_page(
        self,
        space_id: str,
        title: str,
        content: str,
        parent_page_id: str | None = None,
    ) -> str:
        payload = {
            "title": title,
            "spaceId": space_id,
            "content": content,
            "format": "markdown",
        }
        if parent_page_id:
            payload["parentPageId"] = parent_page_id

        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{self.base_url}/pages/create",
                json=payload,
                headers=self._headers(),
            )
            r.raise_for_status()
            return r.json()["data"]["id"]

    async def _append_to_page(self, page_id: str, markdown: str):
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{self.base_url}/pages/update",
                json={
                    "pageId": page_id,
                    "operation": "append",
                    "content": markdown,
                    "format": "markdown",
                },
                headers=self._headers(),
            )
            r.raise_for_status()

    # ------------------------------------------------------------------
    # Folder pages (top-level parent pages acting as folders)
    # ------------------------------------------------------------------

    async def _get_or_create_folder_page(self, space_id: str, folder_name: str) -> str:
        cache_key = f"{space_id}:{folder_name}"
        if cache_key in self._folder_cache:
            return self._folder_cache[cache_key]

        # Search existing top-level pages for a matching title
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{self.base_url}/pages/list",
                json={"spaceId": space_id},
                headers=self._headers(),
            )
            if r.status_code == 200:
                items = r.json().get("data", {}).get("items", [])
                for p in items:
                    if p.get("title", "").lower() == folder_name.lower() and not p.get("parentPageId"):
                        self._folder_cache[cache_key] = p["id"]
                        return p["id"]

        folder_id = await self._create_page(
            space_id=space_id,
            title=folder_name,
            content=f"# {folder_name}\n\n",
            parent_page_id=None,
        )
        self._folder_cache[cache_key] = folder_id
        logger.info(f"Created folder page: {folder_name} ({folder_id})")
        return folder_id

    # ------------------------------------------------------------------
    # Character → Markdown
    # ------------------------------------------------------------------

    def _character_to_markdown(self, char: Character) -> str:
        lines = []

        def h(level: int, text: str):
            lines.append(f"{'#' * level} {text}\n")

        def row(*cells):
            lines.append("| " + " | ".join(str(c) for c in cells) + " |")

        def divider(n: int):
            lines.append("|" + "|".join(["---"] * n) + "|")

        h(1, char.name)
        lines.append(
            f"**{char.race}{' (' + char.subrace + ')' if char.subrace else ''} "
            f"{char.character_class}{' (' + char.subclass + ')' if char.subclass else ''} "
            f"· Level {char.level}** · {char.background} · {char.alignment}\n"
        )

        h(2, "Appearance")
        lines.append(char.appearance + "\n")

        h(2, "Ability Scores")
        row("Ability", "Base", "Racial", "Other", "Total", "Modifier")
        divider(6)
        for name in ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"]:
            a = getattr(char.ability_scores, name)
            other = f"{_sign(a.other_bonus)} ({a.other_bonus_source})" if a.other_bonus else "—"
            row(
                name.upper()[:3], a.base,
                f"+{a.racial_bonus}" if a.racial_bonus else "—",
                other, f"**{a.total}**", f"**{_sign(a.modifier)}**",
            )
        lines.append("")

        h(2, "Core Stats")
        row("Stat", "Value", "Breakdown")
        divider(3)
        row("Armour Class", f"**{char.armor_class.total}**", " + ".join(
            f"{c.source} ({_sign(c.value) if c.type not in ('armor','base') else c.value})"
            for c in char.armor_class.components
        ))
        row("Hit Points (max)", f"**{char.hit_points.maximum}**", char.hit_points.formula)
        row("Hit Die", char.hit_points.hit_die, "")
        row("Speed", f"{char.speed} ft.", "")
        row("Initiative", f"**{_sign(char.initiative)}**", char.initiative_breakdown)
        row("Proficiency Bonus", f"**{_sign(char.proficiency_bonus)}**", f"Level {char.level}")
        row("Passive Perception", f"**{char.passive_perception}**", char.passive_perception_breakdown)
        lines.append("")
        if char.armor_class.notes:
            lines.append(f"> **Armour note:** {char.armor_class.notes}\n")

        h(2, "Saving Throws")
        row("Save", "Proficient", "Total", "Breakdown")
        divider(4)
        for name in ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"]:
            st = getattr(char.saving_throws, name)
            row(name.upper()[:3], "✓" if st.proficient else "—", f"**{_sign(st.total)}**", st.breakdown)
        lines.append("")

        h(2, "Skills")
        row("Skill", "Ability", "Prof", "Expertise", "Total", "Breakdown")
        divider(6)
        for name in [
            "acrobatics", "animal_handling", "arcana", "athletics", "deception",
            "history", "insight", "intimidation", "investigation", "medicine",
            "nature", "perception", "performance", "persuasion", "religion",
            "sleight_of_hand", "stealth", "survival",
        ]:
            sk = getattr(char.skills, name)
            row(
                name.replace("_", " ").title(), sk.ability,
                "✓" if sk.proficient else "—",
                "✓✓" if sk.expertise else "—",
                f"**{_sign(sk.total)}**", sk.breakdown,
            )
        lines.append("")

        h(2, "Attacks")
        row("Weapon", "Attack Bonus", "Breakdown", "Damage", "Bonus", "Damage Source", "Type", "Range", "Notes")
        divider(9)
        for atk in char.attacks:
            row(
                atk.name, f"**{_sign(atk.attack_bonus.total)}**", atk.attack_bonus.breakdown,
                atk.damage_dice, f"{_sign(atk.damage_bonus)}" if atk.damage_bonus else "—",
                atk.damage_bonus_source or "—", atk.damage_type, atk.range, atk.notes or "—",
            )
        lines.append("")

        if char.spellcasting:
            sp = char.spellcasting
            h(2, "Spellcasting")
            lines.append(
                f"**Ability:** {sp.ability} ({_sign(sp.ability_modifier)}) | "
                f"**Spell Attack:** {_sign(sp.spell_attack_bonus)} ({sp.spell_attack_breakdown}) | "
                f"**Save DC:** {sp.spell_save_dc} ({sp.spell_save_breakdown})\n"
            )
            slots = sp.spell_slots
            slot_data = [(i, getattr(slots, f"level_{i}")) for i in range(1, 10) if getattr(slots, f"level_{i}") > 0]
            if slot_data:
                h(3, "Spell Slots")
                row(*[f"Level {lvl}" for lvl, _ in slot_data])
                divider(len(slot_data))
                row(*[count for _, count in slot_data])
                lines.append("")
            if sp.cantrips:
                h(3, "Cantrips")
                for spell in sp.cantrips:
                    lines.append(f"**{spell.name}** ({spell.school}) — {spell.casting_time}, {spell.range}, {spell.duration}")
                    lines.append(f"> {spell.description}\n")
            if sp.spells_known:
                h(3, "Spells Known")
                cur = -1
                for spell in sorted(sp.spells_known, key=lambda s: s.level):
                    if spell.level != cur:
                        cur = spell.level
                        h(4, f"Level {spell.level}")
                    lines.append(f"**{spell.name}** ({spell.school}) — {spell.casting_time}, {spell.range}, {spell.duration}")
                    lines.append(f"> {spell.description}\n")

        h(2, "Features & Traits")
        for feat in char.features_and_traits:
            lines.append(f"### {feat.name} _{feat.source}_")
            lines.append(feat.description + "\n")

        h(2, "Proficiencies & Languages")
        if char.proficiencies.armor:
            lines.append(f"**Armour:** {', '.join(char.proficiencies.armor)}")
        if char.proficiencies.weapons:
            lines.append(f"**Weapons:** {', '.join(char.proficiencies.weapons)}")
        if char.proficiencies.tools:
            lines.append(f"**Tools:** {', '.join(char.proficiencies.tools)}")
        if char.proficiencies.languages:
            lines.append(f"**Languages:** {', '.join(char.proficiencies.languages)}")
        lines.append("")

        h(2, "Equipment")
        for item in char.equipment:
            lines.append(f"- {item}")
        lines.append("")

        h(2, "Personality")
        lines.append(f"**Traits:** {char.personality_traits}\n")
        lines.append(f"**Ideals:** {char.ideals}\n")
        lines.append(f"**Bonds:** {char.bonds}\n")
        lines.append(f"**Flaws:** {char.flaws}\n")

        h(2, "Backstory")
        lines.append(char.backstory + "\n")

        return "\n".join(lines)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def save_character(self, char: Character, folder_key: str = "npcs") -> str:
        await self._ensure_auth()

        folder_name = self.folder_names.get(folder_key, "NPCs")
        space_id = await self._get_first_space()
        folder_page_id = await self._get_or_create_folder_page(space_id, folder_name)

        content = self._character_to_markdown(char)
        page_id = await self._create_page(
            space_id=space_id,
            title=char.name,
            content=content,
            parent_page_id=folder_page_id,
        )

        # Append a one-line entry to the folder index page
        entry = (
            f"- **{char.name}** — "
            f"{char.race} {char.character_class} Level {char.level}, {char.alignment}\n"
        )
        try:
            await self._append_to_page(folder_page_id, entry)
        except Exception as e:
            logger.warning(f"Could not update folder index: {e}")

        logger.info(f"Saved '{char.name}' to Docmost (page {page_id})")
        return page_id
