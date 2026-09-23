import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCors from "@fastify/cors";
import fastifyRateLimit from "@fastify/rate-limit";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Server } from "node:http";

import {
  openDb,
  ensureUser,
  MemoryRepo,
  MonitorRepo,
  ApprovalRepo,
  AuditRepo,
  ReminderRepo,
  MemoryEngine,
  EventBus,
  resolveProvider,
  ToolRegistry,
  PermissionEngine,
  DEFAULT_POLICY,
  Orchestrator,
  logger,
  uid,
} from "@jarvis/core";
import {
  fsList,
  fsRead,
  fsWrite,
  fsSearch,
  webSearch,
  webFetch,
  computerRunCommand,
  computerOpen,
  docsReadPdf,
  docsReadXlsx,
  systemNow,
  memorySaveTool,
  memorySearchTool,
  taskCreateTool,
  taskListTool,
  monitorCreateTool,
  reminderCreateTool,
} from "@jarvis/core";
import type { OrbState, WsClientMessage } from "@jarvis/schemas";
import { WsHub } from "./hub.ts";
import { startMonitors } from "./monitors.ts";
import { registerVoiceRoutes } from "./voice.ts";

const PORT = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 8787;
const DATA_DIR = process.env.JARVIS_DATA_DIR ?? ".jarvis";
const USER = "local";

// ── Composition root ──────────────────────────────────────────────────────
const db = openDb(DATA_DIR);
ensureUser(db, USER, "Local User");

const memories = new MemoryRepo(db);
const monitorRepo = new MonitorRepo(db);
const approvals = new ApprovalRepo(db);
const audit = new AuditRepo(db);
const reminders = new ReminderRepo(db);
const memoryEngine = new MemoryEngine(memories, db);
const events = new EventBus(db);

const { adapter: llm, info: provider } = resolveProvider({
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  AI_MODEL: process.env.AI_MODEL,
  JARVIS_MODEL: process.env.JARVIS_MODEL,
  JARVIS_MODEL_FAST: process.env.JARVIS_MODEL_FAST,
  JARVIS_MODEL_REASONING: process.env.JARVIS_MODEL_REASONING,
  JARVIS_MODEL_CODING: process.env.JARVIS_MODEL_CODING,
});

const permissions = new PermissionEngine(DEFAULT_POLICY);
const registry = new ToolRegistry(db, audit, permissions);
const orchestrator = new Orchestrator({
  db,
  llm,
  registry,
  memories,
  memoryEngine,
  approvals,
  audit,
});

const hub = new WsHub();
let currentMessageId = "";

// Wire realtime callbacks into the hub (orb state + streamed deltas).
const orchDeps = orchestrator as unknown as { deps: Record<string, unknown> };
orchDeps.deps.onDelta = (text: string) => {
  hub.broadcast({ type: "turn.delta", messageId: currentMessageId, text });
};
orchDeps.deps.onOrb = (state: OrbState, activity?: string) => {
  hub.broadcast({ type: "state", orb: state, activity });
};

// ── Register tools (§22) ──────────────────────────────────────────────────
registry.register(fsList);
registry.register(fsRead);
registry.register(fsWrite);
registry.register(fsSearch);
registry.register(webSearch);
registry.register(webFetch);
registry.register(computerRunCommand);
registry.register(computerOpen);
registry.register(docsReadPdf);
registry.register(docsReadXlsx);
registry.register(systemNow);
registry.register(memorySaveTool(memories));
registry.register(memorySearchTool(memories));
registry.register(
  taskCreateTool(async (userId, spec) => orchestrator.createTask(userId, spec)),
);
registry.register(
  taskListTool(async (userId) =>
    orchestrator.listTasks(userId).map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      progress: `${t.progress.done}/${t.progress.total}`,
    })),
  ),
);
registry.register(monitorCreateTool(monitorRepo));
registry.register(reminderCreateTool(reminders));

