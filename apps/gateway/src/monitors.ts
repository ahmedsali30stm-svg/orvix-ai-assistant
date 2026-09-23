import type { MonitorRepo, ReminderRepo, AuditRepo, EventBus } from "@jarvis/core";
import { logger } from "@jarvis/core";
import type { WsHub } from "./hub.ts";

// ── Nervous system loop (§36–§37) ──────────────────────────────────────────
// Evaluates monitors on an interval, compares state, notifies on meaningful
// change only (§59). Time/condition monitors evaluate a small safe expression
// DSL against the current state: e.g. "state == confirmed", "value > 10".

export interface MonitorLoopDeps {
  monitorRepo: MonitorRepo;
  reminders: ReminderRepo;
  audit: AuditRepo;
  events: EventBus;
  hub: WsHub;
  everyMs: number;
}

/** Tiny condition evaluator: "x == y", "x != y", "x contains y", "x > n", "x < n". */
export function evalCondition(state: string, condition: string): boolean {
  const s = state.trim().toLowerCase();
  const c = condition.trim().toLowerCase();
  const eq = /^(\S+)\s*==\s*(\S+)$/.exec(c);
  if (eq) return s === eq[2];
  const neq = /^(\S+)\s*!=\s*(\S+)$/.exec(c);
  if (neq) return s !== neq[2];
  const contains = /^(\S+)\s+contains\s+(.+)$/.exec(c);
  if (contains) return s.includes(contains[2]!.trim().replace(/^["']|["']$/g, ""));
  const gt = /^(\S+)\s*>\s*(-?\d+(?:\.\d+)?)$/.exec(c);
  if (gt) return Number(s) > Number(gt[2]);
  const lt = /^(\S+)\s*<\s*(-?\d+(?:\.\d+)?)$/.exec(c);
  if (lt) return Number(s) < Number(lt[2]);
  return false;
}

function intervalFromFrequency(freq: string, fallback: number): number {
  const m = /^(\d+)\s*(s|m|h|d)\b/.exec(freq.trim().toLowerCase());
  if (!m) return fallback;
  const n = Number(m[1]);
  const unit = m[2]!;
  return n * (unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000);
}

export function startMonitors(deps: MonitorLoopDeps): void {
  const { monitorRepo, reminders, audit, events, hub, everyMs } = deps;

  // Fire due reminders as notifications.
  const reminderTimer = setInterval(() => {
    for (const r of reminders.due()) {
      reminders.markFired(r.id);
      audit.log(r.user_id, "jarvis", "reminder.fired", r.text);
      hub.broadcast({ type: "monitor.notification", monitorId: r.id, title: "Reminder", body: r.text });
    }
  }, everyMs);
  reminderTimer.unref?.();

  // Evaluate enabled monitors whose interval has elapsed.
  const monitorTimer = setInterval(() => {
    for (const mon of monitorRepo.listEnabled()) {
      const interval = intervalFromFrequency(mon.frequency, everyMs);
      const last = mon.lastRunAt ? Date.parse(mon.lastRunAt) : 0;
      if (Date.now() - last < interval) continue;

      let state = "";
      try {
        // State probes: the built-in target names the gateway knows how to check.
        if (mon.target.startsWith("http")) {
          // URL probe: healthy if reachable and 2xx.
          void fetch(mon.target, { method: "HEAD" })
            .then((res) => `${res.status}`)
            .catch(() => "unreachable")
            .then((state) => finalize(mon.id, mon.notifyWhen, state, mon.condition, mon.name, mon.lastState));
        } else if (mon.target === "clock") {
          state = new Date().toISOString();
          finalize(mon.id, mon.notifyWhen, state, mon.condition, mon.name, mon.lastState);
        } else {
          state = `unknown-target:${mon.target}`;
          finalize(mon.id, mon.notifyWhen, state, mon.condition, mon.name, mon.lastState);
        }
      } catch (err) {
        logger.warn("monitor.error", { monitor: mon.id, error: String(err) });
      }

      function finalize(id: string, notifyWhen: string, st: string, condition: string, name: string, lastState: string | null) {
        monitorRepo.recordResult(id, st);
        const changed = lastState !== st;
        const breach = evalCondition(st, condition);
        const shouldNotify = notifyWhen === "always" || (notifyWhen === "changed" && changed) || (notifyWhen === "breach" && breach);
        if (shouldNotify) {
          audit.log("local", "jarvis", "monitor.notified", `${name}: state=${st}`);
          events.publish("MONITOR_TRIGGERED", { monitorId: id, state: st, name });
          hub.broadcast({ type: "monitor.notification", monitorId: id, title: `Monitor: ${name}`, body: `state=${st}${breach ? " (condition met)" : ""}` });
        }
      }
    }
  }, everyMs);
  monitorTimer.unref?.();
}
