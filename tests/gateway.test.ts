import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

const PORT = 8791 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
let child: ReturnType<typeof spawn> | null = null;
let childLogs = "";

async function waitForServer(timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  let lastErr = "";
  while (Date.now() - start < timeoutMs) {
    if (child?.exitCode != null) {
      throw new Error(`gateway exited early (code ${child.exitCode}) logs: ${childLogs.slice(-800)}`);
    }
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
      lastErr = `status ${res.status}`;
    } catch (e) {
      lastErr = String(e).slice(0, 120);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`gateway did not start in time on ${BASE} (last: ${lastErr}) logs: ${childLogs.slice(-1200)}`);
}

before(async () => {
  rmSync(".test-gw", { recursive: true, force: true });
  // also clean possible stale WAL files from previous run
  rmSync(".test-gw-journal", { recursive: true, force: true });
  childLogs = "";
  child = spawn(process.execPath, ["--experimental-transform-types", "apps/gateway/src/main.ts"], {
    env: { ...process.env, PORT: String(PORT), JARVIS_DATA_DIR: ".test-gw", NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d: Buffer) => { childLogs += d.toString(); });
  child.stderr?.on("data", (d: Buffer) => { childLogs += d.toString(); });
  child.on("error", (e) => { childLogs += `spawn error: ${e.message}\n`; });
  await waitForServer();
});

after(() => {
  try { child?.kill(); } catch {}
  setTimeout(() => {
    try { rmSync(".test-gw", { recursive: true, force: true }); } catch {}
  }, 500);
});

test("health reports brain and model", async () => {
  const res = await fetch(`${BASE}/api/health`);
  const json = (await res.json()) as { ok: boolean; brain: string; model: string };
  assert.equal(json.ok, true);
  assert.equal(json.brain, "mock");
  assert.equal(json.model, "mock-brain");
});

test("tools endpoint lists registered tools with risk levels", async () => {
  const res = await fetch(`${BASE}/api/tools`);
  const tools = (await res.json()) as Array<{ id: string; riskLevel: string; group: string }>;
  assert.ok(tools.length >= 10);
  assert.ok(tools.some((t) => t.id === "fs.list" && t.riskLevel === "read"));
  assert.ok(tools.some((t) => t.id === "computer.run_command" && t.riskLevel === "critical"));
});

test("memory CRUD via API", async () => {
  const created = await fetch(`${BASE}/api/memory`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "preference", subject: "test_subject", content: "test content for api" }),
  });
  assert.equal(created.status, 200);
  const mem = (await created.json()) as { id: string };
  const list = (await (await fetch(`${BASE}/api/memory`)).json()) as Array<{ id: string }>;
  assert.ok(list.some((m) => m.id === mem.id));
  const del = await fetch(`${BASE}/api/memory/${mem.id}`, { method: "DELETE" });
  assert.equal(del.status, 200);
});

test("task creation via API", async () => {
  const res = await fetch(`${BASE}/api/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "API task", goal: "verify api task creation" }),
  });
  const t = (await res.json()) as { id: string; title: string };
  assert.equal(t.title, "API task");
  const list = (await (await fetch(`${BASE}/api/tasks`)).json()) as Array<{ id: string }>;
  assert.ok(list.some((x) => x.id === t.id));
});

test("monitor creation and listing via API", async () => {
  const res = await fetch(`${BASE}/api/monitors`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "local http", type: "condition", target: "clock", condition: "state == x", frequency: "1m" }),
  });
  const m = (await res.json()) as { id: string; name: string };
  assert.equal(m.name, "local http");
  const list = (await (await fetch(`${BASE}/api/monitors`)).json()) as Array<{ id: string }>;
  assert.ok(list.some((x) => x.id === m.id));
});

test("chat via HTTP returns a mock reply and persists messages", async () => {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ threadId: "api-thread", text: "hello jarvis" }),
  });
  const r = (await res.json()) as { reply: string };
  assert.ok(r.reply.length > 0);
  const msgs = (await (await fetch(`${BASE}/api/threads/api-thread/messages`)).json()) as Array<{ role: string }>;
  assert.equal(msgs.length, 2);
});

test("audit log records gateway actions", async () => {
  const audit = (await (await fetch(`${BASE}/api/audit`)).json()) as Array<{ action: string }>;
  assert.ok(audit.length >= 1);
});
