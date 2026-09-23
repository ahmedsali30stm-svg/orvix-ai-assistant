import { useEffect, useMemo, useRef, useState } from "react";
import type { OrbState } from "@jarvis/schemas";

// ── Orb — HUD-grade visualization (§42–§44) ───────────────────────────────
// Layers: SVG tick rings + rotating arc satellites + conic shimmer sweep +
// glass sphere core with fresnel highlight + reactive waveform ring.
// The whole assembly tracks the cursor with soft parallax and floats.

const THEME: Record<OrbState, { ring: string; glow: string; core: string }> = {
  IDLE: { ring: "#22d3ee", glow: "rgba(34,211,238,.30)", core: "#22d3ee" },
  WAKE: { ring: "#22d3ee", glow: "rgba(34,211,238,.55)", core: "#22d3ee" },
  LISTENING: { ring: "#67e8f9", glow: "rgba(103,232,249,.60)", core: "#67e8f9" },
  UNDERSTANDING: { ring: "#818cf8", glow: "rgba(129,140,248,.55)", core: "#818cf8" },
  THINKING: { ring: "#818cf8", glow: "rgba(129,140,248,.55)", core: "#818cf8" },
  PLANNING: { ring: "#a78bfa", glow: "rgba(167,139,250,.60)", core: "#a78bfa" },
  SEARCHING: { ring: "#38bdf8", glow: "rgba(56,189,248,.55)", core: "#38bdf8" },
  EXECUTING: { ring: "#34d399", glow: "rgba(52,211,153,.60)", core: "#34d399" },
  WAITING: { ring: "#facc15", glow: "rgba(250,204,21,.55)", core: "#facc15" },
  SPEAKING: { ring: "#22d3ee", glow: "rgba(34,211,238,.60)", core: "#22d3ee" },
  SUCCESS: { ring: "#34d399", glow: "rgba(52,211,153,.75)", core: "#34d399" },
  ERROR: { ring: "#f87171", glow: "rgba(248,113,113,.60)", core: "#f87171" },
};

const WAVE_STATES: ReadonlySet<string> = new Set(["LISTENING", "SPEAKING", "EXECUTING", "SEARCHING", "WAKE"]);
const SPIN_STATES: ReadonlySet<string> = new Set(["THINKING", "PLANNING", "UNDERSTANDING", "SEARCHING"]);

function tickRings(radius: number): { outer: string[]; inner: string[] } {
  const outer: string[] = [];
  const inner: string[] = [];
  for (let i = 0; i < 72; i++) {
    const a = (i * 5 * Math.PI) / 180;
    const major = i % 6 === 0;
    const r1 = radius;
    const r2 = radius - (major ? 8 : 4);
    (major ? outer : inner).push(`M ${Math.cos(a) * r1} ${Math.sin(a) * r1} L ${Math.cos(a) * r2} ${Math.sin(a) * r2}`);
  }
  for (let i = 0; i < 48; i++) {
    const a = (i * 7.5 * Math.PI) / 180;
    const r1 = radius * 0.78;
    const r2 = radius * 0.78 - (i % 4 === 0 ? 5 : 3);
    inner.push(`M ${Math.cos(a) * r1} ${Math.sin(a) * r1} L ${Math.cos(a) * r2} ${Math.sin(a) * r2}`);
  }
  return { outer, inner };
}

