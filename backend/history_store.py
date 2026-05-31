from __future__ import annotations
import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

HISTORY_DIR = Path(__file__).parent.parent / "history"

# Keys containing full generated data blobs — stripped from list view for lightweight responses
_DATA_KEYS = {"character", "item"}


def _ensure_dir() -> None:
    HISTORY_DIR.mkdir(exist_ok=True)


def make_entry_id(ts: datetime, name: str) -> str:
    """Build a human-readable filename stem: 20260531_143022_Theron_Blackwood."""
    safe = re.sub(r'[^\w\s-]', '', name).strip()
    safe = re.sub(r'\s+', '_', safe)[:48]
    base = f"{ts.strftime('%Y%m%d_%H%M%S')}_{safe}" if safe else ts.strftime('%Y%m%d_%H%M%S')
    # Append a short suffix only if the file already exists (same-second collision)
    _ensure_dir()
    if (HISTORY_DIR / f"{base}.json").exists():
        base = f"{base}_{uuid.uuid4().hex[:4]}"
    return base


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
            results.append({k: v for k, v in data.items() if k not in _DATA_KEYS})
        except Exception:
            continue
    return results


def get_entry(entry_id: str) -> dict:
    return load_entry(entry_id)
