import type { Db } from "./db.ts";
import { uid, now } from "./db.ts";
import type {
  MemoryRecord,
  MemoryType,
  MonitorRecord,
  ApprovalRequest,
  RiskLevel,
} from "@jarvis/schemas";

// ── Repositories over the local SQLite store ─────────────────────────────

function rowToMemory(r: Record<string, unknown>): MemoryRecord {
  return {
    id: String(r.id),
    type: r.type as MemoryType,
    subject: String(r.subject),
    content: String(r.content),
    source: String(r.source),
    confidence: Number(r.confidence),
    importance: Number(r.importance),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    lastVerifiedAt: r.last_verified_at == null ? null : String(r.last_verified_at),
    expiresAt: r.expires_at == null ? null : String(r.expires_at),
  };
}

function rowToMonitor(r: Record<string, unknown>): MonitorRecord {
  return {
    id: String(r.id),
    name: String(r.name),
    type: r.type as MonitorRecord["type"],
    target: String(r.target),
    condition: String(r.condition),
    frequency: String(r.frequency),
    notifyWhen: r.notify_when as MonitorRecord["notifyWhen"],
    enabled: Number(r.enabled) === 1,
    lastState: r.last_state == null ? null : String(r.last_state),
    lastRunAt: r.last_run_at == null ? null : String(r.last_run_at),
    createdAt: String(r.created_at),
  };
}

function rowToApproval(r: Record<string, unknown>): ApprovalRequest {
  return {
    id: String(r.id),
    taskId: r.task_id == null ? null : String(r.task_id),
    stepId: r.step_id == null ? null : String(r.step_id),
    toolId: String(r.tool_id),
    action: String(r.action),
    detail: String(r.detail),
    payload: JSON.parse(String(r.payload_json)) as unknown,
    riskLevel: r.risk_level as RiskLevel,
    status: r.status as ApprovalRequest["status"],
    createdAt: String(r.created_at),
    decidedAt: r.decided_at == null ? null : String(r.decided_at),
  };
}

export class MemoryRepo {
  constructor(private db: Db) {}

