import os
import yaml
from datetime import datetime, timezone
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from dotenv import load_dotenv, dotenv_values, set_key

from models import GenerateRequest, SaveRequest, Character, GenerateItemRequest, SaveItemRequest, GenerateShopRequest, SaveShopRequest, SettingsUpdate, TestPageUrlRequest, UpdateEntryRequest
from character_generator import generate_character
from item_generator import generate_item
from shop_generator import generate_shop
from docmost_client import DocmostClient
import history_store

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
CONFIG_PATH = Path(__file__).parent.parent / "config.yaml"
ENV_PATH = Path(__file__).parent.parent / ".env"


def _ensure_config_files() -> None:
    """Create .env and config.yaml with defaults on first run if they don't exist."""
    if not ENV_PATH.exists():
        ENV_PATH.write_text("ANTHROPIC_API_KEY=\n")

    if not CONFIG_PATH.exists():
        default_cfg = {
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
                },
            },
            "claude": {"model": "claude-sonnet-4-6"},
        }
        with open(CONFIG_PATH, "w") as f:
            yaml.dump(default_cfg, f, default_flow_style=False, allow_unicode=True)


_ensure_config_files()
load_dotenv(ENV_PATH)

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
        "folders": {"npcs": "NPCs", "bestiary": "Bestiary", "locations": "Locations", "encounters": "Encounters"},
        "docmost_url": cfg["docmost"]["url"],
    }


@app.get("/api/settings")
async def get_settings():
    env_vals = dotenv_values(str(ENV_PATH)) if ENV_PATH.exists() else {}
    api_key = env_vals.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_API_KEY", "")

    cfg = _load_config()
    dcfg = cfg.get("docmost", {})
    folder_urls = dcfg.get("folder_urls", {})

    return {
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
    }


@app.post("/api/settings")
async def update_settings(req: SettingsUpdate):
    try:
        # Write API key to .env and update live environment
        set_key(str(ENV_PATH), "ANTHROPIC_API_KEY", req.anthropic_api_key)
        os.environ["ANTHROPIC_API_KEY"] = req.anthropic_api_key

        # Build and write config.yaml
        try:
            with open(CONFIG_PATH) as f:
                cfg = yaml.safe_load(f) or {}
        except FileNotFoundError:
            cfg = {}

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
            },
        }
        cfg["claude"] = {"model": req.claude_model}

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
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not set in .env")
    try:
        character, usage = await generate_character(req)

        ts = datetime.now(timezone.utc)
        entry_id = history_store.make_entry_id(ts, character.name)
        entry = {
            "id": entry_id,
            "timestamp": ts.isoformat(),
            "type": "Generic NPC" if req.generic_npc else "Character",
            "name": character.name,
            "race": character.race,
            "character_class": character.character_class,
            "level": character.level,
            "alignment": character.alignment,
            "generic_npc": req.generic_npc,
            "docmost_page_id": None,
            "docmost_url": None,
            "character": character.model_dump(),
        }
        history_store.save_entry(entry)

        return {"character": character, "usage": usage, "history_id": entry_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _existing_page_id(history_id: str | None) -> str | None:
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
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not set in .env")
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
            "item": item.model_dump(),
        }
        history_store.save_entry(entry)

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
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not set in .env")
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
            "shop": shop.model_dump(),
        }
        history_store.save_entry(entry)

        return {"shop": shop, "usage": usage, "history_id": entry_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/save-shop")
async def api_save_shop(req: SaveShopRequest):
    try:
        page_id, docmost_url = await docmost.save_shop(
            req.shop, existing_page_id=_existing_page_id(req.history_id)
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


@app.post("/api/history/{entry_id}/update")
async def update_history_entry(entry_id: str, req: UpdateEntryRequest):
    try:
        entry = history_store.get_entry(entry_id)
        obj_key = {"Character": "character", "Generic NPC": "character", "Item": "item", "Shop": "shop"}.get(entry.get("type", ""))
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


@app.get("/api/history")
async def api_history_list():
    return history_store.list_entries()


@app.get("/api/history/{entry_id}")
async def api_history_entry(entry_id: str):
    try:
        return history_store.get_entry(entry_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="History entry not found")


app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="static")
