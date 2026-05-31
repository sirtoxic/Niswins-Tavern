import os
import yaml
from datetime import datetime, timezone
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from dotenv import load_dotenv

from models import GenerateRequest, SaveRequest, Character
from character_generator import generate_character
from docmost_client import DocmostClient
import history_store

load_dotenv(Path(__file__).parent.parent / ".env")

app = FastAPI(title="Niswins Tavern")
docmost = DocmostClient()

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
CONFIG_PATH = Path(__file__).parent.parent / "config.yaml"


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
        "folders": cfg["docmost"]["folders"],
        "docmost_url": cfg["docmost"]["url"],
    }


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
