import { useEffect, useState } from "react";
import type { Store } from "../store";
import { JarvisClient } from "@jarvis/gateway-sdk";
import type { TaskDetail } from "@jarvis/schemas";

const client = new JarvisClient();

const STATUS_COLOR: Record<string, string> = {
  QUEUED: "text-slate-400",
  RUNNING: "text-cyan-300",
  WAITING_USER: "text-amber-300",
  RETRYING: "text-amber-300",
  VERIFYING: "text-indigo-300",
  COMPLETED: "text-emerald-300",
  FAILED: "text-red-300",
  CANCELLED: "text-slate-500",
};

export function Tasks({ store }: { store: Store }) {
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Tasks</h1>
          <button onClick={() => setCreating((v) => !v)} className="px-3 py-1.5 rounded-lg bg-cyan-500/80 hover:bg-cyan-400 text-black text-sm font-semibold">+ New task</button>
        </div>

        {creating && (
          <div className="rounded-xl border border-edge bg-panel p-4 flex flex-col gap-2">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="bg-white/5 rounded px-3 py-2 text-sm outline-none" />
            <textarea value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Goal — what outcome do you want?" rows={2} className="bg-white/5 rounded px-3 py-2 text-sm outline-none" />
            <button
              onClick={async () => {
                if (!title.trim() || !goal.trim()) return;
                await client.createTask({ title, goal });
                setTitle("");
                setGoal("");
                setCreating(false);
                store.refreshData();
              }}
              className="self-start px-3 py-1.5 rounded bg-emerald-500/80 text-black text-sm font-semibold"
            >
              Create
            </button>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {store.tasks.length === 0 && <p className="text-sm text-slate-500">No tasks yet.</p>}
          {store.tasks.map((t) => {
            const pct = t.progress.total > 0 ? Math.round((t.progress.done / t.progress.total) * 100) : 0;
            return (
              <button
                key={t.id}
                onClick={() => store.openTask(t.id)}
                className="text-left rounded-xl border border-edge bg-panel p-4 hover:border-cyan-400/40 transition"
              >
                <div className="flex items-center justify-between gap-4">
                  <span className="font-medium truncate">{t.title}</span>
                  <span className={`text-xs ${STATUS_COLOR[t.status] ?? "text-slate-400"}`}>{t.status}</span>
                </div>
                <p className="text-xs text-slate-500 mt-1 truncate">{t.goal}</p>
                <div className="mt-2 h-1.5 rounded-full bg-white/5 overflow-hidden">
                  <div className="h-full bg-cyan-400/70" style={{ width: `${pct}%` }} />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {store.selectedTask && <TaskDetailPane task={store.selectedTask} onClose={() => store.setSelectedTask(null)} />}
    </div>
  );
}

function TaskDetailPane({ task, onClose }: { task: TaskDetail; onClose: () => void }) {
  const [live, setLive] = useState(task);
  useEffect(() => setLive(task), [task]);
  useEffect(() => {
    const iv = setInterval(async () => {
      try {
        setLive(await client.task(task.id));
      } catch {
        /* keep last snapshot */
      }
    }, 4000);
    return () => clearInterval(iv);
  }, [task.id]);

  const stepIcon = (status: string) =>
    status === "completed" ? "✓" : status === "running" ? "●" : status === "failed" ? "✗" : status === "cancelled" ? "⊘" : "○";

  return (
    <div className="w-96 border-l border-edge bg-panel/80 overflow-y-auto p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <h2 className="text-lg font-semibold">{live.title}</h2>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-300">✕</button>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className={`px-2 py-0.5 rounded ${STATUS_COLOR[live.status] ?? "text-slate-400"} bg-white/5`}>{live.status}</span>
        <span className="text-slate-500">{live.progress.done}/{live.progress.total} steps</span>
      </div>
      <div>
        <div className="text-xs uppercase tracking-widest text-slate-500 mb-1">Goal</div>
        <p className="text-sm text-slate-300">{live.goal}</p>
      </div>
      {live.successCriteria && (
        <div>
          <div className="text-xs uppercase tracking-widest text-slate-500 mb-1">Success criteria</div>
          <p className="text-sm text-slate-300">{live.successCriteria}</p>
        </div>
      )}
      {live.steps.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-widest text-slate-500 mb-2">Steps</div>
          <div className="flex flex-col gap-1.5">
            {live.steps.map((s) => (
              <div key={s.id} className="flex items-start gap-2 text-sm">
                <span className={s.status === "completed" ? "text-emerald-400" : s.status === "failed" ? "text-red-400" : s.status === "running" ? "text-cyan-300" : "text-slate-600"}>{stepIcon(s.status)}</span>
                <span className="text-slate-300">{s.name}</span>
                {s.verification && (
                  <span className={`text-[10px] ${s.verification.verified ? "text-emerald-400" : "text-amber-400"}`}>{s.verification.verified ? "verified" : "unverified"}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {live.events.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-widest text-slate-500 mb-2">Activity</div>
          <div className="flex flex-col gap-1 text-xs text-slate-400">
            {live.events.slice(-8).map((e, i) => (
              <div key={i}>{new Date(e.at).toLocaleTimeString()} — {e.text}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
