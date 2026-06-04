# main.py
# FastAPI application — the single backend entry point for Niswins Tavern.
#
# API routes:
#   GET  /api/config                         — folder list for the save-folder dropdowns
#   GET  /api/settings                       — read current settings from config.yaml / .env
#   POST /api/settings                       — write settings; reloads Docmost client config
#   POST /api/test-page-url                  — validates a Docmost folder URL via live fetch
#
#   POST /api/generate                       — generate a Character or Generic NPC via Claude
#   POST /api/save                           — save character/NPC to Docmost and history
#
#   POST /api/generate-item                  — generate a magic item via Claude
#   POST /api/save-item                      — save item to Docmost and history
#
#   POST /api/generate-shop                  — generate a shop (with shopkeeper and stock) via Claude
#   POST /api/save-shop                      — save shop to Docmost and history (preserves linked NPCs)
#   POST /api/shop/{id}/link-npc             — two-way link: adds NPC to shop's Connected NPCs section
#                                              and adds Shop section to NPC page
#   POST /api/shop/{id}/regenerate-staff     — generate a new shopkeeper or staff member via Claude
#
#   POST /api/generate-faction               — generate a faction via Claude
#   POST /api/save-faction                   — save faction to Docmost and history (preserves linked NPCs)
#   POST /api/faction/{id}/link-npc          — two-way link: adds NPC to faction's Connected NPCs section
#                                              and adds Faction section to NPC page
#   POST /api/faction/{id}/regenerate-member — generate a new leader or notable member via Claude
#
#   GET  /api/history                        — list all history entries (lightweight, data blobs stripped)
#   GET  /api/history/{id}                   — fetch a single history entry with full data
#   POST /api/history/{id}/update            — patch fields on a history entry (used for in-place edits)
#
#   GET  /api/players                        — list history entries of type "Player Character"
#
# Static files: the /frontend directory is served at / with index.html as the fallback.

import os
import json
import yaml
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from models import GenerateRequest, SaveRequest, Character, GenerateItemRequest, SaveItemRequest, GenerateShopRequest, SaveShopRequest, LinkShopNpcRequest, RegenerateShopStaffRequest, SettingsUpdate, TestPageUrlRequest, UpdateEntryRequest, GenerateFactionRequest, SaveFactionRequest, LinkFactionNpcRequest, RegenerateMemberRequest, set_validation_limits
from character_generator import generate_character
from item_generator import generate_item
from shop_generator import generate_shop, generate_shop_staff
from faction_generator import generate_faction, generate_faction_member
from docmost_client import DocmostClient
import history_store

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
CONFIG_PATH = Path(__file__).parent.parent / "config.yaml"
TOKEN_STATS_PATH = Path(__file__).parent.parent / "token_stats.json"


def _load_token_stats() -> dict:
    if TOKEN_STATS_PATH.exists():
        try:
            return json.loads(TOKEN_STATS_PATH.read_text())
        except Exception:
            pass
    return {"all_time": {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0, "cost_usd": 0.0}, "monthly": {}}


def _update_token_stats(usage: dict) -> None:
    stats = _load_token_stats()
    month_key = datetime.now(timezone.utc).strftime("%Y-%m")
    for bucket in [stats["all_time"], stats["monthly"].setdefault(month_key, {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0, "cost_usd": 0.0})]:
        bucket["input_tokens"] += usage.get("input_tokens", 0)
        bucket["output_tokens"] += usage.get("output_tokens", 0)
        bucket["total_tokens"] += usage.get("total_tokens", 0)
        bucket["cost_usd"] = round(bucket["cost_usd"] + usage.get("cost_usd", 0.0), 6)
    TOKEN_STATS_PATH.write_text(json.dumps(stats, indent=2))


