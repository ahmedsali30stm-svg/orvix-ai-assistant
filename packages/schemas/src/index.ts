// ── JARVIS shared wire/domain types (blueprint §1–§94) ───────────────────

// ── Intent classification (§7) ───────────────────────────────────────────
export type Intent =
  | "QUESTION"
  | "RESEARCH"
  | "ANALYZE"
  | "CREATE"
  | "EDIT"
  | "EXECUTE"
  | "MONITOR"
  | "REMIND"
  | "SEARCH"
  | "COMMUNICATE"
  | "DECIDE"
  | "PLAN"
  | "DEBUG"
  | "AUTOMATE"
  | "CONTROL_COMPUTER";

// ── Complexity router levels (§8) ────────────────────────────────────────
export type ComplexityLevel = 0 | 1 | 2 | 3;

// ── Execution states (§10) ───────────────────────────────────────────────
export type TaskStatus =
  | "QUEUED"
  | "RUNNING"
  | "WAITING_TOOL"
  | "WAITING_USER"
  | "WAITING_EXTERNAL"
  | "RETRYING"
  | "VERIFYING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type StepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled";

// ── Risk levels (§23 / §24) ──────────────────────────────────────────────
export type RiskLevel = "read" | "safe_write" | "external_write" | "critical";

export type PermissionLevel = 1 | 2 | 3 | 4;

// ── Error taxonomy (§12) ─────────────────────────────────────────────────
export type ErrorCategory =
  | "Authentication"
  | "Permission"
  | "Timeout"
  | "RateLimit"
  | "Network"
  | "InvalidInput"
  | "ToolUnavailable"
  | "WebsiteChanged"
  | "DataMismatch"
  | "MissingDependency"
  | "Cancelled"
  | "Unknown";

export class JarvisError extends Error {
  constructor(
    public category: ErrorCategory,
    override message: string,
    public retryable = false,
    public override cause?: unknown,
  ) {
    super(message);
    this.name = "JarvisError";
  }
}

// ── Plans and steps (§9) ─────────────────────────────────────────────────
export interface PlanStep {
  id: string;
  name: string;
  description?: string;
  toolId?: string;
  input?: unknown;
  status: StepStatus;
  output?: unknown;
  verification?: VerificationResult | null;
  error?: string | null;
  retryCount: number;
}

export interface Plan {
  goal: string;
  steps: PlanStep[];
  status: TaskStatus;
  createdAt: string;
}

// ── Verification (§11) — execution ≠ success ────────────────────────────
export interface VerificationResult {
  verified: boolean;
  method: string;
  detail?: string;
  at?: string;
}

// ── Tool descriptor (§23) ────────────────────────────────────────────────
export interface ToolParam {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  required: boolean;
  enum?: string[];
}

export interface ToolDescriptor {
  id: string;
  name: string;
  description: string;
  group: string;
  riskLevel: RiskLevel;
  requiresConfirmation: boolean;
  timeoutMs: number;
  params: ToolParam[];
}

export interface ToolResult {
  ok: boolean;
  summary: string;
  data?: unknown;
  errorCategory?: ErrorCategory;
  retryable?: boolean;
}

export interface ToolContext {
  db: unknown; // typed in core as Db; kept loose to avoid a circular dep
  userId: string;
  runId?: string;
  signal?: AbortSignal;
}

export interface JarvisTool {
  descriptor: ToolDescriptor;
  execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
  verify?(input: Record<string, unknown>, result: ToolResult, ctx: ToolContext): Promise<VerificationResult>;
}

// ── Memory (§26–§29) ─────────────────────────────────────────────────────
export type MemoryType =
  | "user"
  | "preference"
  | "people"
  | "business"
  | "project"
  | "decision"
  | "episodic"
  | "working";

export interface MemoryRecord {
  id: string;
  type: MemoryType;
  subject: string;
  content: string;
  source: string;
  confidence: number;
  importance: number;
  createdAt: string;
  updatedAt: string;
  lastVerifiedAt: string | null;
  expiresAt: string | null;
}

// ── Events and monitors (§34–§36) ────────────────────────────────────────
export type JarvisEventName =
  | "EMAIL_RECEIVED"
  | "NEW_LEAD"
  | "LEAD_UNANSWERED"
  | "BOOKING_CREATED"
  | "BOOKING_DELAYED"
  | "PAYMENT_RECEIVED"
  | "TASK_OVERDUE"
  | "SERVER_DOWN"
  | "CAMPAIGN_ANOMALY"
  | "CALENDAR_EVENT_SOON"
  | "MONITOR_TRIGGERED"
  | "TASK_COMPLETED"
  | "TASK_FAILED"
  | string;

export interface JarvisEvent {
  id: string;
  name: JarvisEventName;
  payload: Record<string, unknown>;
  createdAt: string;
}

export type MonitorType =
  | "time"
  | "condition"
  | "change"
  | "threshold"
  | "anomaly";

export interface MonitorRecord {
  id: string;
  name: string;
  type: MonitorType;
  target: string;
  condition: string;
  frequency: string;
  notifyWhen: "changed" | "always" | "breach";
  enabled: boolean;
  lastState: string | null;
  lastRunAt: string | null;
  createdAt: string;
}

// ── Approvals (§24–§25) ──────────────────────────────────────────────────
export interface ApprovalRequest {
  id: string;
  taskId: string | null;
  stepId: string | null;
  toolId: string;
  action: string;
  detail: string;
  payload: unknown;
  riskLevel: RiskLevel;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  decidedAt: string | null;
}

// ── Chat and orchestration wire format ───────────────────────────────────
export interface ChatMessage {
  id: string;
  threadId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  createdAt: string;
}

export interface TurnResult {
  threadId: string;
  reply: string;
  taskId?: string;
  plan?: Plan;
  riskNote?: string;
}

export interface TaskSummary {
  id: string;
  title: string;
  goal: string;
  status: TaskStatus;
  priority: number;
  progress: { done: number; total: number };
  createdAt: string;
  updatedAt: string;
}

export interface TaskDetail extends TaskSummary {
  description: string | null;
  successCriteria: string | null;
  requiresApproval: boolean;
  steps: PlanStep[];
  events: Array<{ at: string; kind: string; text: string }>;
}

// ── Orb state machine (§42) ──────────────────────────────────────────────
export type OrbState =
  | "IDLE"
  | "WAKE"
  | "LISTENING"
  | "UNDERSTANDING"
  | "THINKING"
  | "PLANNING"
  | "SEARCHING"
  | "EXECUTING"
  | "WAITING"
  | "SPEAKING"
  | "SUCCESS"
  | "ERROR";

// ── WebSocket envelope (gateway ⇄ UI) ────────────────────────────────────
export type WsServerMessage =
  | { type: "hello"; ts: string }
  | { type: "state"; orb: OrbState; activity?: string }
  | { type: "turn.started"; threadId: string; messageId: string }
  | { type: "turn.delta"; messageId: string; text: string }
  | { type: "turn.completed"; messageId: string; taskId?: string }
  | { type: "task.updated"; task: TaskDetail }
  | { type: "approval.requested"; approval: ApprovalRequest }
  | { type: "approval.resolved"; id: string; status: "approved" | "rejected" }
  | { type: "monitor.notification"; monitorId: string; title: string; body: string }
  | { type: "error"; message: string };

export interface WsClientMessage {
  type: "chat.send";
  threadId: string;
  text: string;
  attach?: { kind: "file"; name: string; size: number }[];
}
