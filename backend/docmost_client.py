# docmost_client.py
# REST client for Docmost (community edition) — handles all wiki sync for Niswins Tavern.
#
# Features:
#   - Authentication via POST /api/auth/login (JWT stored per session; re-authenticated lazily).
#   - Folder management: resolves configured folder URLs from settings or creates folders by name
#     under a parent page; caches folder page IDs to avoid repeated lookups.
#   - Page creation / update:
#       - Characters / NPCs  → NPCs folder (or sub-folder by type)
#       - Items              → Items / {item_type} sub-folder
#       - Shops              → Locations / Shops sub-folder
#       - Factions           → Factions / {faction_type} sub-folder
#   - Re-sync: uses operation:"replace" on existing pages so content is fully replaced in-place.
#   - Markdown rendering: each content type has its own _to_markdown() method producing structured
#     wiki pages with headings, stat blocks, tables, and flavour text.
#   - Two-way NPC linking:
#       - NPC pages gain a ## Faction section (with "View Faction in Docmost" link) when linked to
#         a faction, and a ## Shop section (with "View Shop in Docmost" link) when linked to a shop.
#       - Faction pages gain a ## Connected NPCs section listing every linked NPC with a link.
#       - Shop pages gain a ## Connected NPCs section listing shopkeeper and staff NPCs with links.
#   - Sync footer appended to every page showing the action (Created / Re-synced) and UTC timestamp.
#   - Note: Docmost page revision history is driven by the Y.js collaborative engine and is NOT
#     updated by REST API writes — API saves change content but do not create revision entries.
#
# Discovered API behaviour:
#   POST /api/auth/login       → sets authToken cookie (JWT)
#   POST /api/spaces           → lists spaces  { data: { items: [...] } }
#   POST /api/pages/create     → create page   { title, spaceId, parentPageId?, content, format }
#                                response includes data.slug and data.slugId for URL construction
#   POST /api/pages/update     → update page   { pageId, operation, content, format }
#   GET  /api/pages/:id        → fetch page    { data: { content, slug, slugId, ... } }
#
# Auth: Bearer token in Authorization header (extracted from authToken cookie after login).
#
# URL format: {base}/s/{space_slug}/p/{page_slug}
#   e.g. https://wiki.example.com/s/general/p/my-character-5A8xj8JFin

from __future__ import annotations

import json
import httpx
import yaml
import logging
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
from models import Character, Item, Shop, Faction, Monster, Location

_DEFAULT_FOLDER_NAMES: dict[str, str] = {
    "npcs": "NPCs",
    "bestiary": "Bestiary",
    "locations": "Locations",
    "encounters": "Encounters",
    "items": "Items",
    "factions": "Factions",
}

logger = logging.getLogger(__name__)

CONFIG_PATH = Path(__file__).parent.parent / "config.yaml"
# Persistent cache so folder page IDs survive process restarts
_FOLDER_CACHE_FILE = Path(__file__).parent.parent / "history" / ".folder_cache.json"


def _load_config() -> dict:
    with open(CONFIG_PATH) as f:
        return yaml.safe_load(f)


def _sign(n: int) -> str:
    return f"+{n}" if n >= 0 else str(n)


def _load_persistent_folder_cache() -> dict:
    if _FOLDER_CACHE_FILE.exists():
        try:
            return json.loads(_FOLDER_CACHE_FILE.read_text())
        except Exception:
            pass
    return {}


def _save_persistent_folder_cache(cache: dict) -> None:
    _FOLDER_CACHE_FILE.parent.mkdir(exist_ok=True)
    _FOLDER_CACHE_FILE.write_text(json.dumps(cache, indent=2))