// ── Fastify app ───────────────────────────────────────────────────────────
const app = Fastify({ logger: false, trustProxy: false, bodyLimit: 10 * 1024 * 1024 });
await app.register(fastifyRateLimit, {
  global: true,
  max: 100,
  timeWindow: "1 minute",
  addHeaders: { "x-ratelimit-limit": true, "x-ratelimit-remaining": true, "x-ratelimit-reset": true },
});
await app.register(fastifyCors, { origin: true });

// Serve the desktop UI build if present (static plugins must register before listen).
const uiDist = resolve(process.cwd(), "apps/desktop/dist");
if (existsSync(uiDist)) {
  await app.register(fastifyStatic, { root: uiDist });
  app.setNotFoundHandler((req, reply) => {
    if ((req.url ?? "").startsWith("/api") || (req.url ?? "").startsWith("/ws")) {
      return reply.code(404).send({ error: "not found" });
    }
    return reply.sendFile("index.html");
  });
  logger.info("ui.serving", { dir: uiDist });
}

app.get("/api/health", async () => ({
  ok: true,
  brain: provider.kind,
  model: provider.model,
  uptimeSec: Math.round(process.uptime()),
}));

// Threads
app.get("/api/threads", async () => orchestrator.listThreads(USER));

app.get("/api/threads/:id/messages", async (req) => {
  const { id } = req.params as { id: string };
  return orchestrator.getThreadMessages(id);
});

// Tools
app.get("/api/tools", async () => registry.list());

// Memory
app.get("/api/memory", async () => memories.list(USER));
app.post("/api/memory", async (req, reply) => {
  const b = req.body as { type?: string; subject?: string; content?: string; importance?: number };
  if (!b.subject || !b.content) return reply.code(400).send({ error: "subject and content required" });
  return memories.save({
    userId: USER,
    type: (b.type as never) ?? "episodic",
    subject: b.subject,
    content: b.content,
    source: "manual",
    importance: b.importance,
  });
});
app.delete("/api/memory/:id", async (req) => {
  memories.remove((req.params as { id: string }).id);
  audit.log(USER, "user", "memory.deleted", (req.params as { id: string }).id);
  return { ok: true };
});

// Tasks
app.get("/api/tasks", async () => orchestrator.listTasks(USER));
app.get("/api/tasks/:id", async (req, reply) => {
  const t = orchestrator.getTask((req.params as { id: string }).id);
  if (!t) return reply.code(404).send({ error: "not found" });
  return t;
});
app.post("/api/tasks", async (req, reply) => {
  const b = req.body as { title?: string; goal?: string; successCriteria?: string; priority?: number };
  if (!b.title || !b.goal) return reply.code(400).send({ error: "title and goal required" });
  return orchestrator.createTask(USER, { title: b.title, goal: b.goal, successCriteria: b.successCriteria, priority: b.priority });
});

// Monitors
app.get("/api/monitors", async () => monitorRepo.list(USER));
app.post("/api/monitors", async (req, reply) => {
  const b = req.body as { name?: string; type?: string; target?: string; condition?: string; frequency?: string };
  if (!b.name || !b.target || !b.condition) return reply.code(400).send({ error: "name, target, condition required" });
  return monitorRepo.create({
    userId: USER,
    name: b.name,
    type: (b.type as never) ?? "condition",
    target: b.target,
    condition: b.condition,
    frequency: b.frequency ?? "30m",
  });
});
app.delete("/api/monitors/:id", async (req) => {
  monitorRepo.remove((req.params as { id: string }).id);
  return { ok: true };
});

// Approvals
app.get("/api/approvals", async (req) => {
  const status = (req.query as { status?: string }).status as "pending" | "approved" | "rejected" | undefined;
  return orchestrator.listApprovals(USER, status);
});
app.post("/api/approvals/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const { decision } = req.body as { decision: "approved" | "rejected" };
  if (decision !== "approved" && decision !== "rejected") return reply.code(400).send({ error: "decision must be approved|rejected" });
  const result = await orchestrator.resolveApproval(id, decision);
  hub.broadcast({ type: "approval.resolved", id, status: decision });
  return result;
});

