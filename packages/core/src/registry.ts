import type {
  JarvisTool,
  ToolContext,
  ToolResult,
  ToolDescriptor,
  VerificationResult,
  RiskLevel,
} from "@jarvis/schemas";
import { JarvisError } from "@jarvis/schemas";
import type { PermissionEngine } from "./permissions.ts";
import { PermissionEngine as PermissionEngineImpl, DEFAULT_POLICY } from "./permissions.ts";
import type { Db } from "./db.ts";
import { uid, now } from "./db.ts";
import type { AuditRepo } from "./repos.ts";

// ── Tool registry (blueprint §22, §23) ────────────────────────────────────

export class ToolRegistry {
  private tools = new Map<string, JarvisTool>();
  permissionEngine: PermissionEngine;

  constructor(
    private db: Db,
    private audit: AuditRepo,
    permissionEngine?: PermissionEngine,
  ) {
    this.permissionEngine = permissionEngine ?? new PermissionEngineImpl(DEFAULT_POLICY);
  }

  register(tool: JarvisTool): void {
    if (this.tools.has(tool.descriptor.id)) {
      throw new Error(`Tool already registered: ${tool.descriptor.id}`);
    }
    this.tools.set(tool.descriptor.id, tool);
  }

  get(id: string): JarvisTool | undefined {
    return this.tools.get(id);
  }

  list(): ToolDescriptor[] {
    return [...this.tools.values()].map((t) => t.descriptor);
  }

  descriptorsFor(ids: string[]): ToolDescriptor[] {
    return this.list().filter((d) => ids.includes(d.id));
  }

  /** Validate input against the tool's declared parameter schema. */
  private validate(tool: JarvisTool, input: Record<string, unknown>): void {
    for (const p of tool.descriptor.params) {
      const v = input[p.name];
      if (v === undefined || v === null) {
        if (p.required) throw new JarvisError("InvalidInput", `Missing required parameter: ${p.name}`);
        continue;
      }
      const actual = Array.isArray(v) ? "array" : typeof v;
      if (p.type === "number" && actual !== "number") throw new JarvisError("InvalidInput", `Parameter ${p.name} must be a number`);
      if (p.type === "boolean" && actual !== "boolean") throw new JarvisError("InvalidInput", `Parameter ${p.name} must be a boolean`);
      if (p.type === "string" && actual !== "string") throw new JarvisError("InvalidInput", `Parameter ${p.name} must be a string`);
      if (p.type === "object" && actual !== "object") throw new JarvisError("InvalidInput", `Parameter ${p.name} must be an object`);
      if (p.type === "array" && actual !== "array") throw new JarvisError("InvalidInput", `Parameter ${p.name} must be an array`);
      if (p.enum && !p.enum.includes(String(v))) throw new JarvisError("InvalidInput", `Parameter ${p.name} must be one of: ${p.enum.join(", ")}`);
    }
  }

  /**
   * Execute a tool after permission check, validation, timeout, audit logging.
   * Runs the tool's own verifier when present — execution is not success (§11).
   */
  async execute(
    toolId: string,
    input: Record<string, unknown>,
    ctx: ToolContext,
    opts?: { taskId?: string; stepId?: string; approved?: boolean; bulk?: { count: number; kind: "emailRecipients" | "whatsappMessages" | "recordDeletes" } },
  ): Promise<ToolResult & { verification?: VerificationResult; executionId: string }> {
    const tool = this.tools.get(toolId);
    if (!tool) throw new JarvisError("ToolUnavailable", `Unknown tool: ${toolId}`);

    const execId = uid("tex");
    const started = now();

    try {
      this.validate(tool, input);
    } catch (err) {
      this.audit.log(ctx.userId, "system", `tool.${toolId}.invalid`, JSON.stringify(input).slice(0, 200));
      throw err;
    }

    // computer.open bypass: user-whitelisted targets skip the approval gate
    // (still validated + audited — only the human prompt is skipped).
    let approved = opts?.approved;
    if (
      !approved &&
      toolId === "computer.open" &&
      "isAlwaysAllowed" in this.permissionEngine &&
      typeof this.permissionEngine.isAlwaysAllowed === "function" &&
      this.permissionEngine.isAlwaysAllowed(String(input.target ?? ""))
    ) {
      approved = true;
      this.audit.log(ctx.userId, "system", `tool.${toolId}.autoapproved`, `whitelisted target: ${String(input.target ?? "").slice(0, 100)}`);
    }

    const decision = this.permissionEngine.decide(tool.descriptor.riskLevel, opts?.bulk ? { bulkCount: opts.bulk.count, bulkKind: opts.bulk.kind } : undefined);
    if (!decision.allowed) {
      this.audit.log(ctx.userId, "system", `tool.${toolId}.denied`, decision.reason);
      throw new JarvisError("Permission", `Tool ${toolId} denied: ${decision.reason}`);
    }

    if (decision.requiresApproval && !approved) {
      this.audit.log(ctx.userId, "system", `tool.${toolId}.approval_required`, decision.reason);
      const err = new JarvisError("Permission", `Approval required for ${toolId}`, false) as JarvisError & { approvalRequired: true; riskLevel: RiskLevel };
      err.approvalRequired = true;
      err.riskLevel = tool.descriptor.riskLevel;
      throw err;
    }

    // Timeout wrapper (§23).
    const timeoutMs = tool.descriptor.timeoutMs || 30_000;
    const signal = ctx.signal;
    const timer = new Promise<never>((_, reject) => {
      const t = setTimeout(() => reject(new JarvisError("Timeout", `Tool ${toolId} timed out after ${timeoutMs}ms`, true)), timeoutMs);
      signal?.addEventListener("abort", () => {
        clearTimeout(t);
        reject(new JarvisError("Cancelled", "Aborted by user"));
      }, { once: true });
    });

    let result: ToolResult;
    try {
      result = await Promise.race([tool.execute(input, ctx), timer]);
    } catch (err) {
      this.db
        .prepare(
          "INSERT INTO tool_executions (id, user_id, task_id, step_id, tool_id, input_json, result_json, risk_level, verified, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)",
        )
        .run(execId, ctx.userId, opts?.taskId ?? null, opts?.stepId ?? null, toolId, JSON.stringify(input), JSON.stringify({ error: String(err) }), tool.descriptor.riskLevel, started, now());
      throw err;
    }

    let verification: VerificationResult | undefined;
    if (tool.verify) {
      try {
        verification = await tool.verify(input, result, ctx);
      } catch (err) {
        verification = { verified: false, method: "verify", detail: `verifier threw: ${String(err)}` };
      }
    }

    this.db
      .prepare(
        "INSERT INTO tool_executions (id, user_id, task_id, step_id, tool_id, input_json, result_json, risk_level, verified, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(execId, ctx.userId, opts?.taskId ?? null, opts?.stepId ?? null, toolId, JSON.stringify(input), JSON.stringify(result), tool.descriptor.riskLevel, verification ? (verification.verified ? 1 : 0) : null, started, now());

    this.audit.log(ctx.userId, "jarvis", `tool.${toolId}`, result.summary.slice(0, 300));

    return { ...result, verification, executionId: execId };
  }
}
