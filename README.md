This is a little side project that i generated with AI dont expect updates or for it to be fully working. I only know enough code to be dangerous. One day this may be somthing cool.

# Niswins Tavern — Character Forge & Item Workshop

A D&D 5e NPC, character, and magic item generator powered by the Claude API. Fill out a short form, get complete stat blocks and lore-rich item descriptions, then save directly to [Docmost](https://docmost.com) or export as PDF / Foundry VTT JSON.

---

## Features

### Character Forge
- Generates complete, rules-accurate D&D 5e character sheets via Claude AI
- Shows base stats vs. racial bonuses vs. other bonuses separately
- Full AC breakdown by source (armor, shield, DEX, magic, class features, etc.)
- Skill and saving throw proficiency breakdowns
- Spellcasting stats, spell slots, and spell lists for caster classes
- **Generic NPC Mode** — simplified output for background characters
- Save to Docmost under configurable folder categories (NPCs, Bestiary, etc.)
- Export to print-ready PDF or Foundry VTT–compatible JSON

### Item Workshop
- Generates magic items with rarity-appropriate bonuses and abilities
- Rarity tiers with enforced rules:
  | Rarity | Colour | Bonuses |
  |---|---|---|
  | Common | Gray | No bonuses, no special abilities |
  | Uncommon | Green | +1 to one stat |
  | Rare | Blue | +2 stat, or +1 stat + 1 ability |
  | Epic | Purple | +3 stat, or +2 stat + 1 ability |
  | Legendary | Orange | +3–4 stat + 2 abilities, unique, attunement required |
- Target level range selector (1–20)
- Free-text item type with datalist suggestions (sword, staff, ring, potion, etc.)
- Generates name, description, lore, weight, and gold value
- Save to Docmost under `Items → {item type}` two-level hierarchy (auto-created)
- Export to PDF

### General
- Token usage and estimated cost displayed after every generation
- Full generation history with search — reopen, re-save, or re-export any past result
- Folder page IDs cached persistently — no duplicate wiki pages across restarts
- Containerised — runs entirely via Docker Compose

---

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/)
- An [Anthropic API key](#getting-an-anthropic-api-key)
- A running [Docmost](https://docmost.com) instance with a service account (community edition is fine)

---

## Quick Start

### 1. Clone the repo

```bash
git clone https://github.com/sirtoxic/Niswins-Tavern.git
cd Niswins-Tavern
```

### 2. Create your `.env` file

```bash
cp .env.example .env
```

Edit `.env` and add your Anthropic API key:

```env
ANTHROPIC_API_KEY=sk-ant-api03-...
```

See [Getting an Anthropic API key](#getting-an-anthropic-api-key) below.

### 3. Create your `config.yaml` file

```bash
cp config.example.yaml config.yaml
```

Edit `config.yaml` with your Docmost details:

```yaml
docmost:
  url: "https://your-docmost-instance.example.com/api"
  username: "your-service-account@example.com"
  password: "your-password"
  folders:
    npcs: "NPCs"
    bestiary: "Bestiary"
    locations: "Locations"
    encounters: "Encounters"

claude:
  model: "claude-sonnet-4-6"
```

See [Configuring Docmost](#configuring-docmost) below.

### 4. Build and run

```bash
docker compose up --build
```

The app will be available at **http://localhost:8000**.

To run in the background:

```bash
docker compose up --build -d
```

To stop:

```bash
docker compose down
```

---

## Docker Compose Configuration

The minimal `docker-compose.yml` included in the repo runs only the Niswins Tavern app itself, expecting Docmost to be hosted separately. If you want to run everything — the app, Docmost, and its database — in a single stack, here is a complete example:

```yaml
services:

  tavern:
    build: .
    ports:
      - "8000:8000"
    volumes:
      - ./config.yaml:/app/config.yaml
      - ./.env:/app/.env
      - tavern_history:/app/history
    restart: unless-stopped
    depends_on:
      - docmost

  docmost:
    image: docmost/docmost:latest
    ports:
      - "3000:3000"
    environment:
      APP_URL: "http://localhost:3000"
      APP_SECRET: "change-me-to-a-long-random-string"
      DATABASE_URL: "postgresql://docmost:docmost_password@db:5432/docmost"
      REDIS_URL: "redis://redis:6379"
    volumes:
      - docmost_data:/app/data
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: docmost
      POSTGRES_USER: docmost
      POSTGRES_PASSWORD: docmost_password
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U docmost"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: unless-stopped

volumes:
  tavern_history:
  docmost_data:
  postgres_data:
```

> **Note:** The `APP_SECRET` must be a long random string. Generate one with `openssl rand -hex 32`.
>
> After first run, open Docmost at `http://localhost:3000`, complete the setup wizard, create a service account, and update `config.yaml` with the account credentials and `http://localhost:3000/api` as the URL.

If you have an existing Docmost instance elsewhere, just use the minimal `docker-compose.yml` from the repo and point `config.yaml` at it.

---

## Getting an Anthropic API Key

1. Go to [console.anthropic.com](https://console.anthropic.com) and sign in (or create an account).
2. Navigate to **API Keys** in the left sidebar.
3. Click **Create Key**, give it a name (e.g. `niswins-tavern`), and copy the key — it will only be shown once.
4. Paste it into your `.env` file:
   ```env
   ANTHROPIC_API_KEY=sk-ant-api03-...
   ```

> **Pricing note:** The Claude API is a paid service. Niswins Tavern uses `claude-sonnet-4-6` and shows token counts and estimated costs after each generation. Character generation typically costs $0.05–$0.15; item generation is cheaper at $0.01–$0.05. New Anthropic accounts receive a small amount of free credit.

---

## Configuring Docmost

Niswins Tavern saves content as formatted Markdown pages in your Docmost wiki using cookie-based authentication (no enterprise API token required).

### Setting up a service account

1. In your Docmost instance, create a dedicated user account for the app (e.g. `tavern@yourdomain.com`).
2. Give it access to the space where you want content saved.
3. Add the email and password to `config.yaml` under `docmost.username` and `docmost.password`.

### Folder mapping (characters)

The `folders` section in `config.yaml` maps internal keys to page titles created in Docmost. Characters are saved as child pages under their folder page.

| Key | Default page title | Used for |
|---|---|---|
| `npcs` | NPCs | Named NPCs and player-facing characters |
| `bestiary` | Bestiary | Monsters and animals |
| `locations` | Locations | *(future feature)* |
| `encounters` | Encounters | *(future feature)* |

### Item folders (automatic)

Items do not use the `folders` config. They are always saved under:

```
Items/
└── {item_type}/    ← created automatically from the item type you enter
    └── Item Name
```

The `Items` root folder and each type subfolder are created on first use and cached — they are never duplicated across restarts.

---

## Running Without Docker (Development)

Requires Python 3.9+.

```bash
# Create and activate a virtual environment
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate

# Install dependencies
pip install -r backend/requirements.txt

# Run the dev server (from the project root)
cd backend && PYTHONPATH=.. uvicorn main:app --reload --port 8000
```

Then open **http://localhost:8000**.

---

## Environment Files Reference

### `.env`

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Your Anthropic API key (`sk-ant-api03-...`) |

### `config.yaml`

| Key | Required | Description |
|---|---|---|
| `docmost.url` | Yes | Full URL to your Docmost API endpoint, e.g. `https://wiki.example.com/api` |
| `docmost.username` | Yes | Email address of the Docmost service account |
| `docmost.password` | Yes | Password of the Docmost service account |
| `docmost.folders.*` | Yes | Page title mappings for character folder types |
| `claude.model` | No | Claude model to use (default: `claude-sonnet-4-6`) |

> Neither `.env` nor `config.yaml` are committed to the repository. Both are mounted into the container at runtime via Docker Compose volumes.

---

## Project Structure

```
.
├── backend/
│   ├── main.py                 # FastAPI app and API endpoints
│   ├── models.py               # Pydantic models for all request/response types
│   ├── character_generator.py  # Character generation via Claude API
│   ├── item_generator.py       # Item generation via Claude API
│   ├── docmost_client.py       # Docmost wiki integration (characters + items)
│   ├── history_store.py        # Local JSON history persistence
│   └── requirements.txt
├── frontend/
│   ├── index.html              # Single-page UI (Forge / Items / History tabs)
│   └── app.js                  # Sheet renderers, item display, export logic
├── history/                    # Generated history files (gitignored)
├── Dockerfile
├── docker-compose.yml
├── config.example.yaml         # Template — copy to config.yaml
└── .env.example                # Template — copy to .env
```

---

## Licence

MIT
