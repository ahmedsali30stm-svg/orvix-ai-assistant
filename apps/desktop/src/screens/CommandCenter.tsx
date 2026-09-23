import { useEffect, useState } from "react";
import type { Store } from "../store";
import { JarvisClient } from "@jarvis/gateway-sdk";

const client = new JarvisClient();

// ── Command Center (§48) ──────────────────────────────────────────────────
export function CommandCenter({ store }: { store: Store }) {
  const [tab, setTab] = useState<"monitors" | "audit" | "approvals">("monitors");

  return (
    <div className="p-6 overflow-y-auto h-full">
      <h1 className="text-xl font-semibold mb-4">Command Center</h1>
      <div className="flex gap-2 mb-4">
        {(["monitors", "audit", "approvals"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-lg text-sm capitalize ${tab === t ? "bg-cyan-400/15 text-cyan-200 border border-cyan-400/30" : "bg-white/5 text-slate-400 hover:text-slate-200"}`}
          >
            {t}{t === "approvals" && store.approvals.length > 0 ? ` (${store.approvals.length})` : ""}
          </button>
        ))}
      </div>

      {tab === "monitors" && <MonitorsTab store={store} />}
      {tab === "audit" && <AuditTab store={store} />}
      {tab === "approvals" && <ApprovalsTab store={store} />}
    </div>
  );
}

function MonitorsTab({ store }: { store: Store }) {
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [condition, setCondition] = useState("");
  const [frequency, setFrequency] = useState("30m");

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <div className="rounded-xl border border-edge bg-panel p-4 grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="md:col-span-1 bg-white/5 rounded px-3 py-2 text-sm outline-none" />
        <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="URL or clock" className="md:col-span-2 bg-white/5 rounded px-3 py-2 text-sm outline-none" />
        <input value={condition} onChange={(e) => setCondition(e.target.value)} placeholder="Condition, e.g. 200" className="md:col-span-1 bg-white/5 rounded px-3 py-2 text-sm outline-none" />
        <button
          onClick={async () => {
            if (!name || !target || !condition) return;
            await fetch("/api/monitors", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ name, type: "condition", target, condition: `state == ${condition}`, frequency }),
            });
            setName(""); setTarget(""); setCondition("");
            store.refreshData();
          }}
          className="md:col-span-1 px-3 py-2 rounded bg-cyan-500/80 hover:bg-cyan-400 text-black text-sm font-semibold"
        >
          Watch
        </button>
      </div>
      <div className="flex flex-col gap-2">
        {store.monitors.length === 0 && <p className="text-sm text-slate-500">No monitors. Add one above to watch a URL or the clock.</p>}
        {store.monitors.map((m) => (
          <div key={m.id} className="rounded-xl border border-edge bg-panel p-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">{m.name}</div>
              <div className="text-xs text-slate-500">{m.target} · {m.condition} · every {m.frequency}</div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400">{m.lastState ?? "—"}</span>
              <button onClick={async () => { await client ? void 0 : undefined; await fetch(`/api/monitors/${m.id}`, { method: "DELETE" }); store.refreshData(); }} className="text-xs text-red-400 hover:text-red-300">delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AuditTab({ store }: { store: Store }) {
  return (
    <div className="flex flex-col gap-1 max-w-4xl">
      {store.audit.length === 0 && <p className="text-sm text-slate-500">No audit entries yet.</p>}
      {store.audit.map((a, i) => (
        <div key={i} className="flex gap-3 text-sm py-1 border-b border-white/5">
          <span className="text-slate-500 w-20 shrink-0">{new Date(a.at).toLocaleTimeString()}</span>
          <span className={`w-16 shrink-0 ${a.actor === "user" ? "text-cyan-300" : "text-slate-400"}`}>{a.actor}</span>
          <span className="text-slate-300 w-52 shrink-0 truncate">{a.action}</span>
          <span className="text-slate-500 truncate">{a.detail}</span>
        </div>
      ))}
    </div>
  );
}

function ApprovalsTab({ store }: { store: Store }) {
  const [history, setHistory] = useState<Array<{ id: string; action: string; status: string; createdAt: string }>>([]);
  useEffect(() => {
    store.approvals ? void 0 : undefined;
    fetch("/api/approvals")
      .then((r) => r.json())
      .then((rows: Array<{ id: string; action: string; status: string; createdAt: string }>) => setHistory(rows))
      .catch(() => {});
  }, [store.approvals.length]);

  return (
    <div className="flex flex-col gap-2 max-w-3xl">
      {store.approvals.length === 0 && history.filter((h) => h.status === "pending").length === 0 && (
        <p className="text-sm text-slate-500">Nothing waiting for you.</p>
      )}
      {store.approvals.map((a) => (
        <div key={a.id} className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4">
          <div className="text-sm font-medium">{a.action}</div>
          <div className="text-xs text-amber-200/70 mt-1">{a.detail}</div>
          <div className="text-[11px] text-slate-500 mt-1">tool: {a.toolId} · risk: {a.riskLevel}</div>
          <div className="flex gap-2 mt-3">
            <button onClick={() => store.resolveApproval(a.id, "approved")} className="px-3 py-1.5 rounded bg-emerald-500/80 hover:bg-emerald-500 text-black text-xs font-semibold">Approve</button>
            <button onClick={() => store.resolveApproval(a.id, "rejected")} className="px-3 py-1.5 rounded bg-red-500/70 hover:bg-red-500 text-black text-xs font-semibold">Reject</button>
          </div>
        </div>
      ))}
    </div>
  );
}
