import type { WsServerMessage, WsClientMessage, ChatMessage, TaskSummary, TaskDetail, ToolDescriptor, MemoryRecord, MonitorRecord, ApprovalRequest } from "@jarvis/schemas";

// ── Typed client for the JARVIS local gateway ─────────────────────────────

export interface ThreadInfo {
  id: string;
  title: string;
  createdAt: string;
  messageCount: number;
}

export class JarvisClient {
  constructor(private baseUrl: string = "") {}

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}/api${path}`, {
      headers: { "content-type": "application/json" },
      ...init,
    });
    if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  threads() {
    return this.req<ThreadInfo[]>("/threads");
  }

  messages(threadId: string) {
    return this.req<ChatMessage[]>(`/threads/${threadId}/messages`);
  }

  tasks() {
    return this.req<TaskSummary[]>("/tasks");
  }

  task(id: string) {
    return this.req<TaskDetail>(`/tasks/${id}`);
  }

  tools() {
    return this.req<ToolDescriptor[]>("/tools");
  }

  memories() {
    return this.req<MemoryRecord[]>("/memory");
  }

  monitors() {
    return this.req<MonitorRecord[]>("/monitors");
  }

  approvals(status: "pending" | "approved" | "rejected" = "pending") {
    return this.req<ApprovalRequest[]>(`/approvals?status=${status}`);
  }

  audit() {
    return this.req<Array<{ id: string; at: string; actor: string; action: string; detail: string }>>("/audit");
  }

  createTask(spec: { title: string; goal: string; successCriteria?: string; priority?: number }) {
    return this.req<{ id: string; title: string }>("/tasks", { method: "POST", body: JSON.stringify(spec) });
  }

  resolveApproval(id: string, decision: "approved" | "rejected") {
    return this.req<{ ok: boolean; message: string }>(`/approvals/${id}`, { method: "POST", body: JSON.stringify({ decision }) });
  }

  saveMemory(m: { type: string; subject: string; content: string; importance?: number }) {
    return this.req<MemoryRecord>("/memory", { method: "POST", body: JSON.stringify(m) });
  }

  deleteMemory(id: string) {
    return this.req<{ ok: boolean }>(`/memory/${id}`, { method: "DELETE" });
  }

  health() {
    return this.req<{ ok: boolean; brain: string; model: string; uptimeSec: number }>("/health");
  }

  openWhitelist() {
    return this.req<{ targets: string[] }>("/open-whitelist");
  }

  setOpenWhitelist(targets: string[]) {
    return this.req<{ ok: boolean; targets: string[] }>("/open-whitelist", { method: "POST", body: JSON.stringify({ targets }) });
  }

  connectWs(onMessage: (msg: WsServerMessage) => void, onOpen?: () => void): { ws: WebSocket; send: (msg: WsClientMessage) => void; close: () => void } {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => onOpen?.();
    ws.onmessage = (e) => {
      try {
        onMessage(JSON.parse(String(e.data)) as WsServerMessage);
      } catch {
        // ignore malformed frames
      }
    };
    return {
      ws,
      send: (msg: WsClientMessage) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg)),
      close: () => ws.close(),
    };
  }
}

export type { WsServerMessage, WsClientMessage };