def _ensure_config_files() -> None:
    """Create config.yaml with defaults on first run if it doesn't exist."""
    if not CONFIG_PATH.exists():
        default_cfg = {
            "anthropic": {"api_key": ""},
            "validation": {
                "max_concept_length": 1000,
                "max_notes_length": 500,
                "max_character_level": 20,
                "max_shop_items": 20,
            },
            "docmost": {
                "url": "",
                "username": "",
                "password": "",
                "folder_urls": {
                    "npcs": "",
                    "bestiary": "",
                    "locations": "",
                    "encounters": "",
                    "items": "",
                    "factions": "",
                },
            },
            "claude": {"model": "claude-sonnet-4-6"},
        }
        with open(CONFIG_PATH, "w") as f:
            yaml.dump(default_cfg, f, default_flow_style=False, allow_unicode=True)
    else:
        # One-time migration: if api_key missing from config but .env exists, copy it over
        cfg = yaml.safe_load(CONFIG_PATH.read_text()) or {}
        if not cfg.get("anthropic", {}).get("api_key"):
            env_path = CONFIG_PATH.parent / ".env"
            if env_path.exists():
                api_key = _parse_env_file(env_path).get("ANTHROPIC_API_KEY", "")
                if api_key:
                    cfg.setdefault("anthropic", {})["api_key"] = api_key
                    with open(CONFIG_PATH, "w") as f:
                        yaml.dump(cfg, f, default_flow_style=False, allow_unicode=True)


def _parse_env_file(path: Path) -> dict:
    vals = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            vals[k.strip()] = v.strip().strip("'\"")
    return vals


def _load_api_key_from_config() -> None:
    """Read api_key from config.yaml and expose it as an environment variable."""
    cfg = yaml.safe_load(CONFIG_PATH.read_text()) if CONFIG_PATH.exists() else {}
    api_key = cfg.get("anthropic", {}).get("api_key", "")
    if api_key:
        os.environ["ANTHROPIC_API_KEY"] = api_key


def _load_validation_limits_from_config() -> None:
    cfg = yaml.safe_load(CONFIG_PATH.read_text()) if CONFIG_PATH.exists() else {}
    set_validation_limits(cfg.get("validation", {}))


_ensure_config_files()
_load_api_key_from_config()
_load_validation_limits_from_config()

app = FastAPI(title="Niswins Tavern")
docmost = DocmostClient()


def _load_config() -> dict:
    try:
        with open(CONFIG_PATH) as f:
            return yaml.safe_load(f) or {}
    except FileNotFoundError:
        return {}


@app.get("/")
async def serve_index():
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/api/config")
async def get_config():
    cfg = _load_config()
    return {
        "folders": {"npcs": "NPCs", "bestiary": "Bestiary", "locations": "Locations", "encounters": "Encounters", "players": "Players"},
        "docmost_url": cfg["docmost"]["url"],
    }


@app.get("/api/settings")
async def get_settings():
    cfg = _load_config()
    api_key = cfg.get("anthropic", {}).get("api_key", "") or os.environ.get("ANTHROPIC_API_KEY", "")
    dcfg = cfg.get("docmost", {})
    folder_urls = dcfg.get("folder_urls", {})
    vlimits = cfg.get("validation", {})

    return {
        "campaign_name": cfg.get("campaign_name", ""),
        "anthropic_api_key": api_key,
        "claude_model": cfg.get("claude", {}).get("model", "claude-sonnet-4-6"),
        "docmost_url": dcfg.get("url", ""),
        "docmost_username": dcfg.get("username", ""),
        "docmost_password": dcfg.get("password", ""),
        "folder_url_npcs": folder_urls.get("npcs", ""),
        "folder_url_bestiary": folder_urls.get("bestiary", ""),
        "folder_url_locations": folder_urls.get("locations", ""),
        "folder_url_encounters": folder_urls.get("encounters", ""),
        "folder_url_items": folder_urls.get("items", ""),
        "folder_url_factions": folder_urls.get("factions", ""),
        "folder_url_players": folder_urls.get("players", ""),
        "max_concept_length": vlimits.get("max_concept_length", 1000),
        "max_notes_length": vlimits.get("max_notes_length", 500),
        "max_character_level": vlimits.get("max_character_level", 20),
        "max_shop_items": vlimits.get("max_shop_items", 20),
    }


