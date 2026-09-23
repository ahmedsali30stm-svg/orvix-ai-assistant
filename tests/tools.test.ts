import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fsList, fsWrite, fsRead, fsSearch, isDestructiveCommand, computerOpen } from "@jarvis/core";
import { ToolRegistry } from "@jarvis/core";
import { openDb, AuditRepo } from "@jarvis/core";

const tmp = mkdtempSync(join(tmpdir(), "jarvis-tools-"));
writeFileSync(join(tmp, "seed.txt"), "seed");

test("fs.list lists a real directory", async () => {
  const r = await fsList.execute({ path: tmp }, { db: {}, userId: "test" });
  assert.equal(r.ok, true);
});

test("fs.write + verify round-trips bytes (§11)", async () => {
  const target = join(tmp, "hello.txt");
  const r = await fsWrite.execute({ path: target, content: "hello jarvis" }, { db: {}, userId: "test" });
  assert.equal(r.ok, true);
  const v = await fsWrite.verify!({ path: target }, r, { db: {}, userId: "test" });
  assert.equal(v.verified, true);
  const back = await fsRead.execute({ path: target }, { db: {}, userId: "test" });
  assert.equal((back.data as { content: string }).content, "hello jarvis");
});

test("fs.search finds files by name substring", async () => {
  writeFileSync(join(tmp, "sales_report.csv"), "a,b");
  const r = await fsSearch.execute({ path: tmp, query: "report" }, { db: {}, userId: "test" });
  assert.equal(r.ok, true);
  assert.ok((r.data as { matches: string[] }).matches.some((m) => m.includes("sales_report")));
});

test("sensitive paths are blocked", async () => {
  await assert.rejects(() => fsList.execute({ path: "C:\\Windows\\System32" }, { db: {}, userId: "t" }));
});

test("computer.open refuses non-http(s) URL schemes", async () => {
  const r = await computerOpen.execute({ target: "javascript:alert(1)" }, { db: {}, userId: "t" });
  assert.equal(r.ok, false);
  assert.equal((r as { errorCategory?: string }).errorCategory, "InvalidInput");

  const r2 = await computerOpen.execute({ target: "file:///C:/secrets.txt" }, { db: {}, userId: "t" });
  assert.equal(r2.ok, false);
});

test("computer.open refuses unknown apps with a clear failure (no fake success)", async () => {
  const r = await computerOpen.execute({ target: "definitely-not-a-real-app-xyz" }, { db: {}, userId: "t" });
  assert.equal(r.ok, false);
  assert.match((r as { summary?: string }).summary ?? "", /not a URL, not an existing path/);
});

test("computer.open rejects empty input", async () => {
  const r = await computerOpen.execute({}, { db: {}, userId: "t" });
  assert.equal(r.ok, false);
});

test("destructive command patterns are detected (§53)", () => {
  assert.equal(isDestructiveCommand("rm -rf /"), true);
  assert.equal(isDestructiveCommand("Remove-Item -Recurse -Force C:\\data"), true);
  assert.equal(isDestructiveCommand("drop table users"), true);
  assert.equal(isDestructiveCommand("echo hello"), false);
  assert.equal(isDestructiveCommand("dir"), false);
});

test("registry rejects invalid tool input (§90 rule 8)", async () => {
  const db = openDb(join(tmp, "db"));
  const audit = new AuditRepo(db);
  const reg = new ToolRegistry(db, audit);
  reg.register(fsList);
  await assert.rejects(
    () => reg.execute("fs.list", {}, { db, userId: "t" }),
    /Missing required parameter/,
  );
});

test("registry rejects unknown tools", async () => {
  const db = openDb(join(tmp, "db2"));
  const reg = new ToolRegistry(db, new AuditRepo(db));
  await assert.rejects(() => reg.execute("nope.something", {}, { db, userId: "t" }), /Unknown tool/);
});

test("registry blocks unapproved critical tools (§24)", async () => {
  const db = openDb(join(tmp, "db3"));
  const audit = new AuditRepo(db);
  const reg = new ToolRegistry(db, audit);
  const { computerRunCommand } = await import("@jarvis/core");
  reg.register(computerRunCommand);
  await assert.rejects(
    () => reg.execute("computer.run_command", { command: "echo hi" }, { db, userId: "t" }),
    (err: unknown) => {
      const e = err as { approvalRequired?: boolean; category?: string };
      return e.approvalRequired === true;
    },
  );
});

after(() => {
  // Windows can briefly hold SQLite handles; retry and never fail the suite on cleanup.
  try {
    rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch {
    /* best effort */
  }
});
