import type { Store } from "../store";
import {
  IconConsole, IconThreads, IconTasks, IconMemory, IconTools, IconCommand, IconSettings,
  IconChevronLeft, IconChevronRight,
} from "./icons";

export type Screen = "home" | "chat" | "tasks" | "memory" | "tools" | "command" | "settings";

const NAV: Array<{ id: Screen; label: string; Icon: (p: { width?: number; height?: number; className?: string }) => JSX.Element }> = [
  { id: "home", label: "Console", Icon: IconConsole },
  { id: "chat", label: "Threads", Icon: IconThreads },
  { id: "tasks", label: "Tasks", Icon: IconTasks },
  { id: "memory", label: "Memory", Icon: IconMemory },
  { id: "tools", label: "Tools", Icon: IconTools },
  { id: "command", label: "Command", Icon: IconCommand },
  { id: "settings", label: "Settings", Icon: IconSettings },
];

export function Sidebar({
  store,
  screen,
  onNavigate,
  collapsed,
  onToggle,
}: {
  store: Store;
  screen: Screen;
  onNavigate: (s: Screen) => void;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <aside
      className="shrink-0 border-r border-edge bg-panel/50 backdrop-blur-xl p-3 flex flex-col transition-[width] duration-300 ease-[cubic-bezier(.4,0,.2,1)] overflow-hidden"
      style={{ width: collapsed ? 68 : 208 }}
    >
      {/* brand + collapse toggle */}
      <div className={`flex items-center gap-2.5 px-1 pt-2 pb-5 ${collapsed ? "flex-col justify-center" : ""}`}>
        <button
          onClick={onToggle}
          title={collapsed ? "Expand menu" : "Collapse menu"}
          className="w-9 h-9 rounded-xl flex items-center justify-center bg-white/5 hover:bg-cyan-400/15 hover:text-cyan-300 text-slate-300 transition shrink-0"
        >
          {collapsed ? <IconChevronRight width={16} height={16} /> : <IconChevronLeft width={16} height={16} />}
        </button>
        {!collapsed && (
          <span className="brand-mark text-[17px] font-bold text-cyan-300 select-none">Orvix</span>
        )}
      </div>

      <nav className="flex flex-col gap-1">
        {NAV.map(({ id, label, Icon }) => {
          const active = screen === id;
          return (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              title={collapsed ? label : undefined}
              className={`group relative flex items-center gap-3 text-left rounded-xl transition card-hover border ${
                collapsed ? "justify-center w-11 h-11 mx-auto px-0" : "px-3 py-2.5 text-[13px]"
              } ${
                active
                  ? "bg-cyan-400/10 text-cyan-200 border-cyan-400/30"
                  : "text-slate-400 hover:text-slate-200 hover:bg-white/5 border-transparent"
              }`}
            >
              {/* active indicator */}
              {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 -ml-3 w-[3px] h-5 rounded-full bg-cyan-300" style={{ boxShadow: "0 0 8px #22d3ee" }} />}
              <Icon width={16} height={16} className={active ? "text-cyan-300" : "text-slate-500 group-hover:text-slate-300"} />
              {!collapsed && <span>{label}</span>}
              {!collapsed && id === "command" && store.approvals.length > 0 && (
                <span className="ml-auto inline-flex items-center justify-center min-w-5 h-5 px-1 text-[10px] rounded-full bg-amber-400 text-black font-bold">
                  {store.approvals.length}
                </span>
              )}
              {collapsed && id === "command" && store.approvals.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-amber-400" style={{ boxShadow: "0 0 8px #facc15" }} />
              )}
              {/* tooltip when collapsed */}
              {collapsed && (
                <span className="pointer-events-none absolute left-full ml-3 whitespace-nowrap rounded-lg glass-strong px-2.5 py-1.5 text-xs text-slate-200 opacity-0 group-hover:opacity-100 transition-opacity z-50">
                  {label}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className={`mt-auto pb-1 text-[10px] leading-relaxed text-slate-500 ${collapsed ? "flex flex-col items-center gap-2" : "px-1"}`}>
        <div
          className={`w-2 h-2 rounded-full shrink-0 ${store.connected ? "bg-emerald-400" : "bg-red-500"}`}
          style={{ boxShadow: `0 0 8px ${store.connected ? "#34d399" : "#f87171"}` }}
          title={store.connected ? "Link active" : "Offline"}
        />
        {!collapsed && (
          <>
            <div className="mono truncate w-full" title={store.brain}>
              CORE · {store.brain || "…"}
            </div>
            <div className="tracking-widest uppercase hud-title">{store.connected ? "Link active" : "Offline"}</div>
          </>
        )}
      </div>
    </aside>
  );
}
