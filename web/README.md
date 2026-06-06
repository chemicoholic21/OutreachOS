# AgentOS — Candidate Screening & Outreach (Next.js / Vercel)

Single-platform **Next.js** port of AgentOS, designed to deploy to **Vercel** with
zero extra infrastructure. Same product as the Python version: a human + agent
coordination layer for screening **early-career job seekers and career switchers**,
generating connector outreach, and planning distribution channels — with
persistent memory, human approval loops, and agent-to-agent handoffs.

Everything (UI, API, agents, background processing) lives in this one app.

## Architecture

| Concern | Implementation |
|---|---|
| UI | `app/page.tsx` — client component, polls every 3s |
| API | App Router **route handlers** under `app/api/*` |
| Agents | `lib/agents.ts` (screening, outreach, channel) in TypeScript |
| LLM provider | `lib/llm.ts` — Anthropic → NVIDIA NIM → offline mock |
| Database | `lib/db.ts` — `postgres.js`, schema auto-created on first use |
| "Worker" | `lib/agents.ts#tick()` — atomic-claim task processor |

### How the worker problem is solved (no long-running process)

Vercel has no place for a persistent polling loop, so processing is driven three
ways, all made safe by an **atomic claim** (`UPDATE tasks SET status='IN_PROGRESS'
WHERE status='BACKLOG' … FOR UPDATE SKIP LOCKED`) so concurrent triggers never
double-process a task:

1. **`after()`** — every mutation (submit application, create task, respond)
   schedules `tick()` to run in the background after the response is sent.
2. **Vercel Cron** — `vercel.json` calls `/api/cron/tick` every minute as a
   reliable backstop (also retries channel tasks the human just unblocked).
3. **Frontend poll** — the UI pings `/api/cron/tick` on each 3s refresh, so
   progress happens even on the Hobby plan where cron is coarse.

## Bulk CSV upload

The Applications tab has a **Bulk Upload Candidates (CSV)** card. Pick a `.csv`
file and every row is queued for agent screening in one shot.

- **Format:** a header row with a name column (`applicant_name`, `name`,
  `candidate`, …) and a text column (`raw_text`, `text`, `application`, …).
  Quoted fields with embedded commas/newlines are supported.
- **Endpoint:** `POST /api/applications/bulk` with `{ "csv": "<raw csv>" }`
  (or send raw CSV as the request body). Returns `{ created, skipped, errors }`
  with per-row error messages for anything skipped (missing name/text). Capped at
  1000 rows per upload.
- A **sample CSV** is downloadable from the card (served at
  `/sample-applications.csv`).

## LLM providers

Priority: `ANTHROPIC_API_KEY` → `NVIDIA_API_KEY` → offline **mock** (deterministic
responses in `lib/mock.ts`, so the full loop is demoable with no key). NVIDIA's
endpoint is OpenAI-compatible and hosts Llama/Nemotron (not Claude), so it goes
through the `openai` SDK. Set keys as Vercel **Environment Variables**.

## Deploy to Vercel

1. **Push to GitHub** and import the repo in Vercel.
2. **Root Directory** → set to `web` (this folder).
3. **Add a Postgres database**: Vercel dashboard → Storage → create a Postgres
   (Neon) store and connect it to the project. It injects `DATABASE_URL`
   automatically. (Any Neon/Supabase pooled connection string also works — set
   `DATABASE_URL` yourself.)
4. **Environment Variables** (Project → Settings → Environment Variables):
   - `NVIDIA_API_KEY` = `nvapi-...` (or `ANTHROPIC_API_KEY` for Claude)
   - optional: `NVIDIA_MODEL`, `CLAUDE_MODEL`
   - none set → runs in mock mode
5. **Deploy.** Tables are created automatically on first request. The cron in
   `vercel.json` (`/api/cron/tick`, every minute) is registered on deploy.

> **Plan note:** long agent calls (the 3-message outreach on NVIDIA's free tier
> can take ~90s) may exceed Hobby function limits. The route exports
> `maxDuration = 300`; Vercel clamps it to your plan's cap (Pro recommended for
> the slower models). Screening (~8s) is fine on any plan.

## Local development

```bash
cd web
npm install
cp .env.example .env.local   # set DATABASE_URL (+ optional NVIDIA_API_KEY)
npm run dev                  # http://localhost:3000
```

You need a Postgres reachable at `DATABASE_URL`. The schema is created on first
request — no migration step.
