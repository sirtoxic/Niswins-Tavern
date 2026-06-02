This is a little side project. I generated to test out how Claude code works eventually I might turn this into a real project but for now it is just me learning. Claude don't expect any updates to the software.

# Niswins Tavern — Character Forge, Item Workshop & Shop Generator

A D&D 5e NPC, character, magic item, and shop generator powered by the Claude API. Fill out a short form, get complete stat blocks, lore-rich item descriptions, and fully stocked shops — then save directly to [Docmost](https://docmost.com) or export as PDF / Foundry VTT JSON.

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

### Shop Generator
- Generates a complete shop in one click: shop details, a full shopkeeper NPC, and a stock of items
- Shop types: building, stall, cart, ship, cave
- Shop categories: General, Weapon, Armour, Magic, Alchemist, Jeweller, Blacksmith, Tailor, and more
- Configure item count, rarity mix (Common → Legendary toggles), and detail level
- Optional **under-the-table** stock for black-market or shady merchants
- Each item has its own **Generate** button — opens a modal overlay to flesh out a full Item Workshop entry without leaving the shop
- The shopkeeper card has a **Generate NPC** button for the same in-place modal workflow
- Save to Docmost under `Locations → Shops` (auto-created)
- Re-generate items and NPCs from any shop entry in History

### General
- Hash-based URL routing — browser URL updates as you navigate between views
- Token usage and estimated cost displayed after every generation
- Full generation history with search — reopen, re-save, or re-export any past result
- Folder page IDs cached persistently — no duplicate wiki pages across restarts
- All settings (API key, Docmost credentials, Claude model) configurable via the in-app Settings page — no manual file editing required
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

### 2. Build and run

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

### 3. Configure via Settings

On first run, `.env` and `config.yaml` are created automatically with empty defaults. Open **http://localhost:8000** and go to the **Settings** tab to enter your:

- Anthropic API key
- Docmost URL, username, and password
- Claude model (optional — defaults to `claude-sonnet-4-6`)
- Docmost folder URLs for each category (optional — folders are auto-created if left blank)

Settings are saved back to `.env` and `config.yaml` on disk, so they persist across restarts and can also be edited manually if preferred.

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
> After first run, open Docmost at `http://localhost:3000`, complete the setup wizard, create a service account, and add the credentials in the Niswins Tavern **Settings** tab.

If you have an existing Docmost instance elsewhere, just use the minimal `docker-compose.yml` from the repo and configure the connection via Settings.

---

## Getting an Anthropic API Key

1. Go to [console.anthropic.com](https://console.anthropic.com) and sign in (or create an account).
2. Navigate to **API Keys** in the left sidebar.
3. Click **Create Key**, give it a name (e.g. `niswins-tavern`), and copy the key — it will only be shown once.
4. Paste it into the **Settings** tab in the app, or add it manually to `.env`:
   ```env
   ANTHROPIC_API_KEY=sk-ant-api03-...
   ```

> **Pricing note:** The Claude API is a paid service. Niswins Tavern uses `claude-sonnet-4-6` by default and shows token counts and estimated costs after each generation. Character generation typically costs $0.05–$0.15; item generation is cheaper at $0.01–$0.05. New Anthropic accounts receive a small amount of free credit.

---

## Configuring Docmost

Niswins Tavern saves content as formatted Markdown pages in your Docmost wiki using cookie-based authentication (no enterprise API token required).

### Setting up a service account

1. In your Docmost instance, create a dedicated user account for the app (e.g. `tavern@yourdomain.com`).
2. Give it access to the space where you want content saved.
3. Enter the email and password in the **Settings** tab, or add them to `config.yaml` manually.

### Folder mapping

The **Settings** tab has a URL field for each category (NPCs, Bestiary, Locations, Encounters, Items). Paste the Docmost page URL for an existing folder, or leave it blank — the app will auto-create a folder at the root of your space on first save and cache it for future runs.

Content is saved in the following hierarchy:

| Type | Path |
|---|---|
| Characters / NPCs | `{folder} / Character Name` |
| Items | `Items / {item_type} / Item Name` |
| Shops | `Locations / Shops / Shop Name` |

### Known limitation: page revision history

Docmost's page revision history is driven by its collaborative editing engine (Y.js), not its REST API. When Niswins Tavern creates or re-syncs a page via the API, the content is updated correctly but Docmost does not record a new revision in the page's history panel.

As a workaround, every page includes a timestamp footer (*Created* or *Re-synced via Niswins Tavern · date*) so you can always tell when the content was last written from the app.

---

## Running Without Docker (Development)

Requires Python 3.9+.

```bash
# Create and activate a virtual environment
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate

# Install dependencies
pip install -r backend/requirements.txt

# Run the dev server (from the backend directory)
cd backend && uvicorn main:app --reload --port 8000
```

Then open **http://localhost:8000** and configure everything via the Settings tab.

---

## Configuration Files Reference

Both files are created automatically on first run. They are gitignored and can be edited manually at any time — changes take effect after a restart (or immediately for settings saved via the in-app Settings page).

### `.env`

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key (`sk-ant-api03-...`) |

### `config.yaml`

| Key | Description |
|---|---|
| `docmost.url` | Full URL to your Docmost API endpoint, e.g. `https://wiki.example.com/api` |
| `docmost.username` | Email address of the Docmost service account |
| `docmost.password` | Password of the Docmost service account |
| `docmost.folder_urls.*` | Docmost page URLs for each category folder (auto-created if blank) |
| `claude.model` | Claude model to use (default: `claude-sonnet-4-6`) |

---

## Project Structure

```
.
├── backend/
│   ├── main.py                 # FastAPI app and API endpoints
│   ├── models.py               # Pydantic models for all request/response types
│   ├── character_generator.py  # Character generation via Claude API
│   ├── item_generator.py       # Item generation via Claude API
│   ├── shop_generator.py       # Shop + shopkeeper + item generation via Claude API
│   ├── docmost_client.py       # Docmost wiki integration (characters, items, shops)
│   ├── history_store.py        # Local JSON history persistence
│   └── requirements.txt
├── frontend/
│   ├── index.html              # Single-page UI (Forge / Items / Shops / History / Settings)
│   └── app.js                  # Sheet renderers, modal overlay, export logic, hash routing
├── history/                    # Generated history files (gitignored)
├── Dockerfile
├── docker-compose.yml
├── config.example.yaml         # Reference template (the real config.yaml is auto-generated)
└── .env.example                # Reference template (the real .env is auto-generated)
```

---

## Licence

MIT
