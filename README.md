# JARVIS — Personal & Business AI Operating System

V1 implementation of `JARVIS_MASTER_BLUEPRINT.md`: a local-first, extensible AI
assistant with a real orchestrator, tool registry, permission engine, task
tracker, memory, monitors, audit log, and a live desktop-style UI.

## Quickstart

```bash
npm install
npm run ui:build     # build the desktop UI (served by the gateway)
npm run dev          # gateway at http://127.0.0.1:8787
```

Open **http://127.0.0.1:8787**. Without an API key JARVIS runs on the
deterministic mock brain (full pipeline, scripted answers). For real
intelligence, copy `.env.example` to `.env` and set:

```bash
OPENAI_API_KEY=sk-...        # any OpenAI-compatible endpoint works
OPENAI_BASE_URL=https://api.openai.com/v1   # Groq / OpenRouter / local too
JARVIS_MODEL=gpt-4o-mini
```

Optional services:

```bash
npm run dev:worker   # standalone background worker (monitors/reminders, §37)
npm run ui           # vite dev server with HMR for UI work
npm test             # 33 tests: units + orchestrator e2e + gateway API
npm run typecheck    # strict TS over backend + UI
```

## Architecture (blueprint §3, §88)

```text
apps/desktop      React+Vite+Tailwind UI: orb state machine, chat, tasks,
                  command center, memory, tools, settings, Web Speech voice
apps/gateway      Fastify REST + WebSocket hub; composition root; monitor loop
apps/worker       Standalone 24/7 nervous system (shares the SQLite store)
packages/core     db · llm adapter · registry · permissions · orchestrator ·
                  memory engine · event bus · repositories · built-in tools
packages/schemas  Shared wire/domain types (intents, plans, tools, events…)
packages/gateway-sdk  Typed REST + WS client for the UI
```

Three layers from §88: **brain** (orchestrator + memory), **hands** (14 real
tools), **nervous system** (event bus, monitors, reminders, worker).

## The core loop (§6)

Every message: understand → classify complexity (L0–L3, §8) → retrieve memory
(§28) → stream LLM with tool schemas → permission check per tool (§24) →
execute with timeout → **verify** (§11: execution ≠ success) → feed results
back (max 6 rounds) → retry transient failures once (§12) → persist messages →
report with orb state transitions (§42) → selective memory write (§29).

Risky tools never execute silently: they raise an approval request, the UI
shows it, and the action runs only after explicit user approval — destructive
shell commands included (§53, §71).

## What works today

- Streaming chat (WS) with HTTP fallback; Arabic + English
- Real tools: filesystem (list/read/write/search), web search + fetch, shell
  (approval-gated), system time, memory save/search, task create/list,
  monitor create, reminders
- Approval queue with approve/reject and post-approval execution
- Tasks with goals, success criteria, progress; Command Center (monitors,
  audit log, approvals); Memory page (review/edit/forget)
- Audit trail for every meaningful action (§66)
- Monitors + reminders fire notifications through the orb/UI (§36, §59)

## Next milestones (blueprint §86, §82–85)

Gmail/Calendar integrations, planner-driven multi-step autonomous tasks,
pgvector semantic memory on PostgreSQL, Playwright browser agent, Tauri shell,
realtime voice pipeline, cloud control plane.
