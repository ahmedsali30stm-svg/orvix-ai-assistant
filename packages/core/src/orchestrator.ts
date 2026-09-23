import type {
  ChatMessage,
  Plan,
  TaskDetail,
  TaskSummary,
  OrbState,
} from "@jarvis/schemas";
import { JarvisError } from "@jarvis/schemas";
import type { Db } from "./db.ts";
import { uid, now } from "./db.ts";
import type { MemoryRepo, ApprovalRepo, AuditRepo } from "./repos.ts";
import type { MemoryEngine } from "./memory.ts";
import type { LlmAdapter, LlmToolCall } from "./llm.ts";
import type { ToolRegistry } from "./registry.ts";
import type { ToolContext, ToolResult } from "@jarvis/schemas";
import { isDestructiveCommand } from "./tools.ts";
import { logger } from "./logger.ts";

// ── Orchestrator: the core loop (blueprint §6, §86) ───────────────────────
// Understand → classify → retrieve context → plan/act → verify → respond.

export interface OrchestratorDeps {
  db: Db;
  llm: LlmAdapter;
  registry: ToolRegistry;
  memories: MemoryRepo;
  memoryEngine: MemoryEngine;
  approvals: ApprovalRepo;
  audit: AuditRepo;
  onDelta?: (text: string) => void;
  onApprovalRequested?: (approval: { id: string; taskId: string | null; action: string; detail: string; riskLevel: string }) => void;
  onTaskUpdated?: (task: TaskDetail) => void;
  onOrb?: (state: OrbState, activity?: string) => void;
}

export interface TurnOptions {
  threadId: string;
  userId: string;
  text: string;
  signal?: AbortSignal;
}

const MAX_TOOL_ROUNDS = 6;

export class Orchestrator {
  constructor(private deps: OrchestratorDeps) {}

  private orb(state: OrbState, activity?: string) {
    this.deps.onOrb?.(state, activity);
  }

  private emitTask(taskId: string): void {
    const detail = this.getTask(taskId);
    if (detail) this.deps.onTaskUpdated?.(detail);
  }

  // ── Task persistence ──────────────────────────────────────────────────
  createTask(userId: string, spec: { title: string; goal: string; description?: string; successCriteria?: string; priority?: number; threadId?: string }): { id: string; title: string } {
    const id = uid("task");
    this.deps.db
      .prepare(
        "INSERT INTO tasks (id, user_id, title, goal, description, status, priority, plan_json, success_criteria, thread_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?, ?, ?, ?)",
      )
      .run(id, userId, spec.title, spec.goal, spec.description ?? null, spec.priority ?? 2, JSON.stringify({ steps: [] }), spec.successCriteria ?? null, spec.threadId ?? null, now(), now());
    this.deps.audit.log(userId, "jarvis", "task.created", `${spec.title} (${id})`);
    return { id, title: spec.title };
  }

  listTasks(userId: string, opts?: { includeCompleted?: boolean }): TaskSummary[] {
    const rows = this.deps.db
      .prepare("SELECT * FROM tasks WHERE user_id = ? ORDER BY updated_at DESC LIMIT 200")
      .all(userId) as Record<string, unknown>[];
    return rows
      .map(taskRowToSummary)
      .filter((t) => opts?.includeCompleted || t.status !== "COMPLETED");
  }

  getTask(id: string): TaskDetail | undefined {
    const row = this.deps.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    const plan = JSON.parse(String(row.plan_json ?? "{}")) as Plan;
    const events = this.deps.db
      .prepare("SELECT at, kind, text FROM task_events WHERE task_id = ? ORDER BY at ASC")
      .all(id) as Array<{ at: string; kind: string; text: string }>;
    const steps = Array.isArray(plan.steps) ? plan.steps : [];
    const done = steps.filter((s) => s.status === "completed").length;
    return {
      id: String(row.id),
      title: String(row.title),
      goal: String(row.goal),
      description: row.description == null ? null : String(row.description),
      status: row.status as TaskDetail["status"],
      priority: Number(row.priority),
      progress: { done, total: steps.length },
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      successCriteria: row.success_criteria == null ? null : String(row.success_criteria),
      requiresApproval: Number(row.requires_approval) === 1,
      steps,
      events,
    };
  }

