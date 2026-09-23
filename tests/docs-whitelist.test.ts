import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { docsReadXlsx, docsReadPdf } from "@jarvis/core";
import { PermissionEngine, normalizeTarget } from "@jarvis/core";

const tmp = mkdtempSync(join(tmpdir(), "orvix-docs-"));

// Build a real xlsx fixture with two sheets via ExcelJS (secure, no xlsx vuln).
{
  const wb = new ExcelJS.Workbook();
  const ws1 = wb.addWorksheet("Payroll");
  ws1.addRow(["Employee", "Salary", "Dept"]);
  ws1.addRow(["Sara", 9000, "Sales"]);
  ws1.addRow(["Omar", 7500, "Ops"]);
  ws1.addRow(["Nada", 8200, "Sales"]);
  const ws2 = wb.addWorksheet("Notes");
  ws2.addRow(["Note"]);
  ws2.addRow(["confidential"]);
  await wb.xlsx.writeFile(join(tmp, "payroll.xlsx"));
}

test("docs.read_xlsx parses sheets, headers and rows", async () => {
  const r = await docsReadXlsx.execute({ path: join(tmp, "payroll.xlsx") }, { db: {}, userId: "t" });
  assert.equal(r.ok, true);
  const data = r.data as { sheets: Array<{ name: string; headers: string[]; rows: Array<Record<string, unknown>> }> };
  assert.deepEqual(data.sheets.map((s) => s.name), ["Payroll", "Notes"]);
  assert.deepEqual(data.sheets[0]!.headers, ["Employee", "Salary", "Dept"]);
  assert.equal(data.sheets[0]!.rows[1]!.Salary, "7500");
});

test("docs.read_xlsx honors sheetName + maxRows and reports truncation", async () => {
  const r = await docsReadXlsx.execute({ path: join(tmp, "payroll.xlsx"), sheetName: "Payroll", maxRows: 1 }, { db: {}, userId: "t" });
  assert.equal(r.ok, true);
  const data = r.data as { sheets: Array<{ rowCount: number; truncated: boolean }> };
  assert.equal(data.sheets.length, 1);
  assert.equal(data.sheets[0]!.rowCount, 1);
  assert.equal(data.sheets[0]!.truncated, true);
});

test("docs.read_xlsx fails cleanly on a missing sheet and a non-spreadsheet", async () => {
  const r = await docsReadXlsx.execute({ path: join(tmp, "payroll.xlsx"), sheetName: "Nope" }, { db: {}, userId: "t" });
  assert.equal(r.ok, false);
  assert.match((r as { summary?: string }).summary ?? "", /Available: Payroll, Notes/);

  const txt = join(tmp, "plain.txt");
  writeFileSync(txt, "not a spreadsheet");
  const r2 = await docsReadXlsx.execute({ path: txt }, { db: {}, userId: "t" });
  assert.equal(r2.ok, false);
});

test("docs.read_pdf fails cleanly on a non-PDF and a fake PDF (no fake success)", async () => {
  const r = await docsReadPdf.execute({ path: join(tmp, "payroll.xlsx") }, { db: {}, userId: "t" });
  assert.equal(r.ok, false);
  assert.match((r as { summary?: string }).summary ?? "", /Not a PDF/);

  const fake = join(tmp, "broken.pdf");
  writeFileSync(fake, "%PDF-1.4 this is not really a pdf body");
  const r2 = await docsReadPdf.execute({ path: fake }, { db: {}, userId: "t" });
  assert.equal(r2.ok, false);
  assert.match((r2 as { summary?: string }).summary ?? "", /parse|extract/i);
});

// ── Always-allowed open whitelist ────────────────────────────────────────
test("normalizeTarget reduces URLs and app names consistently", () => {
  assert.equal(normalizeTarget("https://www.youtube.com/watch?v=x"), "youtube.com");
  assert.equal(normalizeTarget("YouTube.COM"), "youtube.com");
  assert.equal(normalizeTarget("chrome.exe"), "chrome");
  assert.equal(normalizeTarget("  Notepad "), "notepad");
});

test("whitelisted targets match hostname suffixes; others do not", () => {
  const pe = new PermissionEngine();
  pe.setAlwaysAllowed(["youtube.com", "github.com", "notepad"]);
  assert.equal(pe.isAlwaysAllowed("https://www.youtube.com/feed"), true);
  assert.equal(pe.isAlwaysAllowed("https://music.youtube.com"), true);
  assert.equal(pe.isAlwaysAllowed("https://youtube.com.evil.io"), false);
  assert.equal(pe.isAlwaysAllowed("github.com"), true);
  assert.equal(pe.isAlwaysAllowed("notepad.exe"), true);
  assert.equal(pe.isAlwaysAllowed("https://evil-youtube.com"), false);
  assert.equal(pe.listAlwaysAllowed().length, 3);
});
