# JARVIS — Current Architecture Report

*Generated during the first implementation pass (Sept 2026). Companion to `JARVIS_MASTER_BLUEPRINT.md` (source of truth).*

## 1. Starting point

The repository contained only the blueprint. No UI, no backend, no history. Everything below was built from zero.

## 2. What exists now

### Monorepo (npm workspaces, TypeScript, Node 20+)

| Package | Role | Status |
|---|---|---|
| `packages/schemas` | Shared wire/domain types: intents, complexity levels, execution states, risk levels, plans, tools, memory, events, monitors, approvals, orb states, WS envelope | done |
| `packages/core` | db, LLM adapter + router, tool registry, permission engine, orchestrator, memory engine, event bus, repositories, 14 built-in tools | done |
| `packages/gateway-sdk` | Typed REST + WebSocket client for the UI | done |
| `apps/gateway` | Fastify REST API, WS hub, composition root, monitor/reminder loop, serves the built UI | done |
| `apps/worker` | Standalone background worker (§37): reminder firing + URL monitor probes on a shared store | done |
| `apps/desktop` | React 18 + Vite + Tailwind: orb, chat (streaming + voice I/O), tasks, memory, tools, command center, settings | done |

### Backend runtime model

- Node executes TypeScript sources directly (`--experimental-transform-types`), imports use `.ts` specifiers, no build step for backend packages.
- Persistence: `node:sqlite` (WAL) in `./.jarvis/jarvis.db`. Schema covers users, preferences, conversations, messages, memories, tasks, task events, monitors, approvals, tool executions, audit logs, events, reminders, documents (§31 subset, extendable).
- LLM: OpenAI-compatible streaming adapter with tool calling + tier routing (fast/general/reasoning/coding, §72). No key ⇒ deterministic MockBrain keeps the whole pipeline testable.

### Verified behaviors (33 passing tests + live browser verification)

- Complexity router L0–L3 (§8)
- Permission matrix incl. bulk thresholds (§24, §71)
- fs tools with sensitive-path guard, byte-exact write verification (§11)
- Registry schema validation, unknown-tool and unapproved-critical rejections
- Full turn: user text → memory consideration → LLM stream → tool call → execution → audit → summary reply
- Approval flow end-to-end (request → pending → approve → execute)
- Cancellation, task CRUD, gateway REST contract, WS chat round-trip

## 3. Gap analysis vs blueprint

| Blueprint area | State |
|---|---|
| Text chat, streaming, threads | ✅ done |
| Tool registry, permissions, approvals, audit | ✅ done (V1 core) |
| Memory (write rules, retrieval, review UI) | ✅ keyword-scored; semantic via pgvector pending |
| Task engine | ⚠️ tasks + events exist; multi-step planner execution (§9) is stubbed — the LLM's tool loop covers most L1–L2 work |
| Voice | ⚠️ Web Speech STT/TTS works; realtime duplex pipeline (§38) pending |
| Browser automation (§54) | ❌ Playwright tool not yet registered |
| Email/Calendar/CRM integrations (§26 V2) | ❌ not started (tools + credential vault design ready) |
| Knowledge graph (§30) | ❌ schema slot reserved, not implemented |
| Workflow builder (§65) | ❌ V3 |
| Tauri shell | ❌ runs as local web app; UI is Tauri-ready |
| Cloud control plane (§4) | ❌ single-user local; worker already separable |

## 4. Architectural decisions & rationale

1. **SQLite-first, Postgres-ready** — zero-setup local V1; repos isolate SQL so pgvector migration is a driver change.
2. **Direct-TS execution** — no emit step, one strict typecheck, faster iteration; compiles fine for later packaging.
3. **Single WS channel** — server events and client commands share `/ws`; simpler than dual endpoints and matches the UI's event model.
4. **Approval as control flow** — risky tools throw a typed approval error, the orchestrator persists the request, the UI resolves it, execution re-runs with `approved: true`. Audit covers every transition.
5. **MockBrain as first-class adapter** — reliability-first engineering (§90.17) lets the entire nervous system be tested without external dependencies.

## 5. Recommended next phases

1. **Planner engine** (§9): decompose L2/L3 goals into persisted `PlanStep`s, execute via the existing registry loop, stream step progress to the Tasks screen.
2. **Realtime voice** (§38–40): server-side VAD + streaming STT/TTS behind the existing orb state machine.
3. **Browser agent** (§54): Playwright tool group (`navigate/click/type/extract/download`), risk-modeled as `read`/`safe_write` with domain allowlist.
4. **Semantic memory** (§20): Postgres + pgvector behind `MemoryEngine`; keep keyword scorer as fallback.
5. **Credential vault** (§67–68): OS keychain-backed secret store; tools resolve credentials at execution time, prompts never see them.
6. **Tauri shell + packaging** (§86.34): wrap the existing UI; auto-update channel.
