import os
import yaml
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from dotenv import load_dotenv

from models import GenerateRequest, SaveRequest, Character
from character_generator import generate_character
from docmost_client import DocmostClient

load_dotenv(Path(__file__).parent.parent / ".env")

app = FastAPI(title="Niswins Tavern")
docmost = DocmostClient()

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
CONFIG_PATH = Path(__file__).parent.parent / "config.yaml"


@app.get("/")
async def serve_index():
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/api/config")
async def get_config():
    with open(CONFIG_PATH) as f:
        cfg = yaml.safe_load(f)
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
        return {"character": character, "usage": usage}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/save")
async def api_save(req: SaveRequest):
    try:
        page_id = await docmost.save_character(req.character, req.folder)
        return {"success": True, "page_id": page_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="static")
