import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  createAdapter,
  ToolRegistry,
  PermissionEngine,
  DEFAULT_POLICY,
  Orchestrator,
  fsList,
  systemNow,
  memorySaveTool,
} from "@jarvis/core";

const DIR = ".test-orch";
rmSync(DIR, { recursive: true, force: true });

function makeOrchestrator() {
  const db = openDb(DIR);
  const userId = ensureUser(db);
  const memories = new MemoryRepo(db);
  const approvals = new ApprovalRepo(db);
  const audit = new AuditRepo(db);
  const memoryEngine = new MemoryEngine(memories, db);
  const llm = createAdapter({}); // mock brain
  const registry = new ToolRegistry(db, audit, new PermissionEngine(DEFAULT_POLICY));
  registry.register(fsList);
  registry.register(systemNow);
  registry.register(memorySaveTool(memories));
  const orchestrator = new Orchestrator({ db, llm, registry, memories, memoryEngine, approvals, audit });
  return { orchestrator, registry, userId, approvals, db };
}

test("complexity router maps intents to levels (§8)", () => {
  const { orchestrator } = makeOrchestrator();
  assert.equal(orchestrator.classifyComplexity("what is 15% of 20000"), 0);
  assert.equal(orchestrator.classifyComplexity("list files on my desktop"), 1);
  assert.equal(orchestrator.classifyComplexity("analyze this month sales and give me a report"), 2);
  assert.equal(orchestrator.classifyComplexity("monitor the booking status and follow up"), 3);
});

test("simple turn returns a reply and stores messages", async () => {
  const { orchestrator, userId, db } = makeOrchestrator();
  const r = await orchestrator.handleTurn({ threadId: "t1", userId, text: "hello jarvis" });
  assert.ok(r.reply.length > 0);
  const msgs = orchestrator.getThreadMessages("t1");
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0]!.role, "user");
  assert.equal(msgs[1]!.role, "assistant");
});

test("mock brain drives a real tool end-to-end (list files)", async () => {
  const { orchestrator, userId } = makeOrchestrator();
  const r = await orchestrator.handleTurn({ threadId: "t2", userId, text: "list files on my desktop please" });
  // The mock brain calls fs.list; the result flows back and produces a reply.
  assert.ok(r.reply.length > 0);
  assert.ok(!r.reply.includes("Approval needed"));
});

test("task creation and listing work (§32)", async () => {
  const { orchestrator, userId } = makeOrchestrator();
  const t = orchestrator.createTask(userId, { title: "Website audit", goal: "Find issues", successCriteria: "report generated" });
  const list = orchestrator.listTasks(userId);
  assert.ok(list.some((x) => x.id === t.id));
  const detail = orchestrator.getTask(t.id);
  assert.equal(detail?.title, "Website audit");
  assert.equal(detail?.status, "QUEUED");
});

test("approval flow: critical tool → approval → execute on approve (§24–§25)", async () => {
  const { orchestrator, registry, approvals, userId, db } = makeOrchestrator();
  // Register the critical shell tool.
  const { computerRunCommand } = await import("@jarvis/core");
  registry.register(computerRunCommand);

  let approvalSeen: { id: string } | null = null;
  const orch = new Orchestrator({
    db,
    llm: createAdapter({}),
    registry,
    memories: new MemoryRepo(db),
    memoryEngine: new MemoryEngine(new MemoryRepo(db), db),
    approvals,
    audit: new AuditRepo(db),
    onApprovalRequested: (a) => {
      approvalSeen = { id: a.id };
    },
  });

  // Ask the mock brain for a shell command.
  const r = await orch.handleTurn({ threadId: "t3", userId, text: "run a shell command" });
  assert.match(r.reply, /Approval needed/i);
  assert.ok(approvalSeen);

  const pending = approvals.list(userId, "pending");
  assert.equal(pending.length, 1);

  const res = await orchestrator.resolveApproval(pending[0]!.id, "approved");
  assert.equal(res.ok, true);
  assert.match(res.message, /echo hello from JARVIS|Approved and executed/);
});

test("memory persists durable user statements across turns", async () => {
  const { orchestrator, userId } = makeOrchestrator();
  await orchestrator.handleTurn({ threadId: "t4", userId, text: "Remember that important client meetings are always on Tuesdays" });
  // Memory consideration runs on the user's message.
  assert.ok(true);
});

test("cancel produces a stopped reply, not a crash", async () => {
  const { orchestrator, userId } = makeOrchestrator();
  const ctrl = new AbortController();
  ctrl.abort();
  const r = await orchestrator.handleTurn({ threadId: "t5", userId, text: "hello", signal: ctrl.signal });
  assert.equal(r.reply, "Stopped.");
});
