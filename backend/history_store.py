from __future__ import annotations
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

HISTORY_DIR = Path(__file__).parent.parent / "history"

_META_KEYS = {
    "id", "timestamp", "type", "name", "race", "character_class",
    "level", "alignment", "generic_npc", "docmost_page_id", "docmost_url",
}


def _ensure_dir() -> None:
    HISTORY_DIR.mkdir(exist_ok=True)


def save_entry(entry: dict) -> dict:
    _ensure_dir()
    (HISTORY_DIR / f"{entry['id']}.json").write_text(json.dumps(entry, indent=2))
    return entry


def load_entry(entry_id: str) -> dict:
    path = HISTORY_DIR / f"{entry_id}.json"
    return json.loads(path.read_text())


def patch_entry(entry_id: str, updates: dict) -> dict:
    entry = load_entry(entry_id)
    entry.update(updates)
    return save_entry(entry)


def list_entries() -> list[dict]:
    _ensure_dir()
    results = []
    for f in sorted(HISTORY_DIR.glob("*.json"), reverse=True):
        try:
            data = json.loads(f.read_text())
            results.append({k: v for k, v in data.items() if k in _META_KEYS})
        except Exception:
            continue
    return results


def get_entry(entry_id: str) -> dict:
    return load_entry(entry_id)
