import { useEffect, useState } from "react";
import type { Store } from "../store";

// ── Threads screen (archive) ──────────────────────────────────────────────
// Live conversation lives on the Console (Home). This screen is the archive:
// every thread with its messages, and "reply here" which routes text into
// the active Console conversation.

export function Chat({ store }: { store: Store }) {
  const [reply, setReply] = useState("");
  const [bump, setBump] = useState(0);

  useEffect(() => {
    store.refreshData();
  }, [store, bump]);

  const send = () => {
    const t = reply.trim();
    if (!t) return;
    store.sendMessage(t);
    setReply("");
    setBump((b) => b + 1);
  };

  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      <div className="max-w-4xl mx-auto flex flex-col gap-5">
        <div>
          <h1 className="brand-mark text-base font-semibold text-slate-100">Threads</h1>
          <p className="text-sm text-slate-500 mt-1">
            The live conversation is on the <span className="text-cyan-300">Console</span> — this is the full archive.
          </p>
        </div>

        {store.threads.length === 0 && <p className="text-sm text-slate-500">No threads yet. Start talking on the Console.</p>}

        {store.threads.map((th) => (
          <ThreadCard key={th.id} th={th} active={th.id === store.threadId} onOpen={() => store.loadThread(th.id)} />
        ))}

        {/* quick reply into the live thread */}
        <div className="sticky bottom-0 pt-4 pb-2 bg-gradient-to-t from-void via-void/95 to-transparent">
          <div className="glass-strong flex items-center gap-2 rounded-2xl px-4 py-2 focus-within:border-cyan-400/50 transition">
            <input
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder={`Message the live thread… (${store.threadId})`}
              className="flex-1 bg-transparent outline-none text-sm py-1.5 placeholder:text-slate-500"
            />
            <button
              onClick={send}
              className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-400 to-indigo-500 text-black font-bold flex items-center justify-center hover:brightness-110 transition"
            >
              ➤
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ThreadCard({
  th,
  active,
  onOpen,
}: {
  th: { id: string; title: string; messageCount: number };
  active: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      className={`glass card-hover text-left rounded-2xl px-4 py-3.5 transition anim-fade-up ${
        active ? "border-cyan-400/40 bg-cyan-400/5" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-slate-100 truncate">{th.title}</span>
        {active && <span className="hud-title text-[9px] uppercase tracking-[0.2em] text-cyan-300 shrink-0">Active</span>}
      </div>
      <div className="text-xs text-slate-500 mt-1">
        {th.messageCount} messages · <span className="mono">{th.id}</span>
      </div>
    </button>
  );
}
