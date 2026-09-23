import {
  openDb,
  ensureUser,
  MemoryRepo,
  MonitorRepo,
  ApprovalRepo,
  AuditRepo,
  ReminderRepo,
  MemoryEngine,
  EventBus,
  logger,
} from "@jarvis/core";

// ── Background worker (§37) ───────────────────────────────────────────────
// Shares the SQLite store with the gateway (WAL allows multi-process reads).
// In cloud deployments this runs separately; locally it complements the
// gateway's in-process loop for checks the user wants while the UI is closed.

const DATA_DIR = process.env.JARVIS_DATA_DIR ?? ".jarvis";
const TICK_MS = (Number(process.env.WORKER_TICK_MS) > 0 ? Number(process.env.WORKER_TICK_MS) : 60_000);

const db = openDb(DATA_DIR);
ensureUser(db, "local", "Local User");

const monitors = new MonitorRepo(db);
const audit = new AuditRepo(db);
const events = new EventBus(db);
const memoryEngine = new MemoryEngine(new MemoryRepo(db), db);
void memoryEngine;
const reminders = new ReminderRepo(db);

logger.info("worker.started", { dataDir: DATA_DIR, tickMs: TICK_MS });

setInterval(() => {
  // 1. Fire due reminders into the audit/event streams.
  for (const r of reminders.due()) {
    reminders.markFired(r.id);
    audit.log(r.user_id, "jarvis", "reminder.fired", r.text);
    events.publish("REMINDER_DUE", { id: r.id, text: r.text }, r.user_id);
    logger.info("reminder.fired", { id: r.id, text: r.text });
  }

  // 2. Probe URL-condition monitors.
  for (const mon of monitors.listEnabled()) {
    if (!mon.target.startsWith("http")) continue;
    void fetch(mon.target, { method: "HEAD" })
      .then((res) => {
        const state = String(res.status);
        const changed = mon.lastState !== state;
        monitors.recordResult(mon.id, state);
        if (changed) {
          audit.log(mon.target.startsWith("http") ? "local" : "local", "jarvis", "monitor.changed", `${mon.name}: ${mon.lastState} → ${state}`);
          events.publish("MONITOR_TRIGGERED", { monitorId: mon.id, state, name: mon.name });
        }
      })
      .catch(() => {
        const changed = mon.lastState !== "unreachable";
        monitors.recordResult(mon.id, "unreachable");
        if (changed) {
          audit.log("local", "jarvis", "monitor.changed", `${mon.name}: unreachable`);
          events.publish("MONITOR_TRIGGERED", { monitorId: mon.id, state: "unreachable", name: mon.name });
        }
      });
  }
}, TICK_MS);
