# Orvix — Roadmap to a Top-Tier Product

*Companion to `docs/ARCHITECTURE.md`. Ordered by impact.*

## Done in this pass

- **Rebrand → Orvix**: every user-facing string (UI, assistant replies, identity prompt, page title, user-agent, tool descriptions) now says Orvix. Only internal npm namespaces keep `@jarvis/*` — invisible to users.
- **Clean orb core**: no text inside the sphere — just a living energy swirl under fresnel glass.
- **Collapsible sidebar**: 208px full ⇄ 68px icon rail with smooth cubic-bezier animation, hover tooltips, active-state glow indicator, approval badge that becomes a dot when collapsed.
- **Professional icon set**: 17 hand-drawn 1.6px-stroke SVG icons replaced every emoji across nav, composer, panels and actions.
- **UI/UX polish**: gradient headline text, glassmorphism cards/toasts, brand wordmark in Orbitron, refined composer (icon buttons, mic with pulse ring), grid+aurora+particle background, English throughout.

---

## Phase 1 — Make the brain real (highest impact, ~1 day)

The mock brain is scripted. Everything else is real. Priority order:

1. **Wire a real LLM** — `OPENAI_API_KEY` in `.env` already activates it (OpenAI / Groq free tier / OpenRouter / local Ollama all work — any OpenAI-compatible endpoint). Set `OPENAI_BASE_URL=https://api.groq.com/openai/v1` + a Groq key for a free, fast start. Verify: ask it something the mock can't answer.
2. **Streaming tool-call UX** — show tool chips in the chat bubble while tools run ("Running fs.list…") instead of only orb state.
3. **Stop/cancel button** — abort the in-flight turn from the UI (the orchestrator already accepts an AbortSignal; needs a gateway route + button).

## Phase 2 — Feel like a native app (~2 days)

4. **Tauri wrapper** — real window with tray icon, global hotkey (e.g. Ctrl+Space to summon), always-on-top mini-orb overlay mode, autostart. The gateway becomes a Tauri sidecar.
5. **Real-time voice** — replace the press-to-talk Web Speech with continuous listening: wake word ("hey Orvix"), barge-in (speak while it talks and it stops), orb reacts to actual mic/speaker amplitude via Web Audio analyser.
6. **Boot sequence** — 1.5s HUD startup animation (rings assemble, "INITIALIZING… LINK ONLINE") once per session. Small touch, huge perceived quality.

## Phase 3 — Memory & competence (~3–4 days)

7. **Semantic memory** — embeddings + vector search (sqlite-vec keeps it local) so recall is by meaning, not keyword. Also: session summaries written back automatically, and a memory timeline UI.
8. **Planner engine (blueprint §9)** — multi-step plans as first-class tasks: the L2/L3 goals decompose into steps, each step runs through the tool registry with per-step verification, progress streams to the Tasks screen live.
9. **File watch + app control** — tools that watch folders, open apps, read clipboard. This is where "personal operating system" starts feeling literal.

## Phase 4 — Trust & depth (ongoing)

10. **Approval center v2** — diff preview before approving file writes, one-click "always allow this tool", approval history with reasons.
11. **Daily briefing** — morning voice summary: calendar, monitors triggered, tasks due, news on watched topics.
12. **Multi-profile** — work/personal contexts with separate memory scopes.

## Design debt (small, worth scheduling)

- Message markdown rendering (bold, lists, code blocks) — replies currently render plain text.
- Empty-state illustrations and first-run onboarding card.
- Light theme (tokens already centralized in `styles.css` `:root`).
- Keyboard shortcuts (Ctrl+K command palette over screens + actions).

## Suggested immediate next step

**Phase 1.1 (real LLM via Groq free tier)** — 30 minutes of config for a 10× capability jump, no code changes needed.
