import { useEffect, useRef, useState, useCallback } from "react";
import { JarvisClient } from "@jarvis/gateway-sdk";
import type {
  WsServerMessage,
  ChatMessage,
  TaskSummary,
  TaskDetail,
  ToolDescriptor,
  MemoryRecord,
  MonitorRecord,
  ApprovalRequest,
  OrbState,
} from "@jarvis/schemas";

export interface ChatEntry {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

export function useJarvisStore() {
  const client = useRef(new JarvisClient());
  const [connected, setConnected] = useState(false);
  const [orb, setOrb] = useState<OrbState>("IDLE");
  const [activity, setActivity] = useState<string | undefined>(undefined);
  const [threadId, setThreadId] = useState("main");
  const [threads, setThreads] = useState<Array<{ id: string; title: string; messageCount: number }>>([]);
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [selectedTask, setSelectedTask] = useState<TaskDetail | null>(null);
  const [tools, setTools] = useState<ToolDescriptor[]>([]);
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [monitors, setMonitors] = useState<MonitorRecord[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [notifications, setNotifications] = useState<Array<{ id: string; title: string; body: string }>>([]);
  const [audit, setAudit] = useState<Array<{ at: string; actor: string; action: string; detail: string }>>([]);
  const [brain, setBrain] = useState<string>("");

  const refreshData = useCallback(async () => {
    try {
      const [t, tasks, tools, mems, mons, aprs, aud, health] = await Promise.all([
        client.current.threads(),
        client.current.tasks(),
        client.current.tools(),
        client.current.memories(),
        client.current.monitors(),
        client.current.approvals("pending"),
        client.current.audit(),
        client.current.health(),
      ]);
      setThreads(t);
      setTasks(tasks);
      setTools(tools);
      setMemories(mems);
      setMonitors(mons);
      setApprovals(aprs);
      setAudit(aud);
      setBrain(`${health.brain} · ${health.model}`);
    } catch {
      // gateway not up yet; UI stays in offline state
    }
  }, []);

  const loadThread = useCallback(async (id: string) => {
    setThreadId(id);
    try {
      const msgs: ChatMessage[] = await client.current.messages(id);
      setEntries(msgs.filter((m) => m.role === "user" || m.role === "assistant").map((m) => ({ id: m.id, role: m.role as "user" | "assistant", content: m.content })));
    } catch {
      setEntries([]);
    }
  }, []);

  useEffect(() => {
    refreshData();
    loadThread("main");
  }, [refreshData, loadThread]);

  // ── WebSocket lifecycle ────────────────────────────────────────────────
  const wsRef = useRef<{ send: (m: { type: "chat.send"; threadId: string; text: string }) => void; close: () => void } | null>(null);
  const [wsReady, setWsReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    let retry = 0;

    const connect = () => {
      if (disposed) return;
      const conn = client.current.connectWs(handleServerMessage, () => {
        setConnected(true);
        setWsReady(true);
        retry = 0;
      });
      wsRef.current = conn;
      conn.ws.onclose = () => {
        setConnected(false);
        setWsReady(false);
        if (!disposed && retry < 10) {
          retry++;
          setTimeout(connect, Math.min(1000 * retry, 5000));
        }
      };
    };

    const handleServerMessage = (msg: WsServerMessage) => {
      switch (msg.type) {
        case "state":
          setOrb(msg.orb);
          setActivity(msg.activity);
          break;
        case "turn.started":
          setEntries((prev) => [...prev, { id: msg.messageId, role: "assistant", content: "", streaming: true }]);
          break;
        case "turn.delta":
          setEntries((prev) => prev.map((e) => (e.id === msg.messageId ? { ...e, content: e.content + msg.text } : e)));
          break;
        case "turn.completed":
          setEntries((prev) => prev.map((e) => (e.id === msg.messageId ? { ...e, streaming: false } : e)));
          setOrb((o) => (o === "SPEAKING" || o === "THINKING" || o === "EXECUTING" ? "SUCCESS" : o));
          refreshData();
          break;
        case "approval.requested":
          setNotifications((n) => [...n, { id: msg.approval.id, title: "Approval requested", body: msg.approval.action }]);
          refreshData();
          break;
        case "approval.resolved":
          refreshData();
          break;
        case "monitor.notification":
          setNotifications((n) => [...n, { id: `${msg.monitorId}-${Date.now()}`, title: msg.title, body: msg.body }]);
          break;
        case "error":
          setNotifications((n) => [...n, { id: `err-${Date.now()}`, title: "Error", body: msg.message }]);
          break;
      }
    };

    connect();
    return () => {
      disposed = true;
      wsRef.current?.close();
    };
  }, [refreshData]);

  // ── Abortable turn (for barge-in) ──────────────────────────────────────
  const abortRef = useRef<AbortController | null>(null);
  const abortCurrent = useCallback(() => {
    if (abortRef.current) { try { abortRef.current.abort(); } catch {} abortRef.current = null; }
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setOrb("IDLE");
  }, []);

  // ── Actions ────────────────────────────────────────────────────────────
  const sendMessage = useCallback(
    (text: string, opts?: { signal?: AbortSignal }) => {
      if (!text.trim()) return;
      // abort previous if any
      if (abortRef.current) { try { abortRef.current.abort(); } catch {} }
      const ac = new AbortController();
      const sig = opts?.signal ?? ac.signal;
      abortRef.current = ac;
      // also wire external signal to abort this one
      if (opts?.signal) {
        opts.signal.addEventListener("abort", () => { try{ ac.abort(); }catch{} }, { once: true });
      }
      setEntries((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", content: text }]);
      setOrb("UNDERSTANDING");
      if (wsReady && wsRef.current) {
        // WS path: server will handleTurn; client abort just stops rendering
        // Send abortable via WS by also sending HTTP abort signal through a side channel
        // For now, WS path is not abortable server-side — we mark client interrupted and will ignore next deltas
        wsRef.current.send({ type: "chat.send", threadId, text } as never);
        // store abort to allow interrupt to hide streaming
        (wsRef.current as unknown as { _abort?: AbortController })._abort = ac;
        ac.signal.addEventListener("abort", () => {
          setEntries((prev) => prev.map((e) => e.streaming ? { ...e, streaming: false, content: e.content + " [interrupted]" } : e));
          setOrb("IDLE");
        }, { once: true });
      } else {
        // HTTP fallback with true abort
        fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ threadId, text }),
          signal: sig,
        })
          .then((r) => r.json())
          .then((r: { reply: string }) => {
            if (ac.signal.aborted) return;
            setEntries((prev) => [...prev, { id: `a-${Date.now()}`, role: "assistant", content: r.reply }]);
            refreshData();
          })
          .catch((err) => {
            if (String(err).includes("abort") || ac.signal.aborted) {
              setEntries((prev) => prev.map((e) => e.streaming ? { ...e, streaming: false } : e));
              return;
            }
            setEntries((prev) => [...prev, { id: `e-${Date.now()}`, role: "assistant", content: "(gateway unreachable)" }]);
          })
          .finally(() => { if (abortRef.current === ac) abortRef.current = null; });
      }
    },
    [threadId, wsReady, refreshData],
  );

  const resolveApproval = useCallback(
    async (id: string, decision: "approved" | "rejected") => {
      await client.current.resolveApproval(id, decision);
      refreshData();
    },
    [refreshData],
  );

  const openTask = useCallback(async (id: string) => {
    const t = await client.current.task(id);
    setSelectedTask(t);
  }, []);

  const dismissNotification = useCallback((id: string) => {
    setNotifications((n) => n.filter((x) => x.id !== id));
  }, []);

  // Local-only orb override (mic listening etc.); next WS state wins back.
  const setOrbLocal = useCallback((orb: OrbState, activity?: string) => {
    setOrb(orb);
    setActivity(activity);
  }, []);

  const stopSpeaking = useCallback(() => {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  const saveMemory = useCallback(
    async (m: { type: string; subject: string; content: string }) => {
      await client.current.saveMemory(m);
      refreshData();
    },
    [refreshData],
  );

  const deleteMemory = useCallback(
    async (id: string) => {
      await client.current.deleteMemory(id);
      refreshData();
    },
    [refreshData],
  );

  return {
    connected, orb, activity, brain, setOrbLocal, stopSpeaking, abortCurrent,
    threadId, threads, entries, sendMessage, loadThread,
    tasks, selectedTask, openTask, setSelectedTask,
    tools, memories, saveMemory, deleteMemory,
    monitors, approvals, resolveApproval,
    notifications, dismissNotification, audit,
    refreshData,
  };
}

export type Store = ReturnType<typeof useJarvisStore>;