// Always-allowed open targets (computer.open whitelist) — configurable in Settings.
app.get("/api/open-whitelist", async () => ({ targets: permissions.listAlwaysAllowed() }));
app.post("/api/open-whitelist", async (req) => {
  const { targets } = req.body as { targets?: string[] };
  if (!Array.isArray(targets)) return { ok: false, error: "targets must be a string array" };
  permissions.setAlwaysAllowed(targets);
  audit.log(USER, "system", "open_whitelist.set", targets.join(",").slice(0, 200));
  return { ok: true, targets: permissions.listAlwaysAllowed() };
});

// Voice status & local TTS/STT (Phase 1 — local after download, fallback = Web Speech)
registerVoiceRoutes(app as never);

// Audit
app.get("/api/audit", async () => audit.list(USER, 200));

// Chat over HTTP (fallback path; WebSocket is preferred by the UI) — stricter limit: 20/min per IP
app.post("/api/chat", {
  config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
}, async (req, reply) => {
  const b = req.body as { threadId?: string; text?: string };
  if (!b.text) return reply.code(400).send({ error: "text required" });
  const threadId = b.threadId || "main";
  currentMessageId = uid("msg");
  hub.broadcast({ type: "turn.started", threadId, messageId: currentMessageId });
  const result = await orchestrator.handleTurn({ threadId, userId: USER, text: b.text });
  hub.broadcast({ type: "turn.completed", messageId: currentMessageId });
  return result;
});

// ── Listen + WebSocket upgrades ───────────────────────────────────────────
await app.listen({ port: PORT, host: "127.0.0.1" });
const server = app.server as Server;

// One socket carries server events and client chat commands.
hub.onClientMessage = (msg: WsClientMessage) => {
  if (msg.type === "chat.send" && msg.text) {
    const threadId = msg.threadId || "main";
    currentMessageId = uid("msg");
    hub.broadcast({ type: "turn.started", threadId, messageId: currentMessageId });
    orchestrator
      .handleTurn({ threadId, userId: USER, text: msg.text })
      .then(() => hub.broadcast({ type: "turn.completed", messageId: currentMessageId }))
      .catch((err) => hub.broadcast({ type: "error", message: String(err).slice(0, 200) }));
  }
};

// WebSocket handshake rate-limit: 30 upgrades / minute per IP (protects LLM quota via WS)
const wsHits = new Map<string, number[]>();
function isWsRateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = wsHits.get(ip) ?? [];
  const recent = arr.filter((t) => now - t < 60_000);
  recent.push(now);
  wsHits.set(ip, recent);
  return recent.length > 30;
}
server.on("upgrade", (req, socket, head) => {
  if ((req.url ?? "").startsWith("/ws")) {
    const ip = (req.socket.remoteAddress ?? "127.0.0.1") as string;
    if (isWsRateLimited(ip)) {
      socket.write("HTTP/1.1 429 Too Many Requests\r\n\r\n");
      socket.destroy();
      return;
    }
    hub.handleUpgrade(req, socket, head as never);
  } else {
    socket.destroy();
  }
});

// ── Monitors + reminders loop (nervous system, §36–§37) ───────────────────
// Gateway runs monitors by default; set JARVIS_GATEWAY_MONITORS=false when a dedicated worker is running to avoid duplicate probes.
if (process.env.JARVIS_GATEWAY_MONITORS !== "false") {
  startMonitors({ monitorRepo, reminders, audit, events, hub, everyMs: 30_000 });
  logger.info("monitors.started", { everyMs: 30_000, via: "gateway" });
} else {
  logger.info("monitors.skipped", { reason: "JARVIS_GATEWAY_MONITORS=false — worker owns monitors" });
}

logger.info("gateway.ready", {
  url: `http://127.0.0.1:${PORT}`,
  brain: llm.modelFor(),
  tools: registry.list().length,
  dataDir: resolve(DATA_DIR),
  ui: existsSync(uiDist) ? uiDist : "not built",
});
