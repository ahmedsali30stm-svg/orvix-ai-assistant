import { useState } from "react";
import type { Store } from "../store";
import type { MemoryType } from "@jarvis/schemas";

const GROUPS: Array<{ key: MemoryType; label: string }> = [
  { key: "user", label: "You" },
  { key: "preference", label: "Preferences" },
  { key: "people", label: "People" },
  { key: "business", label: "Business" },
  { key: "project", label: "Projects" },
  { key: "decision", label: "Decisions" },
  { key: "episodic", label: "Episodes" },
];

// ── Memory page (§50) ─────────────────────────────────────────────────────
export function Memory({ store }: { store: Store }) {
  const [group, setGroup] = useState<MemoryType | "all">("all");
  const [adding, setAdding] = useState(false);
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");

  const shown = group === "all" ? store.memories : store.memories.filter((m) => m.type === group);

  return (
    <div className="p-6 overflow-y-auto h-full">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Memory</h1>
        <button onClick={() => setAdding((v) => !v)} className="px-3 py-1.5 rounded-lg bg-cyan-500/80 hover:bg-cyan-400 text-black text-sm font-semibold">+ Add</button>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {(["all", ...GROUPS.map((g) => g.key)] as Array<MemoryType | "all">).map((g) => (
          <button
            key={g}
            onClick={() => setGroup(g)}
            className={`px-3 py-1 rounded-full text-xs ${group === g ? "bg-cyan-400/15 text-cyan-200 border border-cyan-400/30" : "bg-white/5 text-slate-400 hover:text-slate-200"}`}
          >
            {g === "all" ? "All" : GROUPS.find((x) => x.key === g)!.label}
          </button>
        ))}
      </div>

      {adding && (
        <div className="rounded-xl border border-edge bg-panel p-4 mb-4 flex flex-col gap-2 max-w-xl">
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject (e.g. preferred_language)" className="bg-white/5 rounded px-3 py-2 text-sm outline-none" />
          <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="What should Orvix remember?" rows={2} className="bg-white/5 rounded px-3 py-2 text-sm outline-none" />
          <button
            onClick={async () => {
              if (!subject.trim() || !content.trim()) return;
              await store.saveMemory({ type: group === "all" ? "episodic" : group, subject, content });
              setSubject(""); setContent(""); setAdding(false);
            }}
            className="self-start px-3 py-1.5 rounded bg-emerald-500/80 text-black text-sm font-semibold"
          >
            Save
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-5xl">
        {shown.length === 0 && <p className="text-sm text-slate-500">Nothing stored here yet. Orvix saves durable facts automatically as you talk.</p>}
        {shown.map((m) => (
          <div key={m.id} className="rounded-xl border border-edge bg-panel p-4 flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-widest text-cyan-300/80">{m.type}</span>
              <button onClick={() => store.deleteMemory(m.id)} className="text-xs text-slate-600 hover:text-red-400">forget</button>
            </div>
            <div className="text-sm font-medium text-slate-200">{m.subject}</div>
            <div className="text-sm text-slate-400">{m.content}</div>
            <div className="text-[10px] text-slate-600 mt-1">
              importance {m.importance.toFixed(1)} · {m.source} · updated {new Date(m.updatedAt).toLocaleDateString()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