class DocmostClient:
    def __init__(self):
        cfg = _load_config()["docmost"]
        self.base_url = cfg["url"].rstrip("/")
        self.username = cfg["username"]
        self.password = cfg["password"]
        # folder_urls: new format — values are Docmost page URLs (blank = auto-create)
        self.folder_urls: dict[str, str] = cfg.get("folder_urls", {})
        # _legacy_folder_names: old format — values are page titles to auto-create
        self._legacy_folder_names: dict[str, str] = cfg.get("folders", {})
        self._token: str | None = None
        self._space_id: str | None = None
        self._space_slug: str | None = None
        self._folder_cache: dict[str, str] = _load_persistent_folder_cache()

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

    async def _ensure_space(self) -> None:
        """Fetches and caches the first space's id and slug."""
        if self._space_id:
            return
        async with httpx.AsyncClient() as client:
            r = await client.post(f"{self.base_url}/spaces", json={}, headers=self._headers())
            r.raise_for_status()
            items = r.json().get("data", {}).get("items", [])
        if not items:
            raise RuntimeError("No spaces found in Docmost workspace")
        space = items[0]
        self._space_id = space["id"]
        self._space_slug = space.get("slug", "general")
        logger.info(f"Using Docmost space: {space['name']} ({self._space_id}, slug={self._space_slug})")

    # ------------------------------------------------------------------
    # Pages
    # ------------------------------------------------------------------

    async def _get_page(self, page_id: str) -> dict:
        async with httpx.AsyncClient() as client:
            r = await client.get(f"{self.base_url}/pages/{page_id}", headers=self._headers())
            r.raise_for_status()
            return r.json().get("data", r.json())

    async def _page_exists(self, page_id: str) -> bool:
        """Check a cached folder page_id is still valid."""
        try:
            async with httpx.AsyncClient() as client:
                r = await client.get(f"{self.base_url}/pages/{page_id}", headers=self._headers())
                return r.status_code == 200
        except Exception:
            return False

    async def _create_page(
        self,
        space_id: str,
        title: str,
        content: str,
        parent_page_id: str | None = None,
    ) -> dict:
        """Create a page and return the full data dict (includes id, slug, slugId)."""
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
            return r.json()["data"]

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

    async def _replace_page(self, page_id: str, title: str, markdown: str) -> str:
        """Replace page content and title. Returns the page URL slug."""
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{self.base_url}/pages/update",
                json={
                    "pageId": page_id,
                    "title": title,
                    "operation": "replace",
                    "content": markdown,
                    "format": "markdown",
                },
                headers=self._headers(),
            )
            r.raise_for_status()
            data = r.json().get("data", {})
            return data.get("slug") or data.get("slugId") or page_id

    # ------------------------------------------------------------------
    # Folder pages (top-level parent pages acting as folders)
    # ------------------------------------------------------------------

    async def _get_or_create_folder_page(
        self, space_id: str, title: str, parent_page_id: str | None = None
    ) -> str:
        # Keep root-level key format backward compatible with existing cache entries
        cache_key = f"{space_id}:{parent_page_id}:{title}" if parent_page_id else f"{space_id}:{title}"

        if cache_key in self._folder_cache:
            cached_id = self._folder_cache[cache_key]
            if await self._page_exists(cached_id):
                return cached_id
            del self._folder_cache[cache_key]
            _save_persistent_folder_cache(self._folder_cache)
            logger.warning(f"Cached folder page {cached_id} no longer exists, recreating")

        page_data = await self._create_page(
            space_id=space_id,
            title=title,
            content=f"# {title}\n\n",
            parent_page_id=parent_page_id,
        )
        folder_id = page_data["id"]
        self._folder_cache[cache_key] = folder_id
        _save_persistent_folder_cache(self._folder_cache)
        logger.info(f"Created folder page: {title} ({folder_id})")
        return folder_id

    # ------------------------------------------------------------------
    # URL-based folder resolution
    # ------------------------------------------------------------------

    async def resolve_page_url(self, url: str) -> tuple[str, str]:
        """Resolve a Docmost page URL to (page_id, page_title). Raises ValueError on failure.

        URL format: {base}/s/{space_slug}/p/{page_slug}
        Uses POST /search and matches results by slugId (the unique suffix in the URL slug).
        """
        parsed = urlparse(url)
        parts = [p for p in parsed.path.split("/") if p]
        try:
            page_slug = parts[parts.index("p") + 1]
        except (ValueError, IndexError):
            raise ValueError(
                f"Cannot parse page slug from URL: {url!r}\n"
                "Expected format: https://your-wiki/s/{space}/p/{page-slug}"
            )

        # The URL slug is like "my-page-title-AbCdEfGhIj" — the last segment is the unique slugId
        if "-" in page_slug:
            slug_id = page_slug.rsplit("-", 1)[1]
            title_hint = page_slug.rsplit("-", 1)[0].replace("-", " ")
        else:
            slug_id = page_slug
            title_hint = page_slug

        await self._ensure_auth()
        await self._ensure_space()

        async with httpx.AsyncClient() as client:
            # Search by title hint first, then by slugId as fallback.
            # Match whichever result has the right slugId — it's unique per page.
            for query in [title_hint, slug_id]:
                try:
                    r = await client.post(
                        f"{self.base_url}/search",
                        json={"query": query, "spaceId": self._space_id},
                        headers=self._headers(),
                        timeout=10.0,
                    )
                    if r.status_code == 200:
                        for item in r.json().get("data", {}).get("items", []):
                            if item.get("slugId") == slug_id:
                                return item["id"], item.get("title", page_slug)
                except Exception:
                    pass

        raise ValueError(
            f"Could not find page with slug ID '{slug_id}' in your Docmost space.\n"
            "Make sure the URL is correct and your service account has access to the page."
        )

    async def _get_root_folder_page_id(self, folder_key: str) -> str:
        """Get the parent page ID for a folder key.

        If a URL is configured, resolves and caches it.
        Otherwise falls back to auto-creating a folder page.
        """
        url = self.folder_urls.get(folder_key, "").strip()

        if url:
            cache_key = f"url:{url}"
            if cache_key in self._folder_cache:
                cached_id = self._folder_cache[cache_key]
                if await self._page_exists(cached_id):
                    return cached_id
                del self._folder_cache[cache_key]
                _save_persistent_folder_cache(self._folder_cache)

            page_id, title = await self.resolve_page_url(url)
            self._folder_cache[cache_key] = page_id
            _save_persistent_folder_cache(self._folder_cache)
            logger.info(f"Resolved {folder_key!r} folder URL → page {page_id!r} ({title!r})")
            return page_id

        # No URL — auto-create with legacy name from config or default
        title = (
            self._legacy_folder_names.get(folder_key)
            or _DEFAULT_FOLDER_NAMES.get(folder_key, folder_key.title())
        )
        return await self._get_or_create_folder_page(self._space_id, title)

    # ------------------------------------------------------------------
    # Character → Markdown
    # ------------------------------------------------------------------

    def _character_to_markdown(self, char: Character, faction_affiliation: dict | None = None, shop_affiliation: dict | None = None) -> str:
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

        if faction_affiliation:
            h(2, "Faction")
            lines.append(f"**{faction_affiliation['faction_name']}** — {faction_affiliation['member_role']}\n")
            if faction_affiliation.get("faction_url"):
                lines.append(f"[View Faction in Docmost]({faction_affiliation['faction_url']})\n")

        if shop_affiliation:
            h(2, "Shop")
            lines.append(f"**{shop_affiliation['shop_name']}** — {shop_affiliation['member_role']}\n")
            if shop_affiliation.get("shop_url"):
                lines.append(f"[View Shop in Docmost]({shop_affiliation['shop_url']})\n")

        return "\n".join(lines)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def _build_page_url(self, page_slug: str) -> str:
        base = self.base_url
        if base.endswith("/api"):
            base = base[:-4]
        return f"{base}/s/{self._space_slug}/p/{page_slug}"

    @staticmethod
    def _sync_footer(action: str = "Synced") -> str:
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        return f"\n\n---\n*{action} via Niswins Tavern · {ts}*\n"

    async def save_character(self, char: Character, folder_key: str = "npcs", existing_page_id: str | None = None, faction_affiliation: dict | None = None, shop_affiliation: dict | None = None) -> tuple[str, str]:
        """Returns (page_id, page_url). Updates existing page if existing_page_id is provided."""
        await self._ensure_auth()
        await self._ensure_space()

        if existing_page_id:
            content = self._character_to_markdown(char, faction_affiliation, shop_affiliation) + self._sync_footer("Re-synced")
            page_slug = await self._replace_page(existing_page_id, char.name, content)
            page_url = self._build_page_url(page_slug)
            logger.info(f"Updated '{char.name}' in Docmost (page {existing_page_id})")
            return existing_page_id, page_url

        content = self._character_to_markdown(char, faction_affiliation, shop_affiliation) + self._sync_footer("Created")
        folder_page_id = await self._get_root_folder_page_id(folder_key)
        page_data = await self._create_page(
            space_id=self._space_id,
            title=char.name,
            content=content,
            parent_page_id=folder_page_id,
        )
        page_id = page_data["id"]
        page_slug = page_data.get("slug") or page_data.get("slugId") or page_id
        page_url = self._build_page_url(page_slug)

        entry = (
            f"- [**{char.name}**]({page_url}) — "
            f"{char.race} {char.character_class} Level {char.level}, {char.alignment}\n"
        )
        try:
            await self._append_to_page(folder_page_id, entry)
        except Exception as e:
            logger.warning(f"Could not update folder index: {e}")

        logger.info(f"Saved '{char.name}' to Docmost (page {page_id}, url={page_url})")
        return page_id, page_url

    # ------------------------------------------------------------------
    # Item → Markdown
    # ------------------------------------------------------------------

    def _item_to_markdown(self, item: Item) -> str:
        lines = []

        def h(level: int, text: str):
            lines.append(f"{'#' * level} {text}\n")

        h(1, item.name)

        attune_note = ""
        if item.requires_attunement:
            attune_note = " · Requires Attunement"
            if item.attunement_by:
                attune_note += f" by {item.attunement_by}"

        lines.append(
            f"**{item.item_type}** · **{item.rarity}** · "
            f"Target Level {item.target_level_min}–{item.target_level_max}{attune_note}\n"
        )

        h(2, "Description")
        lines.append(item.description + "\n")

        h(2, "Lore")
        lines.append(item.lore + "\n")

        if item.bonuses:
            h(2, "Bonuses")
            for b in item.bonuses:
                sign = "+" if b.value >= 0 else ""
                lines.append(f"- **{b.stat}:** {sign}{b.value}")
            lines.append("")

        if item.abilities:
            h(2, "Magical Abilities")
            for a in item.abilities:
                h(3, a.name)
                activation = f" · *{a.activation}*" if a.activation and a.activation not in ("Passive", "None") else ""
                lines.append(f"*{a.usage}*{activation}\n")
                lines.append(a.description + "\n")

        details = []
        if item.weight_lbs is not None:
            details.append(f"**Weight:** {item.weight_lbs} lbs")
        if item.value_gp is not None:
            details.append(f"**Value:** {item.value_gp:,} gp")
        if details:
            h(2, "Details")
            for d in details:
                lines.append(d)
            lines.append("")

        return "\n".join(lines)

    # ------------------------------------------------------------------
    # Shop → Markdown
    # ------------------------------------------------------------------

    def _shop_to_markdown(self, shop: Shop, linked_npcs: list | None = None) -> str:
        lines = []

        def h(level: int, text: str):
            lines.append(f"{'#' * level} {text}\n")

        h(1, shop.name)
        lines.append(
            f"**{shop.category}** · **{shop.shop_type.title()}**"
            + (f"\n\n*{shop.atmosphere}*" if shop.atmosphere else "")
            + "\n"
        )

        h(2, "About the Shop")
        lines.append(shop.description + "\n")

        h(2, "The Shopkeeper")
        sk = shop.shopkeeper
        gender_note = f" ({sk.gender})" if sk.gender else ""
        lines.append(f"**{sk.name}** — {sk.race}{gender_note} {sk.character_class}\n")
        lines.append(sk.appearance + "\n")
        lines.append(sk.personality + "\n")
        if sk.motivation:
            lines.append(f"*{sk.motivation}*\n")

        if shop.staff:
            h(2, "Staff")
            for member in shop.staff:
                lines.append(f"**{member.name}** — {member.role}\n")
                lines.append(f"{member.description}\n")

        h(2, "Stock")

        regular = [i for i in shop.items if not i.is_under_table]
        under = [i for i in shop.items if i.is_under_table]

        def _item_block(item):
            rarity_str = item.rarity
            price_str = f"{item.price_gp:,} gp" if item.price_gp is not None else "price varies"
            h(3, item.name)
            lines.append(f"**{item.item_type}** · {rarity_str} · {price_str}\n")
            lines.append(item.description + "\n")

        for item in regular:
            _item_block(item)

        if under:
            h(2, "Under the Table")
            lines.append("*These items are not openly displayed. The shopkeeper may deny having them.*\n")
            for item in under:
                _item_block(item)

        if linked_npcs:
            h(2, "Connected NPCs")
            for npc in linked_npcs:
                name = npc.get("npc_name", "Unknown")
                role = npc.get("member_role", "")
                url = npc.get("npc_docmost_url", "")
                line = f"**{name}** — {role}"
                if url:
                    line += f"  [View in Docmost]({url})"
                lines.append(line + "\n")

        return "\n".join(lines)

    def reload_config(self) -> None:
        """Re-read config.yaml and reset auth state so the next request re-authenticates."""
        cfg = _load_config()["docmost"]
        self.base_url = cfg["url"].rstrip("/")
        self.username = cfg["username"]
        self.password = cfg["password"]
        self.folder_urls = cfg.get("folder_urls", {})
        self._legacy_folder_names = cfg.get("folders", {})
        self._token = None
        self._space_id = None
        self._space_slug = None
        logger.info("DocmostClient config reloaded")

    async def save_item(self, item: Item, existing_page_id: str | None = None) -> tuple[str, str]:
        """Returns (page_id, page_url). Updates existing page if existing_page_id is provided."""
        await self._ensure_auth()
        await self._ensure_space()

        if existing_page_id:
            content = self._item_to_markdown(item) + self._sync_footer("Re-synced")
            page_slug = await self._replace_page(existing_page_id, item.name, content)
            page_url = self._build_page_url(page_slug)
            logger.info(f"Updated item '{item.name}' in Docmost (page {existing_page_id})")
            return existing_page_id, page_url

        content = self._item_to_markdown(item) + self._sync_footer("Created")
        items_root_id = await self._get_root_folder_page_id("items")
        type_folder_id = await self._get_or_create_folder_page(
            self._space_id, item.item_type, parent_page_id=items_root_id
        )
        page_data = await self._create_page(
            space_id=self._space_id,
            title=item.name,
            content=content,
            parent_page_id=type_folder_id,
        )
        page_id = page_data["id"]
        page_slug = page_data.get("slug") or page_data.get("slugId") or page_id
        page_url = self._build_page_url(page_slug)

        entry = (
            f"- [**{item.name}**]({page_url}) — {item.rarity} · "
            f"Levels {item.target_level_min}–{item.target_level_max}\n"
        )
        try:
            await self._append_to_page(type_folder_id, entry)
        except Exception as e:
            logger.warning(f"Could not update item folder index: {e}")

        logger.info(f"Saved item '{item.name}' to Docmost (page {page_id}, url={page_url})")
        return page_id, page_url

    async def save_shop(self, shop: Shop, existing_page_id: str | None = None, linked_npcs: list | None = None) -> tuple[str, str]:
        """Returns (page_id, page_url). Updates existing page if existing_page_id is provided."""
        await self._ensure_auth()
        await self._ensure_space()

        if existing_page_id:
            content = self._shop_to_markdown(shop, linked_npcs) + self._sync_footer("Re-synced")
            page_slug = await self._replace_page(existing_page_id, shop.name, content)
            page_url = self._build_page_url(page_slug)
            logger.info(f"Updated shop '{shop.name}' in Docmost (page {existing_page_id})")
            return existing_page_id, page_url

        content = self._shop_to_markdown(shop, linked_npcs) + self._sync_footer("Created")
        locations_root_id = await self._get_root_folder_page_id("locations")
        shops_folder_id = await self._get_or_create_folder_page(
            self._space_id, "Shops", parent_page_id=locations_root_id
        )
        page_data = await self._create_page(
            space_id=self._space_id,
            title=shop.name,
            content=content,
            parent_page_id=shops_folder_id,
        )
        page_id = page_data["id"]
        page_slug = page_data.get("slug") or page_data.get("slugId") or page_id
        page_url = self._build_page_url(page_slug)

        entry = (
            f"- [**{shop.name}**]({page_url}) — {shop.category} {shop.shop_type}, "
            f"{len(shop.items)} items, run by {shop.shopkeeper.name}\n"
        )
        try:
            await self._append_to_page(shops_folder_id, entry)
        except Exception as e:
            logger.warning(f"Could not update shops index: {e}")

        logger.info(f"Saved shop '{shop.name}' to Docmost (page {page_id}, url={page_url})")
        return page_id, page_url

    # ------------------------------------------------------------------
    # Faction → Markdown
    # ------------------------------------------------------------------

    def _faction_to_markdown(self, faction: Faction, linked_npcs: list | None = None) -> str:
        lines = []

        def h(level: int, text: str):
            lines.append(f"{'#' * level} {text}\n")

        h(1, faction.name)
        lines.append(
            f"**{faction.faction_type}** · **{faction.size}** · **{faction.alignment}** · "
            f"{faction.wealth} · {faction.public_reputation}\n"
        )
        lines.append(f"*\"{faction.motto}\"*\n")

        h(2, "Overview")
        lines.append(faction.overview + "\n")

        h(2, "History")
        lines.append(faction.history + "\n")

        h(2, "Goals")
        for g in faction.goals:
            lines.append(f"- {g}")
        lines.append("")

        h(2, "Methods")
        for m in faction.methods:
            lines.append(f"- {m}")
        lines.append("")

        h(2, "Leadership")
        h(3, f"{faction.leader.name} — {faction.leader.title}")
        lines.append(f"*{faction.leader.race}*\n")
        lines.append(faction.leader.description + "\n")

        if faction.notable_members:
            h(3, "Notable Members")
            for member in faction.notable_members:
                lines.append(f"**{member.name}** ({member.role}): {member.description}")
            lines.append("")

        h(2, "Intelligence")
        lines.append(f"**Headquarters:** {faction.headquarters}\n")
        lines.append(f"**Symbols:** {faction.symbols}\n")
        if faction.allies:
            lines.append(f"**Allies:** {', '.join(faction.allies)}\n")
        if faction.enemies:
            lines.append(f"**Enemies:** {', '.join(faction.enemies)}\n")

        h(2, "Secrets (DM Only)")
        for s in faction.secrets:
            lines.append(f"- {s}")
        lines.append("")

        if linked_npcs:
            h(2, "Connected NPCs")
            for npc in linked_npcs:
                lines.append(f"**{npc['npc_name']}** — {npc['member_role']}")
                lines.append(f"[View in Docmost]({npc['npc_docmost_url']})\n")

        return "\n".join(lines)

    async def save_faction(self, faction: Faction, existing_page_id: str | None = None, linked_npcs: list | None = None) -> tuple[str, str]:
        """Returns (page_id, page_url). Saves under Factions / {type} / {name}."""
        await self._ensure_auth()
        await self._ensure_space()

        if existing_page_id:
            content = self._faction_to_markdown(faction, linked_npcs) + self._sync_footer("Re-synced")
            page_slug = await self._replace_page(existing_page_id, faction.name, content)
            page_url = self._build_page_url(page_slug)
            logger.info(f"Updated faction '{faction.name}' in Docmost (page {existing_page_id})")
            return existing_page_id, page_url

        content = self._faction_to_markdown(faction, linked_npcs) + self._sync_footer("Created")
        factions_root_id = await self._get_root_folder_page_id("factions")
        type_folder_id = await self._get_or_create_folder_page(
            self._space_id, faction.faction_type, parent_page_id=factions_root_id
        )
        page_data = await self._create_page(
            space_id=self._space_id,
            title=faction.name,
            content=content,
            parent_page_id=type_folder_id,
        )
        page_id = page_data["id"]
        page_slug = page_data.get("slug") or page_data.get("slugId") or page_id
        page_url = self._build_page_url(page_slug)

        entry = (
            f"- [**{faction.name}**]({page_url}) — {faction.size} {faction.faction_type}, "
            f"{faction.alignment}, led by {faction.leader.name}\n"
        )
        try:
            await self._append_to_page(type_folder_id, entry)
        except Exception as e:
            logger.warning(f"Could not update faction type index: {e}")

        logger.info(f"Saved faction '{faction.name}' to Docmost (page {page_id}, url={page_url})")
        return page_id, page_url

    # ------------------------------------------------------------------
    # Monster → Markdown
    # ------------------------------------------------------------------

    def _monster_to_markdown(self, monster: Monster) -> str:
        lines = []

        def h(level: int, text: str):
            lines.append(f"{'#' * level} {text}\n")

        def sign(n: int) -> str:
            return f"+{n}" if n >= 0 else str(n)

        h(1, monster.name)
        subtype_str = f" ({monster.subtype})" if monster.subtype else ""
        lines.append(f"*{monster.size} {monster.monster_type}{subtype_str}, {monster.alignment}*\n")

        lines.append("---\n")

        # Core stats line
        speed = monster.speed
        speed_parts = []
        if speed.walk:
            speed_parts.append(f"{speed.walk} ft.")
        if speed.fly:
            hover_note = " (hover)" if speed.hover else ""
            speed_parts.append(f"fly {speed.fly} ft.{hover_note}")
        if speed.swim:
            speed_parts.append(f"swim {speed.swim} ft.")
        if speed.burrow:
            speed_parts.append(f"burrow {speed.burrow} ft.")
        if speed.climb:
            speed_parts.append(f"climb {speed.climb} ft.")
        speed_str = ", ".join(speed_parts) or "0 ft."

        ac_str = str(monster.armor_class)
        if monster.armor_type:
            ac_str += f" ({monster.armor_type})"

        lines.append(
            f"**Armor Class** {ac_str} · "
            f"**Hit Points** {monster.hit_points} ({monster.hit_dice}) · "
            f"**Speed** {speed_str}\n"
        )

        lines.append("---\n")

        # Ability scores table
        ability_names = ["STR", "DEX", "CON", "INT", "WIS", "CHA"]
        ability_keys = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"]
        lines.append("| " + " | ".join(ability_names) + " |")
        lines.append("|" + "|".join(["---"] * 6) + "|")
        scores = []
        for key in ability_keys:
            ab = getattr(monster.ability_scores, key)
            scores.append(f"{ab.score} ({sign(ab.modifier)})")
        lines.append("| " + " | ".join(scores) + " |")
        lines.append("")

        lines.append("---\n")

        # Properties
        if monster.saving_throws:
            saves = ", ".join(
                f"{k.capitalize()[:3]} {sign(v)}" for k, v in monster.saving_throws.items()
            )
            lines.append(f"**Saving Throws** {saves}")
        if monster.skills:
            skills = ", ".join(
                f"{k.replace('_', ' ').title()} {sign(v)}" for k, v in monster.skills.items()
            )
            lines.append(f"**Skills** {skills}")
        if monster.damage_vulnerabilities:
            lines.append(f"**Damage Vulnerabilities** {', '.join(monster.damage_vulnerabilities)}")
        if monster.damage_resistances:
            lines.append(f"**Damage Resistances** {', '.join(monster.damage_resistances)}")
        if monster.damage_immunities:
            lines.append(f"**Damage Immunities** {', '.join(monster.damage_immunities)}")
        if monster.condition_immunities:
            lines.append(f"**Condition Immunities** {', '.join(monster.condition_immunities)}")
        if monster.senses:
            lines.append(f"**Senses** {', '.join(monster.senses)}, passive Perception {monster.passive_perception}")
        else:
            lines.append(f"**Senses** passive Perception {monster.passive_perception}")
        if monster.languages:
            lines.append(f"**Languages** {', '.join(monster.languages)}")
        else:
            lines.append("**Languages** —")
        lines.append(
            f"**Challenge** {monster.challenge_rating} ({monster.xp:,} XP) · "
            f"**Proficiency Bonus** {sign(monster.proficiency_bonus)}"
        )
        lines.append("")

        lines.append("---\n")

        # Special traits
        if monster.special_traits:
            for trait in monster.special_traits:
                lines.append(f"***{trait.name}.*** {trait.description}\n")

        # Actions
        if monster.actions:
            h(2, "Actions")
            for action in monster.actions:
                lines.append(f"***{action.name}.*** {action.description}\n")

        # Bonus Actions
        if monster.bonus_actions:
            h(2, "Bonus Actions")
            for ba in monster.bonus_actions:
                lines.append(f"***{ba.name}.*** {ba.description}\n")

        # Reactions
        if monster.reactions:
            h(2, "Reactions")
            for reaction in monster.reactions:
                lines.append(f"***{reaction.name}.*** {reaction.description}\n")

        # Legendary Actions
        if monster.legendary_actions:
            h(2, "Legendary Actions")
            if monster.legendary_resistance_count:
                lines.append(
                    f"The {monster.name} can take {len(monster.legendary_actions)} legendary actions, "
                    f"choosing from the options below. Only one legendary action option can be used at a time "
                    f"and only at the end of another creature's turn. The {monster.name} regains spent legendary "
                    f"actions at the start of its turn.\n"
                )
            for la in monster.legendary_actions:
                cost_str = f" (Costs {la.cost} Actions)" if la.cost > 1 else ""
                lines.append(f"***{la.name}{cost_str}.*** {la.description}\n")

        # Lair Actions
        if monster.lair_actions:
            h(2, "Lair Actions")
            for la in monster.lair_actions:
                lines.append(f"***{la.name}.*** {la.description}\n")

        # Flavor sections
        if monster.description:
            h(2, "Description")
            lines.append(monster.description + "\n")

        if monster.ecology:
            h(2, "Ecology")
            lines.append(monster.ecology + "\n")

        if monster.tactics:
            h(2, "Tactics")
            lines.append(monster.tactics + "\n")

        if monster.lore:
            h(2, "Lore")
            lines.append(monster.lore + "\n")

        return "\n".join(lines)

    async def save_monster(self, monster: Monster, existing_page_id: str | None = None) -> tuple[str, str]:
        """Returns (page_id, page_url). Saves under Bestiary / {monster_type} / {name}."""
        await self._ensure_auth()
        await self._ensure_space()

        if existing_page_id:
            content = self._monster_to_markdown(monster) + self._sync_footer("Re-synced")
            page_slug = await self._replace_page(existing_page_id, monster.name, content)
            page_url = self._build_page_url(page_slug)
            logger.info(f"Updated monster '{monster.name}' in Docmost (page {existing_page_id})")
            return existing_page_id, page_url

        content = self._monster_to_markdown(monster) + self._sync_footer("Created")
        bestiary_root_id = await self._get_root_folder_page_id("bestiary")
        type_folder_id = await self._get_or_create_folder_page(
            self._space_id, monster.monster_type, parent_page_id=bestiary_root_id
        )
        page_data = await self._create_page(
            space_id=self._space_id,
            title=monster.name,
            content=content,
            parent_page_id=type_folder_id,
        )
        page_id = page_data["id"]
        page_slug = page_data.get("slug") or page_data.get("slugId") or page_id
        page_url = self._build_page_url(page_slug)

        entry = f"- [**{monster.name}**]({page_url}) — CR {monster.challenge_rating} {monster.size} {monster.monster_type}\n"
        try:
            await self._append_to_page(type_folder_id, entry)
        except Exception as e:
            logger.warning(f"Could not update bestiary type index: {e}")

        logger.info(f"Saved monster '{monster.name}' to Docmost (page {page_id}, url={page_url})")
        return page_id, page_url

    # ------------------------------------------------------------------
    # Location → Markdown
    # ------------------------------------------------------------------

    def _location_to_markdown(
        self,
        loc: Location,
        parent_location: dict | None = None,
        child_locations: list | None = None,
    ) -> str:
        lines = []

        def h(level: int, text: str):
            lines.append(f"{'#' * level} {text}\n")

        h(1, loc.name)

        # Subtitle line
        meta_parts = [f"**{loc.location_type}**"]
        if loc.climate:
            meta_parts.append(loc.climate)
        if loc.terrain:
            meta_parts.append(loc.terrain)
        if loc.population:
            meta_parts.append(f"Pop. {loc.population}")
        if loc.building_type:
            meta_parts.append(loc.building_type)
        lines.append(" · ".join(meta_parts) + "\n")

        if loc.atmosphere:
            lines.append(f"*{loc.atmosphere}*\n")

        # Core stats band
        stats = []
        if loc.government:
            stats.append(f"**Government:** {loc.government}")
        if loc.economy:
            stats.append(f"**Economy:** {loc.economy}")
        if loc.dominant_culture:
            stats.append(f"**Culture:** {loc.dominant_culture}")
        if loc.condition:
            stats.append(f"**Condition:** {loc.condition}")
        if loc.owner:
            stats.append(f"**Run by:** {loc.owner}")
        for s in stats:
            lines.append(s)
        if stats:
            lines.append("")

        h(2, "Description")
        lines.append(loc.description + "\n")

        if loc.history:
            h(2, "History")
            lines.append(loc.history + "\n")

        if loc.notable_features:
            h(2, "Notable Features")
            for f in loc.notable_features:
                lines.append(f"- {f}")
            lines.append("")

        if loc.notable_npcs:
            h(2, "Notable People")
            for npc in loc.notable_npcs:
                lines.append(f"**{npc.name}** — {npc.role}")
                if npc.concept:
                    lines.append(f"*{npc.concept}*")
                lines.append("")

        if loc.factions:
            h(2, "Power Groups & Factions")
            for f in loc.factions:
                lines.append(f"- {f}")
            lines.append("")

        if loc.plot_hooks:
            h(2, "Plot Hooks")
            for hook in loc.plot_hooks:
                lines.append(f"- {hook}")
            lines.append("")

        if loc.secrets:
            h(2, "Secrets (DM Only)")
            for s in loc.secrets:
                lines.append(f"- {s}")
            lines.append("")

        if parent_location:
            h(2, "Part Of")
            name = parent_location.get("name", "Unknown")
            loc_type = parent_location.get("type", "")
            url = parent_location.get("docmost_url", "")
            line = f"**{name}**" + (f" ({loc_type})" if loc_type else "")
            if url:
                line += f"  [View in Docmost]({url})"
            lines.append(line + "\n")

        if child_locations:
            h(2, "Contains")
            for child in child_locations:
                cname = child.get("name", "Unknown")
                ctype = child.get("type", "")
                curl = child.get("docmost_url", "")
                line = f"**{cname}**" + (f" ({ctype})" if ctype else "")
                if curl:
                    line += f"  [View in Docmost]({curl})"
                lines.append(line + "\n")

        return "\n".join(lines)

    async def save_location(
        self,
        loc: Location,
        existing_page_id: str | None = None,
        parent_location: dict | None = None,
        child_locations: list | None = None,
    ) -> tuple[str, str]:
        """Returns (page_id, page_url). Saves under Locations / {type} / {name}."""
        await self._ensure_auth()
        await self._ensure_space()

        if existing_page_id:
            content = (
                self._location_to_markdown(loc, parent_location, child_locations)
                + self._sync_footer("Re-synced")
            )
            page_slug = await self._replace_page(existing_page_id, loc.name, content)
            page_url = self._build_page_url(page_slug)
            logger.info(f"Updated location '{loc.name}' in Docmost (page {existing_page_id})")
            return existing_page_id, page_url

        content = (
            self._location_to_markdown(loc, parent_location, child_locations)
            + self._sync_footer("Created")
        )
        locations_root_id = await self._get_root_folder_page_id("locations")
        type_folder_id = await self._get_or_create_folder_page(
            self._space_id, loc.location_type, parent_page_id=locations_root_id
        )
        page_data = await self._create_page(
            space_id=self._space_id,
            title=loc.name,
            content=content,
            parent_page_id=type_folder_id,
        )
        page_id = page_data["id"]
        page_slug = page_data.get("slug") or page_data.get("slugId") or page_id
        page_url = self._build_page_url(page_slug)

        entry = f"- [**{loc.name}**]({page_url}) — {loc.location_type}"
        if loc.population:
            entry += f", pop. {loc.population}"
        if loc.atmosphere:
            entry += f". {loc.atmosphere}"
        entry += "\n"
        try:
            await self._append_to_page(type_folder_id, entry)
        except Exception as e:
            logger.warning(f"Could not update location type index: {e}")

        logger.info(f"Saved location '{loc.name}' to Docmost (page {page_id}, url={page_url})")
        return page_id, page_url