  private taskEvent(taskId: string, kind: string, text: string): void {
    this.deps.db
      .prepare("INSERT INTO task_events (id, task_id, at, kind, text) VALUES (?, ?, ?, ?, ?)")
      .run(uid("tev"), taskId, now(), kind, text);
  }

  // ── Conversation history ──────────────────────────────────────────────
  private ensureConversation(userId: string, threadId: string): void {
    const row = this.deps.db.prepare("SELECT id FROM conversations WHERE id = ? AND user_id = ?").get(threadId, userId);
    if (!row) {
      this.deps.db
        .prepare("INSERT INTO conversations (id, user_id, title, created_at) VALUES (?, ?, ?, ?)")
        .run(threadId, userId, threadId === "main" ? "Home" : `Thread ${threadId.slice(-6)}`, now());
    }
  }

  private history(threadId: string, limit = 12): ChatMessage[] {
    const rows = this.deps.db
      .prepare("SELECT id, conversation_id, role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC")
      .all(threadId) as Array<{ id: string; conversation_id: string; role: ChatMessage["role"]; content: string; created_at: string }>;
    return rows.slice(-limit).map((r) => ({ id: r.id, threadId: r.conversation_id, role: r.role, content: r.content, createdAt: r.created_at }));
  }

  private appendMessage(threadId: string, role: ChatMessage["role"], content: string): void {
    this.deps.db
      .prepare("INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(uid("msg"), threadId, role, content, now());
  }

  listThreads(userId: string): Array<{ id: string; title: string; createdAt: string; messageCount: number }> {
    const rows = this.deps.db
      .prepare(
        `SELECT c.id, c.title, c.created_at, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
         FROM conversations c WHERE c.user_id = ? ORDER BY c.created_at DESC`,
      )
      .all(userId) as Array<{ id: string; title: string; created_at: string; message_count: number }>;
    return rows.map((r) => ({ id: r.id, title: r.title, createdAt: r.created_at, messageCount: r.message_count }));
  }

  getThreadMessages(threadId: string): ChatMessage[] {
    const rows = this.deps.db
      .prepare("SELECT id, conversation_id, role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC")
      .all(threadId) as Array<{ id: string; conversation_id: string; role: ChatMessage["role"]; content: string; created_at: string }>;
    return rows.map((r) => ({ id: r.id, threadId: r.conversation_id, role: r.role, content: r.content, createdAt: r.created_at }));
  }

  // ── Complexity router (§8) ────────────────────────────────────────────
  classifyComplexity(text: string): 0 | 1 | 2 | 3 {
    const t = text.toLowerCase();
    if (/\b(monitor|watch|track|follow|تابع|راقب)\b/.test(t) || /\b(then|after that|ثم|بعدها)\b/.test(t)) return 3;
    if (/\b(analy[sz]e|report|compare|plan|audit|workflow|automate|قم بتحليل|قارن)\b/.test(t)) return 2;
    if (/\b(list|find|search|read|show|open|time|date|weather|اشوف|اعرض)\b/.test(t)) return 1;
    return 0;
  }

  // ── Prompt builder (§73–§75) ──────────────────────────────────────────
  private buildSystemPrompt(userId: string, query: string, toolIds: string[]): string {
    const memBlock = this.deps.memoryEngine.contextBlock(userId, query);
    const identity = [
      "You are Orvix, the user's personal and business operating system.",
      "You understand goals, retrieve context, plan when needed, use tools to execute real actions, verify results, and remember useful facts.",
      "Never claim an action happened unless a tool result confirms it. Prefer executing over explaining. Ask precise questions only when genuinely blocked.",
      "You may communicate in English or Egyptian Arabic; mirror the user's language.",
      "To open a URL, app, or file for the user, use the computer.open tool — never raw shell commands like xdg-open or start.",
    ];
    const toolsBlock = `Available tools: ${toolIds.join(", ") || "none"}. Use tools when they help reach the outcome; otherwise answer directly.`;
    return [identity.join(" "), toolsBlock, memBlock].filter(Boolean).join("\n\n");
  }

  private toolContext(userId: string, opts: { signal?: AbortSignal }): ToolContext {
    return { db: this.deps.db, userId, signal: opts.signal };
  }

  // ── Tool execution with permission gate + recovery (§12) ─────────────
  private async runTool(
    toolId: string,
    input: Record<string, unknown>,
    userId: string,
    opts: { taskId?: string; stepId?: string; signal?: AbortSignal },
  ): Promise<ToolResult & { verification?: import("@jarvis/schemas").VerificationResult; executionId: string }> {
    // Destructive shell commands escalate to explicit approval (§53, §71).
    if (toolId === "computer.run_command" && typeof input.command === "string" && isDestructiveCommand(input.command)) {
      const approval = this.deps.approvals.create({
        userId,
        taskId: opts.taskId ?? null,
        stepId: opts.stepId ?? null,
        toolId,
        action: `Run command: ${input.command.slice(0, 120)}`,
        detail: "Destructive command pattern matched — explicit approval required",
        payload: { toolId, input },
        riskLevel: "critical",
      });
      this.deps.audit.log(userId, "system", "approval.requested", `destructive command: ${String(input.command).slice(0, 80)}`);
      this.deps.onApprovalRequested?.({ id: approval.id, taskId: approval.taskId, action: approval.action, detail: approval.detail, riskLevel: approval.riskLevel });
      throw new ApprovalNeededError(approval.id, approval.action, approval.taskId ?? undefined);
    }

    try {
      return await this.deps.registry.execute(toolId, input, this.toolContext(userId, { signal: opts.signal }), {
        taskId: opts.taskId,
        stepId: opts.stepId,
      });
    } catch (err) {
      if (err instanceof JarvisError && (err as JarvisError & { approvalRequired?: boolean }).approvalRequired) {
        const riskLevel = (err as unknown as { riskLevel?: string }).riskLevel ?? "external_write";
        const approval = this.deps.approvals.create({
          userId,
          taskId: opts.taskId ?? null,
          stepId: opts.stepId ?? null,
          toolId,
          action: `Use tool ${toolId}`,
          detail: "Risk policy requires approval before this action",
          payload: { toolId, input },
          riskLevel: riskLevel as never,
        });
        this.deps.audit.log(userId, "system", "approval.requested", `${toolId}: approval gate`);
        this.deps.onApprovalRequested?.({ id: approval.id, taskId: approval.taskId, action: approval.action, detail: approval.detail, riskLevel: approval.riskLevel });
        throw new ApprovalNeededError(approval.id, approval.action, approval.taskId ?? undefined);
      }
      throw err;
    }
  }

  private async runToolWithRecovery(
    toolId: string,
    input: Record<string, unknown>,
    userId: string,
    opts: { taskId?: string; stepId?: string; signal?: AbortSignal },
  ): Promise<{ ok: true; result: ToolResult & { verification?: import("@jarvis/schemas").VerificationResult; executionId: string }; note: string } | { ok: false; note: string }> {
    try {
      let result = await this.runTool(toolId, input, userId, opts);
      // One retry for transient failures (§12: classify → recoverable → retry).
      if (!result.ok && result.retryable) {
        logger.info("tool.retry", { toolId });
        result = await this.runTool(toolId, input, userId, opts);
      }
      if (!result.ok) return { ok: false as const, note: `Tool ${toolId} failed → ${result.summary}` };
      const v = result.verification;
      const vNote = v ? (v.verified ? "verified" : `verification FAILED: ${v.detail ?? ""}`) : "no verifier";
      return { ok: true as const, result, note: vNote };
    } catch (err) {
      if (err instanceof ApprovalNeededError) throw err;
      if (err instanceof JarvisError && err.category === "Permission") {
        return { ok: false, note: `Tool ${toolId} denied → ${err.message}` };
      }
      const note = err instanceof JarvisError ? `${err.category}: ${err.message}` : String(err);
      return { ok: false, note: `Tool ${toolId} error → ${note}` };
    }
  }

  // ── Main turn ─────────────────────────────────────────────────────────
  async handleTurn(opts: TurnOptions): Promise<{ reply: string; taskId?: string }> {
    const { userId, threadId, text, signal } = opts;
    this.orb("UNDERSTANDING", "Understanding...");

    this.ensureConversation(userId, threadId);
    const history = this.history(threadId);
    this.appendMessage(threadId, "user", text);

    const level = this.classifyComplexity(text);
    const toolIds = this.deps.registry.list().map((d) => d.id);
    const systemPrompt = this.buildSystemPrompt(userId, text, toolIds);

    const llmMessages: Array<{ role: string; content: string }> = [
      { role: "system", content: systemPrompt },
      ...history
        .slice(-16) // keep provider token budgets (free tiers) in check
        .map((m) => ({ role: m.role === "assistant" ? "assistant" : m.role === "system" ? "system" : "user", content: m.content.slice(0, 4_000) })),
      { role: "user", content: text },
    ];

    const registryIds = new Set(toolIds);
    this.orb(level >= 2 ? "PLANNING" : "THINKING", level >= 2 ? "Planning..." : "Thinking...");

    let reply = "";
    let round = 0;

    try {
      while (round < MAX_TOOL_ROUNDS) {
        round++;
        if (signal?.aborted) throw new JarvisError("Cancelled", "Turn cancelled");

        let textOut = "";
        const calls: LlmToolCall[] = [];
        for await (const chunk of this.deps.llm.stream({
          messages: llmMessages,
          tools: this.deps.registry.descriptorsFor(toolIds),
          signal,
          tier: level >= 2 ? "reasoning" : level === 1 ? "fast" : "general",
        })) {
          if (chunk.text) {
            textOut += chunk.text;
            this.deps.onDelta?.(chunk.text);
          }
          calls.push(...chunk.toolCalls);
        }

        if (calls.length === 0) {
          reply = textOut.trim() || "(no response)";
          break;
        }

        // Execute this round's tool calls, feed results back to the model.
        const roundNotes: string[] = [];
        for (const call of calls) {
          if (!registryIds.has(call.name)) {
            roundNotes.push(`Tool ${call.name} is not available.`);
            continue;
          }
          this.orb("EXECUTING", `Executing ${call.name}...`);
          let parsed: Record<string, unknown> = {};
          try {
            parsed = call.arguments ? (JSON.parse(call.arguments) as Record<string, unknown>) : {};
          } catch {
            parsed = { _raw: call.arguments };
          }
          const outcome = await this.runToolWithRecovery(call.name, parsed, userId, { signal });
          if (outcome.ok) {
            roundNotes.push(`Tool ${call.name} → ok=true (${outcome.note}). ${outcome.result.summary} ${JSON.stringify(outcome.result.data ?? {}).slice(0, 1500)}`);
          } else {
            roundNotes.push(outcome.note);
          }
        }
        for (const n of roundNotes) {
          llmMessages.push({ role: "user", content: `[tool result] ${n}` });
        }
      }

      if (!reply) {
        reply = "I reached my tool-use limit mid-task. Latest status: " + roundSummary(llmMessages);
      }
    } catch (err) {
      if (err instanceof ApprovalNeededError) {
        reply = `Approval needed (request ${err.approvalId}). ${err.action}`;
        this.orb("WAITING", "Waiting for your approval...");
        this.appendMessage(threadId, "assistant", reply);
        return { reply };
      }
      if (err instanceof JarvisError && err.category === "Cancelled") {
        reply = "Stopped.";
        this.appendMessage(threadId, "assistant", reply);
        this.orb("IDLE");
        return { reply };
      }
      logger.error("turn.failed", { error: String(err) });
      reply = "Something went wrong while handling that: " + String(err).slice(0, 200);
      this.orb("ERROR");
      this.appendMessage(threadId, "assistant", reply);
      return { reply };
    }

    this.appendMessage(threadId, "assistant", reply);
    this.orb("SUCCESS");
    setTimeout(() => this.orb("IDLE"), 2500);

    // Selective memory write (§29).
    this.deps.memoryEngine.considerFromMessage(userId, text);
    return { reply };
  }

  // ── Approvals ─────────────────────────────────────────────────────────
  listApprovals(userId: string, status?: "pending" | "approved" | "rejected") {
    return this.deps.approvals.list(userId, status);
  }

  async resolveApproval(id: string, decision: "approved" | "rejected"): Promise<{ ok: boolean; message: string; taskId?: string }> {
    const approval = this.deps.approvals.decide(id, decision);
    if (!approval) return { ok: false, message: "Approval not found" };
    this.deps.audit.log("local", "user", `approval.${decision}`, `${approval.toolId}: ${approval.action}`);
    if (decision === "rejected") {
      this.orb("IDLE");
      return { ok: true, message: "Rejected. Orvix will not perform this action.", taskId: approval.taskId ?? undefined };
    }
    const payload = approval.payload as { toolId: string; input: Record<string, unknown> };
    try {
      const result = await this.deps.registry.execute(payload.toolId, payload.input, this.toolContext("local", {}), {
        approved: true,
        taskId: approval.taskId ?? undefined,
        stepId: approval.stepId ?? undefined,
      });
      this.orb("SUCCESS");
      setTimeout(() => this.orb("IDLE"), 2000);
      return { ok: true, message: `Approved and executed: ${result.summary}`, taskId: approval.taskId ?? undefined };
    } catch (err) {
      this.orb("ERROR");
      return { ok: false, message: `Approved but execution failed: ${String(err).slice(0, 200)}` };
    }
  }

  cancelTurn(): void {
    this.cancelControllers.forEach((c) => c.abort());
    this.cancelControllers.clear();
  }

  private cancelControllers = new Set<AbortController>();

  registerController(ctrl: AbortController): void {
    this.cancelControllers.add(ctrl);
    ctrl.signal.addEventListener("abort", () => this.cancelControllers.delete(ctrl), { once: true });
  }
}

// ── Control-flow helpers ──────────────────────────────────────────────────
class ApprovalNeededError extends Error {
  constructor(
    public approvalId: string,
    public action = "This action needs your approval",
    public taskId?: string,
  ) {
    super(`Approval needed: ${approvalId}`);
  }
}

function roundSummary(llmMessages: Array<{ role: string; content: string }>): string {
  const toolNotes = llmMessages.filter((m) => m.content.startsWith("[tool result]")).map((m) => m.content.replace("[tool result] ", ""));
  return toolNotes.slice(-3).join(" | ") || "no tool results yet";
}

function taskRowToSummary(r: Record<string, unknown>): TaskSummary {
  let steps: Array<{ status: string }> = [];
  try {
    const plan = JSON.parse(String(r.plan_json ?? "{}")) as Plan;
    steps = Array.isArray(plan.steps) ? plan.steps : [];
  } catch {
    steps = [];
  }
  return {
    id: String(r.id),
    title: String(r.title),
    goal: String(r.goal),
    status: r.status as TaskSummary["status"],
    priority: Number(r.priority),
    progress: { done: steps.filter((s) => s.status === "completed").length, total: steps.length },
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}