  save(m: {
    userId: string;
    type: MemoryType;
    subject: string;
    content: string;
    source: string;
    confidence?: number;
    importance?: number;
    expiresAt?: string | null;
  }): MemoryRecord {
    const id = uid("mem");
    const t = now();
    this.db
      .prepare(
        `INSERT INTO memories (id, user_id, type, subject, content, source, confidence, importance, created_at, updated_at, last_verified_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        m.userId,
        m.type,
        m.subject,
        m.content,
        m.source,
        m.confidence ?? 0.8,
        m.importance ?? 0.5,
        t,
        t,
        t,
        m.expiresAt ?? null,
      );
    return this.get(id)!;
  }

  get(id: string): MemoryRecord | undefined {
    const r = this.db.prepare("SELECT * FROM memories WHERE id = ?").get(id);
    return r ? rowToMemory(r as Record<string, unknown>) : undefined;
  }

  update(id: string, content: string, importance?: number): void {
    this.db
      .prepare(
        "UPDATE memories SET content = ?, importance = COALESCE(?, importance), updated_at = ? WHERE id = ?",
      )
      .run(content, importance ?? null, now(), id);
  }

  remove(id: string): void {
    this.db.prepare("DELETE FROM memories WHERE id = ?").run(id);
  }

  list(userId: string, type?: MemoryType): MemoryRecord[] {
    const rows =
      type == null
        ? this.db
            .prepare("SELECT * FROM memories WHERE user_id = ? ORDER BY importance DESC, updated_at DESC")
            .all(userId)
        : this.db
            .prepare("SELECT * FROM memories WHERE user_id = ? AND type = ? ORDER BY importance DESC, updated_at DESC")
            .all(userId, type);
    return (rows as Record<string, unknown>[]).map(rowToMemory);
  }

  /** Keyword-relevance retrieval with recency/importance scoring (§28). */
  retrieve(userId: string, query: string, limit = 8): MemoryRecord[] {
    const terms = query
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length > 1);
    const all = this.list(userId);
    const scored = all.map((m) => {
      const hay = `${m.subject} ${m.content}`.toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (hay.includes(t)) score += 2;
        else if (t.length > 4 && hay.includes(t.slice(0, Math.ceil(t.length * 0.7)))) score += 1;
      }
      return { m, score: score * (0.5 + m.importance) };
    });
    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.m);
  }
}

export class MonitorRepo {
  constructor(private db: Db) {}

  create(m: {
    userId: string;
    name: string;
    type: MonitorRecord["type"];
    target: string;
    condition: string;
    frequency: string;
    notifyWhen?: MonitorRecord["notifyWhen"];
  }): MonitorRecord {
    const id = uid("mon");
    this.db
      .prepare(
        `INSERT INTO monitors (id, user_id, name, type, target, condition, frequency, notify_when, enabled, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      )
      .run(id, m.userId, m.name, m.type, m.target, m.condition, m.frequency, m.notifyWhen ?? "changed", now());
    return this.get(id)!;
  }

  get(id: string): MonitorRecord | undefined {
    const r = this.db.prepare("SELECT * FROM monitors WHERE id = ?").get(id);
    return r ? rowToMonitor(r as Record<string, unknown>) : undefined;
  }

  list(userId: string): MonitorRecord[] {
    return (this.db.prepare("SELECT * FROM monitors WHERE user_id = ? ORDER BY created_at DESC").all(userId) as Record<string, unknown>[]).map(
      rowToMonitor,
    );
  }

  listEnabled(): MonitorRecord[] {
    return (this.db.prepare("SELECT * FROM monitors WHERE enabled = 1").all() as Record<string, unknown>[]).map(rowToMonitor);
  }

  setEnabled(id: string, enabled: boolean): void {
    this.db.prepare("UPDATE monitors SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
  }

  recordResult(id: string, state: string): void {
    this.db.prepare("UPDATE monitors SET last_state = ?, last_run_at = ? WHERE id = ?").run(state, now(), id);
  }

  remove(id: string): void {
    this.db.prepare("DELETE FROM monitors WHERE id = ?").run(id);
  }
}

export class ApprovalRepo {
  constructor(private db: Db) {}

  create(a: {
    userId: string;
    taskId: string | null;
    stepId: string | null;
    toolId: string;
    action: string;
    detail: string;
    payload: unknown;
    riskLevel: RiskLevel;
  }): ApprovalRequest {
    const id = uid("apr");
    this.db
      .prepare(
        `INSERT INTO approvals (id, user_id, task_id, step_id, tool_id, action, detail, payload_json, risk_level, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      )
      .run(id, a.userId, a.taskId, a.stepId, a.toolId, a.action, a.detail, JSON.stringify(a.payload), a.riskLevel, now());
    return this.get(id)!;
  }

  get(id: string): ApprovalRequest | undefined {
    const r = this.db.prepare("SELECT * FROM approvals WHERE id = ?").get(id);
    return r ? rowToApproval(r as Record<string, unknown>) : undefined;
  }

  list(userId: string, status?: ApprovalRequest["status"]): ApprovalRequest[] {
    const rows =
      status == null
        ? this.db.prepare("SELECT * FROM approvals WHERE user_id = ? ORDER BY created_at DESC").all(userId)
        : this.db.prepare("SELECT * FROM approvals WHERE user_id = ? AND status = ? ORDER BY created_at DESC").all(userId, status);
    return (rows as Record<string, unknown>[]).map(rowToApproval);
  }

  decide(id: string, status: "approved" | "rejected"): ApprovalRequest | undefined {
    this.db.prepare("UPDATE approvals SET status = ?, decided_at = ? WHERE id = ?").run(status, now(), id);
    return this.get(id);
  }

  pendingForStep(stepId: string): ApprovalRequest | undefined {
    const r = this.db
      .prepare("SELECT * FROM approvals WHERE step_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1")
      .get(stepId);
    return r ? rowToApproval(r as Record<string, unknown>) : undefined;
  }
}

export class AuditRepo {
  constructor(private db: Db) {}

  log(userId: string, actor: string, action: string, detail: string): void {
    this.db
      .prepare("INSERT INTO audit_logs (id, user_id, at, actor, action, detail) VALUES (?, ?, ?, ?, ?, ?)")
      .run(uid("aud"), userId, now(), actor, action, detail);
  }

  list(userId: string, limit = 100): Array<{ id: string; at: string; actor: string; action: string; detail: string }> {
    return this.db
      .prepare("SELECT id, at, actor, action, detail FROM audit_logs WHERE user_id = ? ORDER BY at DESC LIMIT ?")
      .all(userId, limit) as Array<{ id: string; at: string; actor: string; action: string; detail: string }>;
  }
}

export class ReminderRepo {
  constructor(private db: Db) {}

  create(userId: string, text: string, dueAt: string, threadId?: string): { id: string; text: string; dueAt: string } {
    const id = uid("rem");
    this.db
      .prepare("INSERT INTO reminders (id, user_id, text, due_at, thread_id, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, userId, text, dueAt, threadId ?? null, now());
    return { id, text, dueAt };
  }

  due(limit = 20): Array<{ id: string; user_id: string; text: string; due_at: string; thread_id: string | null }> {
    return this.db
      .prepare("SELECT id, user_id, text, due_at, thread_id FROM reminders WHERE fired = 0 AND due_at <= ? ORDER BY due_at LIMIT ?")
      .all(now(), limit) as Array<{ id: string; user_id: string; text: string; due_at: string; thread_id: string | null }>;
  }

  markFired(id: string): void {
    this.db.prepare("UPDATE reminders SET fired = 1 WHERE id = ?").run(id);
  }
}
