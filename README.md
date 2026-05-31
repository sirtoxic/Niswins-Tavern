# Niswins Tavern — Character Forge

A D&D 5e NPC and character generator powered by the Claude API. Fill out a short form, get a complete stat block with full 5e math breakdowns, then save directly to [Docmost](https://docmost.com) or export as PDF / Foundry VTT JSON.

---

## Features

- Generates complete, rules-accurate D&D 5e character sheets via Claude AI
- Shows base stats vs. racial bonuses vs. other bonuses separately
- Full AC breakdown by source (armor, shield, DEX, magic, class features, etc.)
- Skill and saving throw proficiency breakdowns
- Spellcasting stats, spell slots, and spell lists for caster classes
- **Generic NPC Mode** — simplified output for background characters
- Save directly to a self-hosted Docmost wiki
- Export to print-ready PDF or Foundry VTT–compatible JSON
- Displays token usage and estimated cost after each generation
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

## Getting an Anthropic API Key

1. Go to [console.anthropic.com](https://console.anthropic.com) and sign in (or create an account).
2. Navigate to **API Keys** in the left sidebar.
3. Click **Create Key**, give it a name (e.g. `niswins-tavern`), and copy the key — it will only be shown once.
4. Paste it into your `.env` file:
   ```env
   ANTHROPIC_API_KEY=sk-ant-api03-...
   ```

> **Note:** The Claude API is a paid service. Character generation uses `claude-sonnet-4-6` and typically costs between $0.05–$0.15 per character depending on backstory length. The app displays the token count and estimated cost after each generation. New Anthropic accounts receive a small amount of free credit.

---

## Configuring Docmost

Niswins Tavern saves characters as formatted pages in your Docmost wiki. It uses cookie-based authentication (no enterprise API token required).

### Setting up a service account

1. In your Docmost instance, create a dedicated user account for the app (e.g. `tavern@yourdomain.com`).
2. Give it access to the space where you want characters saved.
3. Add the email and password to `config.yaml` under `docmost.username` and `docmost.password`.

### Folder mapping

The `folders` section in `config.yaml` maps internal keys to the page titles that will be created in Docmost. Characters are saved as child pages under their respective folder page. You can rename these to anything you like.

| Key | Default page title | Used for |
|---|---|---|
| `npcs` | NPCs | Named NPCs and player-facing characters |
| `bestiary` | Bestiary | Monsters and animals |
| `locations` | Locations | *(future feature)* |
| `encounters` | Encounters | *(future feature)* |

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
| `docmost.url` | Yes | Full URL to your Docmost instance API, e.g. `https://wiki.example.com/api` |
| `docmost.username` | Yes | Email address of the Docmost service account |
| `docmost.password` | Yes | Password of the Docmost service account |
| `docmost.folders.*` | Yes | Page title mappings for each folder type |
| `claude.model` | No | Claude model to use (default: `claude-sonnet-4-6`) |

> Neither `.env` nor `config.yaml` are committed to the repository. Both are mounted into the container at runtime via Docker Compose volumes.

---

## Project Structure

```
.
├── backend/
│   ├── main.py                 # FastAPI app and API endpoints
│   ├── models.py               # Pydantic models for request/response
│   ├── character_generator.py  # Claude API integration and prompt
│   ├── docmost_client.py       # Docmost wiki integration
│   └── requirements.txt
├── frontend/
│   ├── index.html              # Single-page UI
│   └── app.js                  # Character sheet renderer and export logic
├── Dockerfile
├── docker-compose.yml
├── config.example.yaml         # Template — copy to config.yaml
└── .env.example                # Template — copy to .env
```

---

## Licence

MIT
