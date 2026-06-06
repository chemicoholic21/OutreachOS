# AgentOS — Candidate Screening & Outreach

A coordination layer where humans and agents collaboratively screen candidates,
manage outreach, and handle edge cases — with persistent memory, human approval
loops, and agent-to-agent handoffs.

A generic talent outreach tool for **early-career job seekers and career
switchers**: screen candidate applications against criteria, generate
personalized outreach to connectors (recruiters, hiring managers, career-services
staff, community organizers), and plan distribution channels — getting blocked on
geo-restrictions and asking a human for local contacts when needed.

## Three Agents

| Agent | Role | Behaviour |
|-------|------|-----------|
| **Screening Agent** | Application Screener | Reads each candidate application, scores 1–10 against the hiring-readiness criteria, outputs `APPROVE` / `REJECT` / `MAYBE`. |
| **Outreach Agent** | Message Personalizer | Generates personalized outreach messages per connector profile, then waits for human approval. |
| **Channel Agent** | Distribution Strategy | Identifies platforms and job boards to post on, gets **BLOCKED** on geo-restrictions (China/Korea), and asks the human for a local contact. |

## Stack

- **Frontend:** React + Vite + Tailwind CSS
- **Backend:** FastAPI (Python)
- **Database:** PostgreSQL
- **Agents:** Claude API (`claude-sonnet-4-20250514`) or NVIDIA NIM (Llama / Nemotron)

## LLM providers

The agents pick a provider at startup (priority order):

1. **Anthropic / Claude** — set `ANTHROPIC_API_KEY` (model `CLAUDE_MODEL`,
   default `claude-sonnet-4-20250514`). Uses the `anthropic` SDK.
2. **NVIDIA NIM** — set `NVIDIA_API_KEY` (model `NVIDIA_MODEL`, default
   `meta/llama-3.3-70b-instruct`). NVIDIA's endpoint
   (`https://integrate.api.nvidia.com/v1`) is **OpenAI-compatible** and hosts
   Llama / Nemotron models — **not** Claude — so it's used via the `openai`
   SDK pointed at that base URL.
3. **Offline MOCK mode** — if neither key is set, deterministic offline
   responses in `backend/agents/mock.py` produce the exact JSON each agent
   expects, so the full coordination loop (screening, blocking, human unblock,
   memory, approvals) is demoable without a key or network.

The worker prints the active provider on startup, e.g.
`mode=LIVE nvidia (meta/llama-3.3-70b-instruct)`. Configure everything in
`backend/.env` (copy from `.env.example`); the file is gitignored so keys are
never committed.

## Run

### 1. Database (PostgreSQL)

```bash
# create the database (tables are auto-created by SQLAlchemy on startup)
createdb agentos
# or use the bundled schema.sql for reference
```

Configure the connection in `backend/.env` (copy from `.env.example`):

```
DATABASE_URL=postgresql://daytona:daytona@localhost:5432/agentos
```

### 2. Backend (FastAPI + worker)

```bash
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# Terminal 1 — API
uvicorn main:app --reload --port 8000

# Terminal 2 — agent worker (polls BACKLOG tasks every 3s)
python worker.py
```

### 3. Frontend (Vite)

```bash
cd frontend
npm install
npm run dev   # http://localhost:5173
```

The frontend auto-detects the backend: `localhost:8000` locally, or the matching
proxied host when served behind a port-prefixed proxy.

## How it flows

1. **Submit an application** (Applications tab) → a `agent_screening` task is
   queued.
2. The **worker** picks it up, the Screening Agent scores it, sets the
   application status, and writes to **agent memory** (`total_screened`, common
   rejection reason).
3. `MAYBE` results land in `WAITING_APPROVAL` for a human decision in the UI.
4. **Create a task** for the Outreach or Channel agent (Tasks tab / Kanban).
5. The **Channel Agent** blocks on geo-restrictions and asks for a local
   contact. Respond in the modal → the worker saves the contact to memory,
   resets the task, and the agent **retries** successfully.
6. Watch everything in the **Timeline** (activity log) and **Memory** tabs.

## Layout

```
backend/
  main.py            FastAPI app + routers
  database.py        SQLAlchemy engine/session
  models.py          ORM models (applications, tasks, activity_logs, agent_memory)
  schema.sql         reference DDL
  routers/           tasks, applications, logs, memory
  agents/
    base_agent.py    memory, logging, task updates, Claude call (+ mock fallback)
    mock.py          offline Claude stand-in
    screening_agent.py
    outreach_agent.py
    channel_agent.py
  worker.py          polling loop that drives the agents
frontend/
  src/App.jsx        Applications + Tasks (Kanban) + Timeline + Memory views
```
