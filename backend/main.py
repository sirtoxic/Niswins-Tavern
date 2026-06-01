import os
import yaml
from datetime import datetime, timezone
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from dotenv import load_dotenv, dotenv_values, set_key

from models import GenerateRequest, SaveRequest, Character, GenerateItemRequest, SaveItemRequest, SettingsUpdate, TestPageUrlRequest
from character_generator import generate_character
from item_generator import generate_item
from docmost_client import DocmostClient
import history_store

load_dotenv(Path(__file__).parent.parent / ".env")

app = FastAPI(title="Niswins Tavern")
docmost = DocmostClient()

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
CONFIG_PATH = Path(__file__).parent.parent / "config.yaml"
ENV_PATH = Path(__file__).parent.parent / ".env"


def _load_config() -> dict:
    with open(CONFIG_PATH) as f:
        return yaml.safe_load(f)


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


@app.get("/api/settings/debug-page")
async def debug_page_url(url: str):
    """Returns raw Docmost API responses for each resolution strategy."""
    import httpx
    from urllib.parse import urlparse
    results = []
    try:
        await docmost._ensure_auth()
        await docmost._ensure_space()
        parsed = urlparse(url)
        parts = [p for p in parsed.path.split("/") if p]
        space_slug = page_slug = slug_id = None
        try:
            space_slug = parts[parts.index("s") + 1]
            page_slug  = parts[parts.index("p") + 1]
            slug_id    = page_slug.rsplit("-", 1)[1] if "-" in page_slug else page_slug
        except (ValueError, IndexError):
            pass
        space_id = docmost._space_id
        results.append({"parsed": {
            "space_slug": space_slug, "page_slug": page_slug,
            "slug_id": slug_id, "space_id": space_id,
        }})

        def is_json(r):
            ct = r.headers.get("content-type", "")
            return "json" in ct or (r.text.strip().startswith("{") or r.text.strip().startswith("["))

        async with httpx.AsyncClient() as client:
            strategies = [
                ("GET /pages/{slug_id}", "GET",
                 f"{docmost.base_url}/pages/{slug_id}", {}),
                ("GET /pages/{page_slug}", "GET",
                 f"{docmost.base_url}/pages/{page_slug}", {}),
                ("POST /pages/page-info {slug,space slug}", "POST",
                 f"{docmost.base_url}/pages/page-info",
                 {"json": {"slug": page_slug, "spaceSlug": space_slug}}),
                ("POST /pages/page-info {pageSlug,spaceSlug}", "POST",
                 f"{docmost.base_url}/pages/page-info",
                 {"json": {"pageSlug": page_slug, "spaceSlug": space_slug}}),
                ("POST /pages/list {spaceId}", "POST",
                 f"{docmost.base_url}/pages/list",
                 {"json": {"spaceId": space_id}}),
                ("GET /pages/sidebar-pages?spaceId", "GET",
                 f"{docmost.base_url}/pages/sidebar-pages",
                 {"params": {"spaceId": space_id}}),
                ("GET /spaces/{space_id}/pages", "GET",
                 f"{docmost.base_url}/spaces/{space_id}/pages", {}),
            ]
            for label, method, endpoint, kwargs in strategies:
                try:
                    fn = client.post if method == "POST" else client.get
                    r = await fn(endpoint, headers=docmost._headers(), timeout=10.0, **kwargs)
                    results.append({
                        "strategy": label,
                        "status": r.status_code,
                        "is_json": is_json(r),
                        "body": r.text[:300] if not is_json(r) else r.text[:600],
                    })
                except Exception as ex:
                    results.append({"strategy": label, "error": str(ex)})
    except Exception as ex:
        results.append({"auth_error": str(ex)})
    return {"results": results}


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


@app.post("/api/save")
async def api_save(req: SaveRequest):
    try:
        page_id, docmost_url = await docmost.save_character(req.character, req.folder)

        if req.history_id:
            try:
                history_store.patch_entry(req.history_id, {
                    "docmost_page_id": page_id,
                    "docmost_url": docmost_url,
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
        page_id, docmost_url = await docmost.save_item(req.item)

        if req.history_id:
            try:
                history_store.patch_entry(req.history_id, {
                    "docmost_page_id": page_id,
                    "docmost_url": docmost_url,
                })
            except Exception:
                pass

        return {"success": True, "page_id": page_id, "docmost_url": docmost_url}
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