export function Orb({
  state,
  activity,
  size = 320,
  onInterrupt,
}: {
  state: OrbState;
  activity?: string;
  size?: number;
  onInterrupt?: () => void;
}) {
  const t = THEME[state] ?? THEME.IDLE!;
  const waving = WAVE_STATES.has(state);
  const spinning = SPIN_STATES.has(state);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const raf = useRef(0);

  // Soft cursor parallax via rAF for smoothness.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(() => {
        const nx = (e.clientX / window.innerWidth) * 2 - 1;
        const ny = (e.clientY / window.innerHeight) * 2 - 1;
        setTilt({ x: nx * 14, y: ny * 10 });
      });
    };
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(raf.current);
    };
  }, []);

  const R = size / 2;
  const ticks = useMemo(() => tickRings(R - 6), [R]);

  const bars = useMemo(() => Array.from({ length: 56 }, (_, i) => i), []);
  const waveR = R - 26;
  const waveDur = state === "SPEAKING" || state === "EXECUTING" ? "0.5s" : "0.9s";

  return (
    <div
      className="flex flex-col items-center justify-center gap-6 select-none cursor-pointer"
      onClick={onInterrupt}
      title={onInterrupt ? "Click to interrupt voice" : undefined}
    >
      <div style={{ width: size, height: size }} className="relative flex items-center justify-center">
        {/* float + parallax */}
        <div className="absolute inset-0" style={{ animation: "float 8s ease-in-out infinite" }}>
          <div
            className="absolute inset-0 flex items-center justify-center transition-transform duration-500 ease-out"
            style={{ transform: `translate3d(${tilt.x}px, ${tilt.y}px, 0)` }}
          >
            {/* ambient bloom */}
            <div
              className="absolute rounded-full"
              style={{
                inset: -size * 0.22,
                background: `radial-gradient(circle, ${t.glow}, transparent 62%)`,
                filter: "blur(30px)",
                animation: "glowPulse 3.4s ease-in-out infinite",
              }}
            />

            {/* tick rings (SVG) */}
            <svg
              width={size}
              height={size}
              viewBox={`${-R} ${-R} ${size} ${size}`}
              className="absolute inset-0"
              style={{ animation: `spinRev ${spinning ? 20 : 46}s linear infinite`, opacity: 0.5 }}
            >
              <g stroke={t.ring} strokeWidth={1.1} strokeLinecap="round" opacity={0.85}>
                <path d={ticks.outer.join(" ")} />
              </g>
              <g stroke={t.ring} strokeWidth={0.8} strokeLinecap="round" opacity={0.45}>
                <path d={ticks.inner.join(" ")} />
              </g>
            </svg>

            {/* arc satellites: two counter-rotating arcs */}
            <div className="absolute inset-0" style={{ animation: `spin ${spinning ? 3.2 : 11}s linear infinite` }}>
              <svg width={size} height={size} viewBox={`${-R} ${-R} ${size} ${size}`} className="absolute inset-0">
                <circle
                  r={R - 14}
                  fill="none"
                  stroke={t.ring}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeDasharray={`${(R - 14) * 0.9} ${(R - 14) * 5.3}`}
                  opacity={0.9}
                />
              </svg>
            </div>
            <div className="absolute" style={{ inset: size * 0.07, animation: "spinRev 7.5s linear infinite" }}>
              <svg width={size * 0.86} height={size * 0.86} viewBox={`${-R * 0.86} ${-R * 0.86} ${size * 0.86} ${size * 0.86}`} className="absolute inset-0">
                <circle
                  r={R * 0.8}
                  fill="none"
                  stroke={t.ring}
                  strokeWidth={1.2}
                  strokeLinecap="round"
                  strokeDasharray={`${R * 1.5} ${R * 3.5}`}
                  opacity={0.5}
                />
              </svg>
            </div>

            {/* orbiting satellites */}
            <div className="absolute inset-0" style={{ animation: "spin 6.5s linear infinite" }}>
              <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full" style={{ background: t.ring, boxShadow: `0 0 12px ${t.ring}` }} />
              <span className="absolute left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 w-1 h-1 rounded-full opacity-60" style={{ background: "#fff", boxShadow: `0 0 8px ${t.ring}` }} />
            </div>

            {/* waveform ring */}
            {bars.map((i) => {
              const angle = i * (360 / bars.length);
              return (
                <div key={i} className="absolute left-1/2 top-1/2" style={{ transform: `rotate(${angle}deg) translateY(-${waveR}px)` }}>
                  <div
                    style={{
                      width: 2.5,
                      marginLeft: -1.25,
                      marginTop: -8,
                      height: waving ? undefined : 3,
                      borderRadius: 2,
                      background: t.ring,
                      opacity: waving ? undefined : 0.18,
                      transition: "opacity .5s ease",
                      animation: waving ? `barPulse ${waveDur} ease-in-out infinite` : undefined,
                      animationDelay: waving ? `${(i % 14) * 0.045}s` : undefined,
                    }}
                  />
                </div>
              );
            })}

            {/* conic shimmer sweep over glass */}
            <div
              className="absolute rounded-full mix-blend-screen"
              style={{
                inset: R * 0.3,
                background: `conic-gradient(from 0deg, transparent 0deg, ${t.ring}22 40deg, transparent 90deg)`,
                animation: `spin ${spinning ? 1.8 : 5.5}s linear infinite`,
                filter: "blur(2px)",
              }}
            />

            {/* glass sphere core */}
            <div
              className="relative rounded-full"
              style={{
                width: R * 0.72,
                height: R * 0.72,
                background: `radial-gradient(circle at 33% 28%, rgba(255,255,255,.95) 0%, ${t.core} 34%, ${t.core}cc 55%, #060a18 120%)`,
                boxShadow: `0 0 ${R * 0.5}px ${t.ring}aa, 0 0 ${R * 0.14}px ${t.ring}, inset 0 0 30px rgba(255,255,255,.35), inset -8px -12px 30px rgba(0,0,0,.45)`,
                animation: spinning ? "spin 4s linear infinite" : "breathe 3s ease-in-out infinite",
              }}
            >
              {/* fresnel rim */}
              <div
                className="absolute inset-0 rounded-full"
                style={{ border: "1px solid rgba(255,255,255,.35)", boxShadow: "inset 0 0 18px rgba(255,255,255,.25)" }}
              />
              {/* specular highlight */}
              <div
                className="absolute rounded-full"
                style={{ width: "26%", height: "16%", top: "14%", left: "20%", background: "rgba(255,255,255,.85)", filter: "blur(3px)", transform: "rotate(-18deg)" }}
              />
              {/* inner energy swirl (no text — the core stays clean) */}
              <div
                className="absolute rounded-full mix-blend-screen"
                style={{
                  inset: "18%",
                  background: `radial-gradient(circle at 60% 65%, ${t.ring}55, transparent 60%)`,
                  animation: "spinRev 9s linear infinite",
                  filter: "blur(3px)",
                }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="h-7 text-sm tracking-wide text-slate-200/90 text-center max-w-md px-4">
        {activity ?? "Ready when you are ✨"}
      </div>
    </div>
  );
}
