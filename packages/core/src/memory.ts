import type { Db } from "./db.ts";
import type { MemoryRepo } from "./repos.ts";
import type { MemoryRecord } from "@jarvis/schemas";

// ── Memory engine (blueprint §26–§29) ─────────────────────────────────────
// Retrieval is keyword+importance scored today; the interface is designed so
// pgvector semantic search drops in later without changing call sites.

export class MemoryEngine {
  constructor(
    private repo: MemoryRepo,
    private db: Db,
  ) {}

  retrieve(userId: string, query: string, limit = 6): MemoryRecord[] {
    return this.repo.retrieve(userId, query, limit);
  }

  /**
   * Selective write (§29): only durable, useful facts are kept. Transient
   * chatter, questions, and short unstructured lines are discarded.
   */
  considerFromMessage(userId: string, text: string): MemoryRecord | null {
    const t = text.trim();
    if (t.length < 24 || t.length > 600) return null;
    if (/[?؟]$/.test(t)) return null; // questions are not facts
    const durable =
      /\b(prefer|preference|always|never|important|remember|rule|decision|decided|deadline|birthday|anniversary|key|main|budget|target|إزاي|مهم|قاعدة|قررنا|افتكر)\b/i;
    if (!durable.test(t)) return null;

    const lower = t.toLowerCase();
    let type: MemoryRecord["type"] = "episodic";
    if (/\b(prefer|preference|like to|favorite)\b/i.test(t)) type = "preference";
    else if (/\b(decided|decision|we will go with)\b/i.test(t)) type = "decision";
    else if (/\b(rule|policy|must|never)\b/i.test(t)) type = "business";
    else if (/\b(project|repo|release|milestone)\b/i.test(t)) type = "project";
    else if (/\b(my name|call me|i am)\b/i.test(t)) type = "user";

    const subject = t.split(/\s+/).slice(0, 6).join(" ").replace(/[.,!?]+$/, "");
    const existing = this.repo.list(userId).find((m) => m.subject.toLowerCase() === subject.toLowerCase());
    if (existing) {
      this.repo.update(existing.id, t, Math.min(1, existing.importance + 0.1));
      return this.repo.get(existing.id)!;
    }
    return this.repo.save({
      userId,
      type,
      subject,
      content: t,
      source: "conversation",
      importance: 0.6,
    });
  }

  /** Context package for the prompt builder (§73–§74). */
  contextBlock(userId: string, query: string): string {
    const mems = this.retrieve(userId, query, 6);
    if (mems.length === 0) return "";
    return ["Relevant memories:", ...mems.map((m) => `- [${m.type}] ${m.subject}: ${m.content}`)].join("\n");
  }
}
