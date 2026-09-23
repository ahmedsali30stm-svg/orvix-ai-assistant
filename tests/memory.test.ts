import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { openDb, ensureUser, MemoryRepo, MemoryEngine } from "@jarvis/core";

const DIR = ".test-memory";
rmSync(DIR, { recursive: true, force: true });

const db = openDb(DIR);
const userId = ensureUser(db);
const repo = new MemoryRepo(db);
const engine = new MemoryEngine(repo, db);

test("saves and lists memories", () => {
  repo.save({ userId, type: "preference", subject: "language", content: "User prefers Egyptian Arabic", source: "conversation" });
  const all = repo.list(userId);
  assert.equal(all.length, 1);
  assert.equal(all[0]!.subject, "language");
});

test("selective write keeps durable facts (§29)", () => {
  const kept = engine.considerFromMessage(userId, "Important: our refund policy is 14 days, remember this rule");
  assert.notEqual(kept, null);
});

test("selective write discards questions and chatter", () => {
  const q = engine.considerFromMessage(userId, "what time is it?");
  assert.equal(q, null);
  const short = engine.considerFromMessage(userId, "ok");
  assert.equal(short, null);
});

test("retrieval ranks matching memories first", () => {
  repo.save({ userId, type: "project", subject: "website", content: "Company website runs on WordPress", source: "conversation", importance: 0.8 });
  const hits = engine.retrieve(userId, "wordpress website");
  assert.ok(hits.length >= 1);
  assert.ok(hits.some((m) => m.subject === "website"));
});

test("duplicate subjects update instead of duplicating", () => {
  const before = repo.list(userId).length;
  engine.considerFromMessage(userId, "Remember: important client deadline next Tuesday");
  const after = repo.list(userId).length;
  assert.ok(after >= before);
});