@app.post("/api/settings")
async def update_settings(req: SettingsUpdate):
    try:
        # Build and write config.yaml (all settings in one place)
        try:
            with open(CONFIG_PATH) as f:
                cfg = yaml.safe_load(f) or {}
        except FileNotFoundError:
            cfg = {}

        cfg["anthropic"] = {"api_key": req.anthropic_api_key}
        os.environ["ANTHROPIC_API_KEY"] = req.anthropic_api_key

        new_limits = {
            "max_concept_length": req.max_concept_length,
            "max_notes_length": req.max_notes_length,
            "max_character_level": req.max_character_level,
            "max_shop_items": req.max_shop_items,
        }
        cfg["validation"] = new_limits
        set_validation_limits(new_limits)

        cfg["docmost"] = {
            "url": req.docmost_url,
            "username": req.docmost_username,
            "password": req.docmost_password,
            "folder_urls": {
                "npcs": req.folder_url_npcs,
                "bestiary": req.folder_url_bestiary,
                "locations": req.folder_url_locations,
                "encounters": req.folder_url_encounters,
                "items": req.folder_url_items,
                "factions": req.folder_url_factions,
                "players": req.folder_url_players,
            },
        }
        cfg["claude"] = {"model": req.claude_model}
        cfg["campaign_name"] = req.campaign_name

        with open(CONFIG_PATH, "w") as f:
            yaml.dump(cfg, f, default_flow_style=False, allow_unicode=True)

        # Reload Docmost client with new credentials
        docmost.reload_config()

        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/settings/test-page")
async def test_page_url(req: TestPageUrlRequest):
    try:
        page_id, title = await docmost.resolve_page_url(req.url)
        return {"success": True, "page_id": page_id, "title": title}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))



