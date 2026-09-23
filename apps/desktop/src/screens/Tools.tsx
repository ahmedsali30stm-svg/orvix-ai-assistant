import type { Store } from "../store";

const RISK_LABEL: Record<string, { text: string; cls: string }> = {
  read: { text: "L1 · Read", cls: "text-slate-400" },
  safe_write: { text: "L2 · Safe write", cls: "text-cyan-300" },
  external_write: { text: "L3 · Approval", cls: "text-amber-300" },
  critical: { text: "L4 · Critical", cls: "text-red-300" },
};

// ── Tools page (§51) ──────────────────────────────────────────────────────
export function Tools({ store }: { store: Store }) {
  const groups = new Map<string, typeof store.tools>();
  for (const t of store.tools) {
    if (!groups.has(t.group)) groups.set(t.group, []);
    groups.get(t.group)!.push(t);
  }

  return (
    <div className="p-6 overflow-y-auto h-full">
      <h1 className="text-xl font-semibold mb-1">Tools</h1>
      <p className="text-sm text-slate-500 mb-4">Registered capabilities and their permission levels.</p>
      <div className="flex flex-col gap-5 max-w-4xl">
        {[...groups.entries()].map(([group, tools]) => (
          <div key={group}>
            <h2 className="text-xs uppercase tracking-widest text-slate-500 mb-2">{group}</h2>
            <div className="rounded-xl border border-edge bg-panel divide-y divide-white/5">
              {tools.map((t) => {
                const risk = RISK_LABEL[t.riskLevel] ?? RISK_LABEL.read!;
                return (
                  <div key={t.id} className="flex items-center justify-between px-4 py-2.5">
                    <div>
                      <div className="text-sm">{t.name} <span className="text-slate-600 text-xs">{t.id}</span></div>
                      <div className="text-xs text-slate-500">{t.description}</div>
                    </div>
                    <span className={`text-xs shrink-0 ${risk.cls}`}>{risk.text}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
