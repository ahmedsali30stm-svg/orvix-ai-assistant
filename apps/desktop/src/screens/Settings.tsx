import { useEffect, useState } from "react";
import { JarvisClient } from "@jarvis/gateway-sdk";
import { IconCheck, IconX } from "../components/icons";
import { VoiceSettings } from "../components/VoiceSettings";

const client = new JarvisClient();

// ── Settings (§76–§78) ────────────────────────────────────────────────────
export function Settings() {
  const [health, setHealth] = useState<{ brain: string; model: string; uptimeSec: number } | null>(null);
  const [targets, setTargets] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const tick = () => client.health().then(setHealth).catch(() => {});
    tick();
    const iv = setInterval(tick, 5000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    client.openWhitelist().then((r) => setTargets(r.targets)).catch(() => {});
  }, []);

  const addTarget = () => {
    const t = draft.trim().toLowerCase();
    if (!t) return;
    if (targets.some((x) => x === t)) {
      setDraft("");
      return;
    }
    setTargets([...targets, t]);
    setDraft("");
  };

  const removeTarget = (t: string) => setTargets(targets.filter((x) => x !== t));

  const save = async () => {
    setError("");
    try {
      const r = await client.setOpenWhitelist(targets);
      setTargets(r.targets);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setError(String(e).slice(0, 120));
    }
  };

  return (
    <div className="p-6 overflow-y-auto h-full max-w-3xl space-y-4">
      <h1 className="brand-mark text-lg font-semibold">Settings</h1>
      <VoiceSettings />

      {/* provider */}
      <div className="glass rounded-2xl p-4 flex flex-col gap-2 text-sm">
        <div className="flex justify-between"><span className="text-slate-500">AI brain</span><span className={health?.brain === "mock" ? "text-amber-300" : "text-emerald-300"}>{health?.brain ?? "…"}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">Model</span><span className="mono">{health?.model ?? "…"}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">Gateway uptime</span><span>{health ? `${health.uptimeSec}s` : "…"}</span></div>
        {health?.brain === "mock" && (
          <p className="text-xs text-amber-300/80 mt-1">
            Running on the scripted mock brain. Add GROQ_API_KEY (free at console.groq.com) or OPENAI_API_KEY to .env, then restart the gateway.
          </p>
        )}
      </div>

      {/* always-allowed open targets */}
      <div className="glass rounded-2xl p-4 mt-4 text-sm">
        <div className="font-medium text-slate-200">Always-allowed open targets</div>
        <p className="text-xs text-slate-500 mt-1 leading-relaxed">
          Orvix opens these URLs/apps without asking each time (hostname match: <span className="mono">youtube.com</span> covers all its pages).
          Everything else still requires your approval.
        </p>

        <div className="flex gap-2 mt-3">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTarget()}
            placeholder="e.g. youtube.com, github.com, notepad"
            className="flex-1 bg-white/5 rounded-xl px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-cyan-400/40 placeholder:text-slate-600"
          />
          <button onClick={addTarget} className="px-3 py-2 rounded-xl bg-white/8 hover:bg-white/15 text-slate-200 transition text-sm">Add</button>
        </div>

        <div className="flex flex-wrap gap-2 mt-3">
          {targets.length === 0 && <span className="text-xs text-slate-600">No always-allowed targets yet.</span>}
          {targets.map((t) => (
            <span key={t} className="flex items-center gap-1.5 rounded-full bg-cyan-400/10 border border-cyan-400/25 px-3 py-1 text-xs text-cyan-200">
              {t}
              <button onClick={() => removeTarget(t)} className="text-cyan-300/60 hover:text-red-400 transition" title={`Remove ${t}`}>
                <IconX width={11} height={11} />
              </button>
            </span>
          ))}
        </div>

        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={save}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-br from-cyan-400 to-indigo-500 text-[#04060c] font-semibold text-xs hover:brightness-110 transition"
          >
            <IconCheck width={13} height={13} /> {saved ? "Saved ✓" : "Save whitelist"}
          </button>
          {error && <span className="text-xs text-red-400">{error}</span>}
        </div>
      </div>

      <div className="glass rounded-2xl p-4 mt-4 text-sm text-slate-400 leading-relaxed">
        <div className="font-medium text-slate-200 mb-1">Configuration</div>
        Orvix is configured via <code className="text-cyan-300">.env</code> at the project root — copy{" "}
        <code className="text-cyan-300">.env.example</code> and set <code className="text-cyan-300">GROQ_API_KEY</code> (free tier) or{" "}
        <code className="text-cyan-300">OPENAI_API_KEY</code> (any OpenAI-compatible endpoint: OpenAI, Groq, OpenRouter, or local). Model routing tiers:{" "}
        <code className="text-cyan-300">JARVIS_MODEL_FAST</code>, <code className="text-cyan-300">JARVIS_MODEL_REASONING</code>,{" "}
        <code className="text-cyan-300">JARVIS_MODEL_CODING</code>.
      </div>
    </div>
  );
}
