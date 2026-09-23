import { useEffect, useRef, useState } from "react";
import type { Store } from "../store";
import {
  IconConsole, IconThreads, IconTasks, IconMemory, IconTools, IconCommand, IconSettings,
  IconMic, IconSpeaker, IconSpeakerOff, IconSend, IconCheck, IconX, IconBell, IconEye, IconPause,
  IconChevronDown, IconChevronUp,
} from "../components/icons";
import { Markdown } from "../components/Markdown";

// ── Console (Home) = the live conversation space ──────────────────────────

const CHIPS = [
  { label: "What time is it?", text: "what time is it?" },
  { label: "List my desktop", text: "list files on my desktop" },
  { label: "Search the web for Orvix AI", text: "search the web for orvix ai" },
  { label: "Remember I love coffee", text: "remember that I love coffee" },
];

export function Home({ store }: { store: Store }) {
  const [text, setText] = useState("");
  const [partial, setPartial] = useState("");
  const [listening, setListening] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  // Spec Phase 5: wake word experimental — disabled by default until barge-in stable
  const [wakeOn, setWakeOn] = useState(() => {
    try { return localStorage.getItem("orvix.wake") === "1"; } catch { return false; }
  });
  const [wakeListening, setWakeListening] = useState(false);
  const [panelsOpen, setPanelsOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognizerRef = useRef<{ start: () => void; stop: () => void } | null>(null);
  const wakeRef = useRef<{ start: () => void; stop: () => void } | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (chatOpen) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [store.entries.length, partial, chatOpen]);

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    store.stopSpeaking?.();
    store.sendMessage(t);
    setText("");
  };

  const toggleMic = () => {
    if (listening) {
      recognizerRef.current?.stop();
      return;
    }
    // manual mic = always capture next utterance, wake detection bypassed
    const rec = createRecognizerSafely({
      continuous: false,
      onPartial: (p) => {
        setPartial(p);
        store.setOrbLocal("LISTENING", "Listening…");
      },
      onFinal: (t) => {
        setPartial("");
        store.stopSpeaking?.();
        // allow manual "hey orvix ..." to also work — strip wake word if present
        import("../voice/voice").then(({ stripWakeWord }) => {
          const clean = stripWakeWord(t).trim() || t;
          store.sendMessage(clean);
        });
      },
      onEnd: () => {
        setListening(false);
        setPartial("");
        store.setOrbLocal("IDLE");
      },
      onError: () => {
        setListening(false);
        setPartial("");
        store.setOrbLocal("IDLE");
      },
    });
    recognizerRef.current = rec;
    setListening(true);
    rec.start();
  };

  // ── Wake word: "hey orvix" continuous listener ──
  const triggerCommandListening = (initial?: string) => {
    // barge-in: abort previous turn + stop TTS
    try { store.abortCurrent?.(); } catch {}
    try { store.stopSpeaking?.(); } catch {}
    // stop wake loop while capturing command
    wakeRef.current?.stop();
    setWakeListening(false);
    const rec = createRecognizerSafely({
      continuous: false,
      onPartial: (p) => {
        setPartial(p);
        store.setOrbLocal("LISTENING", "Listening…");
      },
      onFinal: (t) => {
        setPartial("");
        try { store.stopSpeaking?.(); } catch {}
        import("../voice/voice").then(({ stripWakeWord }) => {
          const merged = (initial ? initial + " " : "") + t;
          const clean = stripWakeWord(merged).trim() || merged.trim();
          if (clean) store.sendMessage(clean);
        });
      },
      onEnd: () => {
        setListening(false);
        setPartial("");
        store.setOrbLocal("IDLE");
      },
      onError: () => {
        setListening(false);
        setPartial("");
        store.setOrbLocal("IDLE");
      },
    });
    recognizerRef.current = rec;
    setListening(true);
    store.setOrbLocal("LISTENING", "Yes?");
    // chime
    try { import("../voice/voice").then(({ speak }) => speak("Yes?", "en-US")); } catch {}
    rec.start();
  };

  useEffect(() => {
    try { localStorage.setItem("orvix.wake", wakeOn ? "1" : "0"); } catch {}
  }, [wakeOn]);

  // start/stop wake listener
  useEffect(() => {
    if (!wakeOn || listening) {
      wakeRef.current?.stop();
      setWakeListening(false);
      return;
    }
    let stopped = false;
    const startWake = () => {
      const rec = createRecognizerSafely({
        continuous: true,
        onPartial: (p) => {
          import("../voice/voice").then(({ containsWakeWord, stripWakeWord }) => {
            if (containsWakeWord(p)) {
              const remainder = stripWakeWord(p);
              rec.stop();
              if (stopped) return;
              store.setOrbLocal("WAKE", "Hey Orvix — listening…");
              if (remainder) {
                // wake + command in same utterance: "hey orvix what time is it"
                store.stopSpeaking?.();
                store.sendMessage(remainder);
              } else {
                triggerCommandListening();
              }
            }
          });
        },
        onFinal: (t) => {
          import("../voice/voice").then(({ containsWakeWord, stripWakeWord }) => {
            if (containsWakeWord(t)) {
              const remainder = stripWakeWord(t);
              rec.stop();
              if (stopped) return;
              store.setOrbLocal("WAKE", "Hey Orvix — listening…");
              if (remainder) {
                store.stopSpeaking?.();
                store.sendMessage(remainder);
              } else {
                triggerCommandListening(remainder);
              }
            }
          });
        },
        onEnd: () => {
          setWakeListening(false);
          if (!stopped && wakeOn && !listening) {
            // auto-restart wake loop (Chrome ends continuous after ~5s silence)
            setTimeout(() => { if (!stopped && wakeOn && !listening) startWake(); }, 400);
          } else {
            store.setOrbLocal("IDLE");
          }
        },
        onError: () => {
          setWakeListening(false);
          if (!stopped && wakeOn && !listening) setTimeout(startWake, 900);
        },
      });
      wakeRef.current = rec;
      setWakeListening(true);
      store.setOrbLocal("WAKE", "Say “Hey Orvix”");
      rec.start();
    };
    startWake();
    return () => {
      stopped = true;
      wakeRef.current?.stop();
      setWakeListening(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wakeOn, listening]);

  // Ctrl+Space = push-to-talk (reliable fallback per spec)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.code === "Space") {
        e.preventDefault();
        if (listening) {
          recognizerRef.current?.stop();
        } else {
          // barge-in if speaking
          try { store.abortCurrent?.(); } catch {}
          toggleMic();
        }
      }
      // Esc = stop everything
      if (e.code === "Escape") {
        try { store.abortCurrent?.(); } catch {}
        try { store.stopSpeaking?.(); } catch {}
        recognizerRef.current?.stop();
        wakeRef.current?.stop();
        setListening(false);
        setWakeListening(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [listening, wakeOn]);

  // Speak finished assistant replies aloud — via TTSProvider with normalization (Phase 2: sentence streaming, not 400 cut)
  useEffect(() => {
    if (!autoSpeak) return;
    const last = store.entries[store.entries.length - 1];
    if (last && last.role === "assistant" && !last.streaming && last.content) {
      // Use new TTSProvider if available, else fallback
      import("../voice/TTSProvider").then(({ PiperLocalTTS, normalizeForEnglishSpeech }) => {
        const norm = normalizeForEnglishSpeech(last.content);
        // try local Piper first (calls /api/voice/tts), fallback inside handles Web Speech
        const tts = new PiperLocalTTS();
        // stop previous if any
        try { window.speechSynthesis.cancel(); } catch {}
        tts.speak(norm.slice(0, 2000)).catch(() => {
          // ultimate fallback
          import("../voice/voice").then(({ speak }) => speak(norm.slice(0, 400), "en-US"));
        });
      }).catch(() => {
        import("../voice/voice").then(({ speak }) => speak(last.content.slice(0, 400), "en-US"));
      });
    }
  }, [store.entries, autoSpeak]);

  const active = store.tasks.filter((t) => t.status !== "COMPLETED").slice(0, 3);

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* ambient background */}
      <div className="absolute inset-0 pointer-events-none jarvis-aurora" />
      <div className="absolute inset-0 pointer-events-none jarvis-grid" />
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {Array.from({ length: 14 }, (_, i) => (
          <span
            key={i}
            className="star"
            style={{
              left: `${(i * 37) % 100}%`,
              top: `${(i * 53) % 100}%`,
              width: 2 + (i % 3),
              height: 2 + (i % 3),
              animationDuration: `${18 + (i % 7) * 4}s`,
              animationDelay: `${-(i * 3.7)}s`,
            }}
          />
        ))}
      </div>

      <div className="relative h-full flex">
        {/* ── center column: orb hero + collapsible conversation ── */}
        <div className="flex-1 min-w-0 flex flex-col items-center">
          {/* orb — always the centered hero */}
          <div className="flex-1 min-h-0 w-full flex flex-col items-center justify-center gap-1 px-6">
            <Orb_host
              state={listening ? "LISTENING" : wakeListening ? "WAKE" : store.orb}
              activity={
                listening && partial ? `“${partial}”` : wakeListening ? 'Say “Hey Orvix”…' : store.activity
              }
              onInterrupt={() => import("../voice/voice").then((m) => m.stopSpeaking())}
            />

            {store.entries.length === 0 && (
              <div className="anim-fade-in flex flex-col items-center gap-3 text-center -mt-2">
                <h1 className="text-xl font-semibold text-slate-100 tracking-tight">
                  Good to see you. <span className="gradient-text">What shall we do?</span>
                </h1>
                <p className="text-[13px] text-slate-400">Type below, hit the mic, or start with:</p>
                <div className="flex flex-wrap justify-center gap-2 max-w-xl">
                  {CHIPS.map((c) => (
                    <button
                      key={c.text}
                      onClick={() => store.sendMessage(c.text)}
                      className="glass card-hover text-xs rounded-full px-3.5 py-1.5 text-slate-300 hover:text-cyan-200 transition"
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* conversation toggle */}
          <button
            onClick={() => setChatOpen((v) => !v)}
            className="glass card-hover flex items-center gap-2 rounded-full px-4 py-1.5 text-[11px] tracking-[0.18em] uppercase hud-title text-slate-400 hover:text-cyan-200 mb-2"
            title={chatOpen ? "Hide conversation" : "Show conversation"}
          >
            {chatOpen ? <IconChevronDown width={13} height={13} /> : <IconChevronUp width={13} height={13} />}
            Conversation {chatOpen ? "·" : "·"} {store.entries.length}
          </button>

          {/* collapsible conversation area */}
          {chatOpen && (
            <div className="w-full max-w-3xl h-[38vh] min-h-[220px] overflow-y-auto px-6 pt-3 pb-1 flex flex-col items-center gap-4 border-t border-edge/60 anim-fade-in">
              {store.entries.length === 0 && (
                <p className="text-xs text-slate-500 mt-4">The conversation will appear here as you talk.</p>
              )}

              {store.entries.map((e) => (
                <div key={e.id} className={`w-full flex anim-fade-up ${e.role === "user" ? "justify-end" : "justify-start"}`}>
                  {e.role === "assistant" && (
                    <div
                      className="w-7 h-7 rounded-full shrink-0 self-start mt-1 mr-2.5"
                      style={{
                        background: "radial-gradient(circle at 35% 30%, #fff 0%, #22d3ee 45%, #0b1226 120%)",
                        boxShadow: "0 0 14px rgba(34,211,238,.5)",
                      }}
                    />
                  )}
                  <div
                    className={`rounded-2xl px-4 py-2.5 leading-relaxed ${
                      e.role === "user"
                        ? "bg-cyan-500/15 border border-cyan-400/25 max-w-[80%] text-sm whitespace-pre-wrap"
                        : "glass max-w-[85%]"
                    }`}
                  >
                    {e.role === "assistant" ? <Markdown text={e.content || (e.streaming ? "" : "")} /> : e.content}
                    {e.streaming && (
                      <span className="inline-block w-1.5 h-4 ml-1 bg-cyan-300 align-middle" style={{ animation: "blink 1s ease-in-out infinite" }} />
                    )}
                  </div>
                  {e.role === "assistant" && !e.streaming && e.content && (
                    <button
                      onClick={() => import("../voice/voice").then(({ speak }) => speak(e.content.slice(0, 400), "en-US"))}
                      title="Play reply"
                      className="ml-2 self-start mt-2 text-slate-500 hover:text-cyan-300"
                    >
                      <IconSpeaker width={13} height={13} />
                    </button>
                  )}
                </div>
              ))}

              {partial && <div className="self-end text-sm text-cyan-300/80 italic px-4 anim-fade-in">“{partial}”…</div>}
              <div ref={bottomRef} />
            </div>
          )}

          {/* ── floating composer ── */}
          <div className="w-full px-6 pb-5 pt-2">
            <div className="max-w-3xl mx-auto">
              <div className="glass-strong flex items-center gap-2 rounded-2xl pl-4 pr-2 py-2 shadow-2xl shadow-black/50 focus-within:border-cyan-400/50 transition">
                <input
                  ref={inputRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                  placeholder="Message Orvix…"
                  className="flex-1 bg-transparent outline-none text-sm py-2 placeholder:text-slate-500"
                />
                <button
                  onClick={() => setAutoSpeak((v) => !v)}
                  title={autoSpeak ? "Voice replies on" : "Voice replies off"}
                  className={`p-2 rounded-xl transition ${autoSpeak ? "text-cyan-300 bg-cyan-400/10" : "text-slate-500 hover:text-slate-300"}`}
                >
                  {autoSpeak ? <IconSpeaker width={16} height={16} /> : <IconSpeakerOff width={16} height={16} />}
                </button>
                <button
                  onClick={() => setWakeOn((v) => !v)}
                  title={wakeOn ? "Wake word “Hey Orvix” on — click to disable" : "Wake word off — click to enable “Hey Orvix”"}
                  className={`px-2.5 py-1.5 rounded-full text-[10px] tracking-[0.12em] uppercase font-bold border transition ${
                    wakeOn
                      ? "bg-cyan-400/15 text-cyan-300 border-cyan-400/30"
                      : "bg-white/5 text-slate-500 border-white/10 hover:text-slate-300"
                  } ${wakeListening ? "animate-pulse" : ""}`}
                >
                  {wakeOn ? "Hey Orvix ✓" : "Wake off"}
                </button>
                <button
                  onClick={toggleMic}
                  title={wakeOn ? "Voice input (or just say “Hey Orvix”)" : "Voice input"}
                  className={`w-9 h-9 rounded-full flex items-center justify-center transition ${
                    listening ? "bg-red-500/90 text-white" : wakeListening ? "bg-cyan-500/20 text-cyan-300 border border-cyan-400/30" : "bg-white/8 hover:bg-white/15 text-slate-300"
                  }`}
                  style={listening ? { animation: "pulseRing 1.6s ease-out infinite" } : undefined}
                >
                  <IconMic width={16} height={16} />
                </button>
                <button
                  onClick={submit}
                  className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-400 to-indigo-500 text-[#04060c] flex items-center justify-center hover:brightness-110 transition"
                  title="Send"
                >
                  <IconSend width={16} height={16} />
                </button>
              </div>
              <div className="text-center text-[10px] tracking-[0.22em] text-slate-600 mt-2 uppercase hud-title">
                {store.connected ? "Link active" : "Offline"} · {wakeOn ? (wakeListening ? "Listening for “Hey Orvix”…" : "Wake word on") : "Wake word off"} · click orb to stop voice
              </div>
            </div>
          </div>
        </div>

        {/* ── right mini panels (collapsible) ── */}
        <div className="hidden lg:flex flex-col gap-3 w-64 shrink-0 p-4 pr-5 overflow-y-auto">
          <button
            onClick={() => setPanelsOpen((v) => !v)}
            className="self-end text-[10px] tracking-[0.2em] uppercase text-slate-500 hover:text-cyan-300 transition hud-title"
          >
            {panelsOpen ? "Hide ⟩" : "⟨ Show"}
          </button>

          {panelsOpen && (
            <>
              <Panel title="Live status">
                <KV k="State" v={store.activity ?? store.orb.toLowerCase()} />
                <KV k="Core" v={store.brain || "…"} />
                <KV k="Messages" v={String(store.entries.length)} />
              </Panel>

              <Panel title="Active work">
                {active.length === 0 && <Muted>Nothing in progress.</Muted>}
                {active.map((t) => (
                  <div key={t.id} className="text-xs rounded-lg px-2.5 py-2 bg-white/5 mb-1.5">
                    <div className="truncate">{t.title}</div>
                    <div className="text-slate-500 mt-0.5">
                      {t.progress.total > 0 ? `${t.progress.done}/${t.progress.total}` : t.status.toLowerCase()}
                    </div>
                  </div>
                ))}
              </Panel>

              <Panel title="Approvals">
                {store.approvals.length === 0 && <Muted>Nothing pending ✓</Muted>}
                {store.approvals.slice(0, 3).map((a) => (
                  <div key={a.id} className="rounded-lg px-2.5 py-2 bg-amber-400/10 border border-amber-400/25 text-xs mb-1.5">
                    <div className="truncate">{a.action}</div>
                    <div className="flex gap-1.5 mt-1.5">
                      <button
                        onClick={() => store.resolveApproval(a.id, "approved")}
                        className="flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-500/85 hover:bg-emerald-500 text-[#04060c] font-semibold"
                      >
                        <IconCheck width={11} height={11} /> Approve
                      </button>
                      <button
                        onClick={() => store.resolveApproval(a.id, "rejected")}
                        className="flex items-center gap-1 px-2.5 py-1 rounded bg-red-500/70 hover:bg-red-500 text-white font-semibold"
                      >
                        <IconX width={11} height={11} /> Reject
                      </button>
                    </div>
                  </div>
                ))}
              </Panel>

              {(store.notifications.length > 0 || store.monitors.length > 0) && (
                <Panel title="Alerts">
                  {store.notifications.slice(-4).map((n) => (
                    <div key={n.id} className="rounded-lg px-2.5 py-2 bg-cyan-400/10 border border-cyan-400/20 text-xs mb-1.5 flex gap-1.5">
                      <IconBell width={12} height={12} className="text-cyan-300 shrink-0 mt-0.5" />
                      <span>
                        <span className="font-semibold text-cyan-200">{n.title}</span> — {n.body}
                      </span>
                    </div>
                  ))}
                  {store.monitors.slice(0, 3).map((m) => (
                    <div key={m.id} className="text-xs rounded-lg px-2.5 py-2 bg-white/5 mb-1.5 flex justify-between gap-2">
                      <span className="truncate">{m.name}</span>
                      <span className="text-slate-500 shrink-0">{m.enabled ? <IconEye width={12} height={12} /> : <IconPause width={12} height={12} />}</span>
                    </div>
                  ))}
                </Panel>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Wrapper so the Orb import stays lazy-friendly and interrupt closure is stable.
import { Orb } from "../orb/Orb";
function Orb_host(props: { state: Parameters<typeof Orb>[0]["state"]; activity?: string; onInterrupt?: () => void }) {
  return <Orb {...props} size={330} />;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="glass rounded-2xl p-3.5">
      <h2 className="hud-title text-[9px] uppercase tracking-[0.22em] text-slate-500 mb-2.5">{title}</h2>
      {children}
    </section>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between text-xs py-1 gap-2">
      <span className="text-slate-500 shrink-0">{k}</span>
      <span className="text-slate-200 truncate text-right">{v}</span>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-slate-500">{children}</p>;
}

// Local import helper to avoid pulling voice into SSR-ish contexts.
import { createRecognizer, voiceSupport, stopSpeaking } from "../voice/voice";
type RecogOpts = Omit<Parameters<typeof createRecognizer>[0], "lang"> & { lang?: string };
function createRecognizerSafely(opts: RecogOpts) {
  const vs = voiceSupport();
  if (!vs.stt) {
    return { start: () => {}, stop: () => {} };
  }
  return createRecognizer({ lang: "en-US", ...opts });
}