@app.post("/api/generate")
async def api_generate(req: GenerateRequest):
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not set in config.yaml")
    try:
        character, usage = await generate_character(req)

        ts = datetime.now(timezone.utc)
        entry_id = history_store.make_entry_id(ts, character.name)
        entry = {
            "id": entry_id,
            "timestamp": ts.isoformat(),
            "type": "Player Character" if (req.is_player_character or req.player_name) else ("Generic NPC" if req.generic_npc else "Character"),
            "name": character.name,
            "race": character.race,
            "character_class": character.character_class,
            "level": character.level,
            "alignment": character.alignment,
            "generic_npc": req.generic_npc,
            "player_name": req.player_name or "",
            "docmost_page_id": None,
            "docmost_url": None,
            "generation_params": req.model_dump(),
            "token_usage": usage,
            "character": character.model_dump(),
        }
        history_store.save_entry(entry)
        _update_token_stats(usage)

        return {"character": character, "usage": usage, "history_id": entry_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _existing_page_id(history_id: Optional[str]) -> Optional[str]:
    """Return the stored docmost_page_id for a history entry, or None."""
    if not history_id:
        return None
    try:
        return history_store.get_entry(history_id).get("docmost_page_id")
    except Exception:
        return None


@app.post("/api/save")
async def api_save(req: SaveRequest):
    try:
        page_id, docmost_url = await docmost.save_character(
            req.character, req.folder, existing_page_id=_existing_page_id(req.history_id)
        )

        if req.history_id:
            try:
                history_store.patch_entry(req.history_id, {
                    "docmost_page_id": page_id,
                    "docmost_url": docmost_url,
                    "docmost_synced_at": datetime.now(timezone.utc).isoformat(),
                    "docmost_out_of_sync": False,
                })
            except Exception:
                pass  # Don't fail the save if history update fails

        return {"success": True, "page_id": page_id, "docmost_url": docmost_url}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/generate-item")
async def api_generate_item(req: GenerateItemRequest):
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not set in config.yaml")
    try:
        item, usage = await generate_item(req)

        ts = datetime.now(timezone.utc)
        entry_id = history_store.make_entry_id(ts, item.name)
        entry = {
            "id": entry_id,
            "timestamp": ts.isoformat(),
            "type": "Item",
            "name": item.name,
            "item_type": item.item_type,
            "rarity": item.rarity,
            "target_level_min": item.target_level_min,
            "target_level_max": item.target_level_max,
            "docmost_page_id": None,
            "docmost_url": None,
            "generation_params": req.model_dump(),
            "token_usage": usage,
            "item": item.model_dump(),
        }
        history_store.save_entry(entry)
        _update_token_stats(usage)

        return {"item": item, "usage": usage, "history_id": entry_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/save-item")
async def api_save_item(req: SaveItemRequest):
    try:
        page_id, docmost_url = await docmost.save_item(
            req.item, existing_page_id=_existing_page_id(req.history_id)
        )

        if req.history_id:
            try:
                history_store.patch_entry(req.history_id, {
                    "docmost_page_id": page_id,
                    "docmost_url": docmost_url,
                    "docmost_synced_at": datetime.now(timezone.utc).isoformat(),
                    "docmost_out_of_sync": False,
                })
            except Exception:
                pass

        return {"success": True, "page_id": page_id, "docmost_url": docmost_url}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/generate-shop")
async def api_generate_shop(req: GenerateShopRequest):
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not set in config.yaml")
    try:
        shop, usage = await generate_shop(req)

        ts = datetime.now(timezone.utc)
        entry_id = history_store.make_entry_id(ts, shop.name)
        entry = {
            "id": entry_id,
            "timestamp": ts.isoformat(),
            "type": "Shop",
            "name": shop.name,
            "category": shop.category,
            "shop_type": shop.shop_type,
            "item_count": len(shop.items),
            "docmost_page_id": None,
            "docmost_url": None,
            "generation_params": req.model_dump(),
            "token_usage": usage,
            "shop": shop.model_dump(),
        }
        history_store.save_entry(entry)
        _update_token_stats(usage)

        return {"shop": shop, "usage": usage, "history_id": entry_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/save-shop")
async def api_save_shop(req: SaveShopRequest):
    try:
        linked_npcs = []
        if req.history_id:
            try:
                linked_npcs = history_store.get_entry(req.history_id).get("linked_npcs", [])
            except Exception:
                pass
        page_id, docmost_url = await docmost.save_shop(
            req.shop,
            existing_page_id=_existing_page_id(req.history_id),
            linked_npcs=linked_npcs or None,
        )

        if req.history_id:
            try:
                history_store.patch_entry(req.history_id, {
                    "docmost_page_id": page_id,
                    "docmost_url": docmost_url,
                    "docmost_synced_at": datetime.now(timezone.utc).isoformat(),
                    "docmost_out_of_sync": False,
                })
            except Exception:
                pass

        return {"success": True, "page_id": page_id, "docmost_url": docmost_url}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/shop/{shop_id}/link-npc")
async def link_shop_npc(shop_id: str, req: LinkShopNpcRequest):
    """Add a linked NPC to a shop and update both Docmost pages with cross-links."""
    try:
        shop_entry = history_store.get_entry(shop_id)
        if shop_entry.get("type") != "Shop":
            raise HTTPException(status_code=400, detail="Entry is not a Shop")

        linked_npcs = shop_entry.get("linked_npcs", [])
        linked_npc = {
            "member_name": req.member_name,
            "member_role": req.member_role,
            "npc_name": req.npc_name,
            "npc_docmost_url": req.npc_docmost_url,
            "npc_history_id": req.npc_history_id,
            "is_shopkeeper": req.is_shopkeeper,
            "linked_at": datetime.now(timezone.utc).isoformat(),
        }
        linked_npcs = [n for n in linked_npcs if n.get("member_name") != req.member_name]
        linked_npcs.append(linked_npc)
        shop_entry["linked_npcs"] = linked_npcs
        history_store.save_entry(shop_entry)

        shop_page_id = shop_entry.get("docmost_page_id")
        shop_page_url = shop_entry.get("docmost_url", "")

        if shop_page_id:
            from models import Shop
            shop_obj = Shop(**shop_entry["shop"])
            await docmost.save_shop(shop_obj, existing_page_id=shop_page_id, linked_npcs=linked_npcs)

        shop_affiliation = {
            "shop_name": shop_entry.get("name", ""),
            "shop_url": shop_page_url,
            "member_role": req.member_role,
        }
        try:
            npc_entry = history_store.get_entry(req.npc_history_id)
            npc_entry["shop_affiliation"] = shop_affiliation
            history_store.save_entry(npc_entry)

            npc_page_id = npc_entry.get("docmost_page_id")
            if npc_page_id and npc_entry.get("character"):
                char_obj = Character(**npc_entry["character"])
                faction_affiliation = npc_entry.get("faction_affiliation")
                await docmost.save_character(
                    char_obj, "npcs",
                    existing_page_id=npc_page_id,
                    faction_affiliation=faction_affiliation,
                    shop_affiliation=shop_affiliation,
                )
        except Exception as e:
            logger.warning(f"Could not update NPC page with shop link: {e}")

        return {"success": True, "linked_npcs": linked_npcs}
    except HTTPException:
        raise
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Shop entry not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/shop/{shop_id}/regenerate-staff")
async def regenerate_shop_staff_endpoint(shop_id: str, req: RegenerateShopStaffRequest):
    """Generate a new shopkeeper or staff member for a shop. Returns member data only — caller saves."""
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not set in config.yaml")
    try:
        entry = history_store.get_entry(shop_id)
        from models import Shop
        shop_obj = Shop(**entry["shop"])
        member_data = await generate_shop_staff(shop_obj, is_shopkeeper=req.is_shopkeeper)
        return {"member": member_data}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Shop entry not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/generate-faction")
async def api_generate_faction(req: GenerateFactionRequest):
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not set in config.yaml")
    try:
        faction, usage = await generate_faction(req)

        ts = datetime.now(timezone.utc)
        entry_id = history_store.make_entry_id(ts, faction.name)
        entry = {
            "id": entry_id,
            "timestamp": ts.isoformat(),
            "type": "Faction",
            "name": faction.name,
            "faction_type": faction.faction_type,
            "size": faction.size,
            "alignment": faction.alignment,
            "docmost_page_id": None,
            "docmost_url": None,
            "generation_params": req.model_dump(),
            "token_usage": usage,
            "faction": faction.model_dump(),
        }
        history_store.save_entry(entry)
        _update_token_stats(usage)

        return {"faction": faction, "usage": usage, "history_id": entry_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/save-faction")
async def api_save_faction(req: SaveFactionRequest):
    try:
        linked_npcs = []
        if req.history_id:
            try:
                linked_npcs = history_store.get_entry(req.history_id).get("linked_npcs", [])
            except Exception:
                pass
        page_id, docmost_url = await docmost.save_faction(
            req.faction,
            existing_page_id=_existing_page_id(req.history_id),
            linked_npcs=linked_npcs or None,
        )

        if req.history_id:
            try:
                history_store.patch_entry(req.history_id, {
                    "docmost_page_id": page_id,
                    "docmost_url": docmost_url,
                    "docmost_synced_at": datetime.now(timezone.utc).isoformat(),
                    "docmost_out_of_sync": False,
                })
            except Exception:
                pass

        return {"success": True, "page_id": page_id, "docmost_url": docmost_url}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/faction/{faction_id}/link-npc")
async def link_faction_npc(faction_id: str, req: LinkFactionNpcRequest):
    """Add a linked NPC to a faction and update both Docmost pages with cross-links."""
    try:
        faction_entry = history_store.get_entry(faction_id)
        if faction_entry.get("type") != "Faction":
            raise HTTPException(status_code=400, detail="Entry is not a Faction")

        # Add the NPC link to the faction history entry
        linked_npcs = faction_entry.get("linked_npcs", [])
        linked_npc = {
            "member_name": req.member_name,
            "member_role": req.member_role,
            "npc_name": req.npc_name,
            "npc_docmost_url": req.npc_docmost_url,
            "npc_history_id": req.npc_history_id,
            "linked_at": datetime.now(timezone.utc).isoformat(),
        }
        # Replace existing link for the same member if present
        linked_npcs = [n for n in linked_npcs if n.get("member_name") != req.member_name]
        linked_npcs.append(linked_npc)
        faction_entry["linked_npcs"] = linked_npcs
        history_store.save_entry(faction_entry)

        faction_page_id = faction_entry.get("docmost_page_id")
        faction_page_url = faction_entry.get("docmost_url", "")

        # Re-save faction page with updated Connected NPCs section
        if faction_page_id:
            from models import Faction
            faction_obj = Faction(**faction_entry["faction"])
            await docmost.save_faction(faction_obj, existing_page_id=faction_page_id, linked_npcs=linked_npcs)

        # Update NPC history entry and re-save NPC page with faction link
        faction_affiliation = {
            "faction_name": faction_entry.get("name", ""),
            "faction_url": faction_page_url,
            "member_role": req.member_role,
        }
        try:
            npc_entry = history_store.get_entry(req.npc_history_id)
            npc_entry["faction_affiliation"] = faction_affiliation
            history_store.save_entry(npc_entry)

            npc_page_id = npc_entry.get("docmost_page_id")
            if npc_page_id and npc_entry.get("character"):
                from models import Character
                char_obj = Character(**npc_entry["character"])
                folder_key = "npcs" if npc_entry.get("type") != "Generic NPC" else "npcs"
                await docmost.save_character(
                    char_obj, folder_key,
                    existing_page_id=npc_page_id,
                    faction_affiliation=faction_affiliation,
                )
        except Exception as e:
            logger.warning(f"Could not update NPC page with faction link: {e}")

        return {"success": True, "linked_npcs": linked_npcs}
    except HTTPException:
        raise
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Faction entry not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/faction/{faction_id}/regenerate-member")
async def regenerate_faction_member_endpoint(faction_id: str, req: RegenerateMemberRequest):
    """Generate a new leader or notable member for a faction. Returns member data only — caller saves."""
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not set in config.yaml")
    try:
        entry = history_store.get_entry(faction_id)
        from models import Faction
        faction_obj = Faction(**entry["faction"])
        member_data = await generate_faction_member(faction_obj, is_leader=req.is_leader)
        return {"member": member_data}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Faction entry not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/history/{entry_id}/update")
async def update_history_entry(entry_id: str, req: UpdateEntryRequest):
    try:
        entry = history_store.get_entry(entry_id)
        obj_key = {"Character": "character", "Generic NPC": "character", "Player Character": "character", "Item": "item", "Shop": "shop", "Faction": "faction"}.get(entry.get("type", ""))
        if obj_key and obj_key in entry:
            entry[obj_key].update(req.updates)
        # Keep top-level metadata in sync with edited fields
        if "name" in req.updates:
            entry["name"] = req.updates["name"]
        if obj_key == "item":
            for k in ("item_type", "rarity"):
                if k in req.updates:
                    entry[k] = req.updates[k]
        if obj_key == "shop":
            for k in ("shop_type", "category"):
                if k in req.updates:
                    entry[k] = req.updates[k]
            if "items" in req.updates:
                entry["item_count"] = len(req.updates["items"])
        if obj_key == "faction":
            for k in ("faction_type", "size", "alignment"):
                if k in req.updates:
                    entry[k] = req.updates[k]
        edited_at = datetime.now(timezone.utc).isoformat()
        entry["edited_at"] = edited_at
        out_of_sync = bool(entry.get("docmost_page_id"))
        if out_of_sync:
            entry["docmost_out_of_sync"] = True
        history_store.save_entry(entry)
        return {"success": True, "edited_at": edited_at, "out_of_sync": out_of_sync}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="History entry not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/token-stats")
async def api_token_stats():
    return _load_token_stats()


@app.get("/api/history")
async def api_history_list():
    return history_store.list_entries()


@app.get("/api/history/{entry_id}")
async def api_history_entry(entry_id: str):
    try:
        return history_store.get_entry(entry_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="History entry not found")


@app.get("/api/players")
async def api_players_list():
    entries = history_store.list_entries()
    return [e for e in entries if e.get("type") == "Player Character"]


app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="static")
