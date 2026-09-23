import { EventEmitter } from "node:events";
import type { Db } from "./db.ts";
import { uid, now } from "./db.ts";
import type { JarvisEvent } from "@jarvis/schemas";

// ── Event bus (blueprint §34, §88 nervous system) ─────────────────────────

export class EventBus {
  private emitter = new EventEmitter();

  constructor(private db: Db) {
    this.emitter.setMaxListeners(100);
  }

  publish(name: string, payload: Record<string, unknown> = {}, userId = "local"): JarvisEvent {
    const evt: JarvisEvent = {
      id: uid("evt"),
      name,
      payload,
      createdAt: now(),
    };
    this.db
      .prepare("INSERT INTO events (id, user_id, name, payload_json, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(evt.id, userId, name, JSON.stringify(payload), evt.createdAt);
    this.emitter.emit(name, evt);
    this.emitter.emit("*", evt);
    return evt;
  }

  subscribe(names: string | "*", handler: (evt: JarvisEvent) => void): () => void {
    this.emitter.on(names, handler);
    return () => this.emitter.off(names, handler);
  }
}
