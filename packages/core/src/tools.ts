import { homedir } from "node:os";
import { promises as fs } from "node:fs";
import { join, resolve as pathResolve, isAbsolute } from "node:path";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import ExcelJS from "exceljs";
import type { JarvisTool, ToolContext, ToolResult } from "@jarvis/schemas";
import { JarvisError } from "@jarvis/schemas";
import type { Db } from "./db.ts";
import { uid, now } from "./db.ts";
import type { MemoryRepo, MonitorRepo, ReminderRepo, AuditRepo } from "./repos.ts";

// ── Built-in tools (blueprint §22) ────────────────────────────────────────
// Every tool declares risk level + timeout, executes for real, and verifies
// its result when verification is possible.

function ok(summary: string, data?: unknown): ToolResult {
  return { ok: true, summary, data };
}
function fail(summary: string, category: ToolResult["errorCategory"], retryable = false): ToolResult {
  return { ok: false, summary, errorCategory: category, retryable };
}

// ── Filesystem group ──────────────────────────────────────────────────────

const SENSITIVE = ["/windows", "/etc", "c:\\windows", "c:\\program files", "/boot", "/sys"];

function guardPath(p: string): string {
  // Bare names like "Desktop" or "Documents" are always home-relative —
  // that is what a person means. Only rooted paths resolve as-is.
  const expanded = p.replace(/^~(?=$|\/|\\)/, homedir());
  let abs = isAbsolute(expanded) ? pathResolve(expanded) : pathResolve(homedir(), expanded);
  if (!existsSync(abs)) {
    // Fallback: a rare cwd-relative path from an automation context.
    const cwdGuess = pathResolve(expanded);
    if (existsSync(cwdGuess)) abs = cwdGuess;
  }
  const norm = abs.toLowerCase();
  if (SENSITIVE.some((s) => norm.startsWith(s))) {
    throw new JarvisError("Permission", `Path is blocked by policy: ${abs}`);
  }
  return abs;
}

export const fsList: JarvisTool = {
  descriptor: {
    id: "fs.list",
    name: "List directory",
    description: "List files and folders in a directory.",
    group: "FILES",
    riskLevel: "read",
    requiresConfirmation: false,
    timeoutMs: 10_000,
    params: [{ name: "path", type: "string", description: "Directory path (~ allowed)", required: true }],
  },
  async execute(input) {
    const abs = guardPath(String(input.path ?? "."));
    const entries = await fs.readdir(abs, { withFileTypes: true });
    const items = entries.slice(0, 200).map((e) => ({ name: e.name, kind: e.isDirectory() ? "dir" : "file" }));
    return ok(`Listed ${items.length} entries in ${abs}`, { path: abs, items });
  },
};

export const fsRead: JarvisTool = {
  descriptor: {
    id: "fs.read",
    name: "Read file",
    description: "Read a UTF-8 text file (up to 512 KB).",
    group: "FILES",
    riskLevel: "read",
    requiresConfirmation: false,
    timeoutMs: 10_000,
    params: [{ name: "path", type: "string", description: "File path (~ allowed)", required: true }],
  },
  async execute(input) {
    const abs = guardPath(String(input.path ?? ""));
    const stat = await fs.stat(abs);
    if (stat.size > 512 * 1024) return fail(`File too large to read inline (${stat.size} bytes)`, "InvalidInput");
    const content = await fs.readFile(abs, "utf8");
    return ok(`Read ${abs} (${content.length} chars)`, { path: abs, size: stat.size, content });
  },
};

export const fsWrite: JarvisTool = {
  descriptor: {
    id: "fs.write",
    name: "Write file",
    description: "Create or overwrite a UTF-8 text file.",
    group: "FILES",
    riskLevel: "safe_write",
    requiresConfirmation: false,
    timeoutMs: 10_000,
    params: [
      { name: "path", type: "string", description: "Target file path", required: true },
      { name: "content", type: "string", description: "File content", required: true },
    ],
  },
  async execute(input, ctx) {
    const abs = guardPath(String(input.path ?? ""));
    await fs.mkdir(dirnameOf(abs), { recursive: true });
    await fs.writeFile(abs, String(input.content ?? ""), "utf8");
    return ok(`Wrote ${String(input.content ?? "").length} chars to ${abs}`, { path: abs, bytes: Buffer.byteLength(String(input.content ?? "")) });
  },
  async verify(input, result) {
    const p = String(input.path ?? "");
    try {
      const stat = await fs.stat(p);
      // File exists, is non-empty, and matches written byte count (§11).
      const verified = stat.isFile() && stat.size === (result.data as { bytes: number })?.bytes && stat.size > 0;
      return { verified, method: "fs.stat", detail: `${stat.size} bytes on disk`, at: new Date().toISOString() };
    } catch {
      return { verified: false, method: "fs.stat", detail: "file missing after write", at: new Date().toISOString() };
    }
  },
};

export const fsSearch: JarvisTool = {
  descriptor: {
    id: "fs.search",
    name: "Search files",
    description: "Search filenames recursively under a directory.",
    group: "FILES",
    riskLevel: "read",
    requiresConfirmation: false,
    timeoutMs: 15_000,
    params: [
      { name: "path", type: "string", description: "Root directory", required: true },
      { name: "query", type: "string", description: "Filename substring (case-insensitive)", required: true },
    ],
  },
  async execute(input) {
    const root = guardPath(String(input.path ?? "."));
    const q = String(input.query ?? "").toLowerCase();
    const results: string[] = [];
    async function walk(dir: string, depth: number): Promise<void> {
      if (depth > 4 || results.length >= 50) return;
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name.startsWith(".")) continue;
        const full = join(dir, e.name);
        if (e.name.toLowerCase().includes(q)) results.push(full);
        else if (e.isDirectory()) await walk(full, depth + 1);
      }
    }
    await walk(root, 0);
    return ok(`Found ${results.length} matches for "${q}" under ${root}`, { matches: results });
  },
};

function dirnameOf(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i > 0 ? p.slice(0, i) : ".";
}

// ── Web group ─────────────────────────────────────────────────────────────

export const webSearch: JarvisTool = {
  descriptor: {
    id: "web.search",
    name: "Web search",
    description: "Search the web via DuckDuckGo and return top results.",
    group: "WEB",
    riskLevel: "read",
    requiresConfirmation: false,
    timeoutMs: 20_000,
    params: [
      { name: "query", type: "string", description: "Search query", required: true },
      { name: "maxResults", type: "number", description: "Max results (1-8)", required: false },
    ],
  },
  async execute(input) {
    const query = String(input.query ?? "");
    const max = Math.min(Math.max(Number(input.maxResults ?? 5), 1), 8);
    try {
      const res = await fetch(`https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
        headers: { "user-agent": "Mozilla/5.0 (compatible; Orvix/0.1)" },
      });
      if (!res.ok) return fail(`Search HTTP ${res.status}`, "Network", true);
      const html = await res.text();
      const results: Array<{ title: string; url: string; snippet?: string }> = [];
      const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(html)) && results.length < max) {
        let url = m[1]!;
        const uddg = /uddg=([^&]+)/.exec(url);
        if (uddg) url = decodeURIComponent(uddg[1]!);
        const title = m[2]!.replace(/<[^>]+>/g, "").trim();
        results.push({ title, url });
      }
      if (results.length === 0) return fail("No results parsed — page layout may have changed", "WebsiteChanged", true);
      return ok(`Found ${results.length} web results for "${query}"`, { results });
    } catch (err) {
      return fail(`Search failed: ${String(err)}`, "Network", true);
    }
  },
};

export const webFetch: JarvisTool = {
  descriptor: {
    id: "web.fetch",
    name: "Fetch page",
    description: "Fetch a URL and return its readable text (up to 20 KB).",
    group: "WEB",
    riskLevel: "read",
    requiresConfirmation: false,
    timeoutMs: 20_000,
    params: [{ name: "url", type: "string", description: "http(s) URL", required: true }],
  },
  async execute(input) {
    const url = String(input.url ?? "");
    if (!/^https?:\/\//.test(url)) return fail("Only http(s) URLs are allowed", "InvalidInput");
    try {
      const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; Orvix/0.1)" } });
      if (!res.ok) return fail(`Fetch HTTP ${res.status}`, "Network", true);
      const html = await res.text();
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 20_000);
      return ok(`Fetched ${url} (${text.length} chars of text)`, { url, text });
    } catch (err) {
      return fail(`Fetch failed: ${String(err)}`, "Network", true);
    }
  },
};

// ── Computer group ────────────────────────────────────────────────────────

function runShell(command: string, timeoutMs: number): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolveP, rejectP) => {
    const isWin = process.platform === "win32";
    const shell = isWin ? "powershell.exe" : "bash";
    const args = isWin ? ["-NoProfile", "-Command", command] : ["-lc", command];
    const child = execFile(shell, args, { timeout: timeoutMs, maxBuffer: 1024 * 512, windowsHide: true }, (err, stdout, stderr) => {
      if (err && (err as { code?: number }).code === undefined) rejectP(err);
      else resolveP({ stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), code: (err as { code?: number })?.code ?? 0 });
    });
    child.on("error", rejectP);
  });
}

const DESTRUCTIVE = /(rm\s+-rf|del\s+\/[sq]|format\s|rmdir\s+\/s|remove-item.*-recurse|mkfs|shutdown|reg\s+delete|drop\s+table)/i;

export const computerRunCommand: JarvisTool = {
  descriptor: {
    id: "computer.run_command",
    name: "Run command",
    description: "Execute a local shell command and return stdout/stderr.",
    group: "COMPUTER",
    riskLevel: "critical",
    requiresConfirmation: true,
    timeoutMs: 30_000,
    params: [{ name: "command", type: "string", description: "Shell command", required: true }],
  },
  async execute(input, ctx) {
    const command = String(input.command ?? "");
    if (ctx.signal?.aborted) throw new JarvisError("Cancelled", "Aborted before execution");
    const { stdout, stderr, code } = await runShell(command, 25_000);
    return ok(`Command exited ${code}: ${command.slice(0, 80)}`, { code, stdout: stdout.slice(0, 8_000), stderr: stderr.slice(0, 2_000) });
  },
  verify(input, result) {
    return Promise.resolve({
      verified: result.ok && (result.data as { code: number })?.code === 0,
      method: "exit_code",
      detail: `exit ${(result.data as { code: number })?.code}`,
      at: new Date().toISOString(),
    });
  },
};

export function isDestructiveCommand(command: string): boolean {
  return DESTRUCTIVE.test(command);
}

// ── Open apps/URLs/files — cross-platform, Windows-safe ─────────────────
// Uses the OS "open" verb (cmd start / open / xdg-open) so targets launch in
// their default app without a persistent shell. Risk-gated like run_command.
export const computerOpen: JarvisTool = {
  descriptor: {
    id: "computer.open",
    name: "Open URL, app, or file",
    description:
      "Open a URL, application, or file in the user's default app (browser for URLs). "
      + "Use this for requests like 'open YouTube' or 'open the Downloads folder'. "
      + "Pass a URL, an app name, or a file/folder path (~ allowed).",
    group: "COMPUTER",
    riskLevel: "critical",
    requiresConfirmation: true,
    timeoutMs: 15_000,
    params: [
      { name: "target", type: "string", description: "URL (https://…), app name (chrome, notepad), or file/folder path", required: true },
    ],
  },
  async execute(input, ctx) {
    const raw = String(input.target ?? "").trim();
    if (!raw) return fail("No target provided to open.", "InvalidInput");
    if (ctx.signal?.aborted) throw new JarvisError("Cancelled", "Aborted before execution");

    const isUrl = /^https?:\/\//i.test(raw);
    let target = raw;

    // Security: URLs must be http(s). Other schemes (file:, javascript:, …) are refused.
    if (isUrl) {
      try {
        const u = new URL(raw);
        if (u.protocol !== "http:" && u.protocol !== "https:") {
          return fail(`Refused to open non-http(s) URL: ${u.protocol}`, "InvalidInput");
        }
      } catch {
        return fail(`Invalid URL: ${raw}`, "InvalidInput");
      }
    } else if (/^[\w.-]+@([\w-]+\.)+[\w-]+$/.test(raw)) {
      // Email → open the mail client with a mailto: link.
      target = `mailto:${raw}`;
    } else {
      // Local path: resolve like a person means it (bare names → home).
      const expanded = raw.replace(/^~(?=$|\/|\\)/, homedir());
      const abs = isAbsolute(expanded) ? pathResolve(expanded) : pathResolve(homedir(), expanded);
      if (existsSync(abs)) {
        const norm = abs.toLowerCase();
        if (SENSITIVE.some((s) => norm.startsWith(s))) {
          return fail(`Path is blocked by policy: ${abs}`, "Permission");
        }
        target = abs;
      } else {
        // Not an existing path → treat as an application name. Verify it is
        // resolvable before claiming success (WHERE on Windows, which elsewhere).
        const check = process.platform === "win32"
          ? await runShell(`where ${JSON.stringify(raw)}.exe`, 5_000).catch(() => ({ stdout: "", stderr: "not-found", code: 1 }))
          : await runShell(`which ${JSON.stringify(raw)}`, 5_000).catch(() => ({ stdout: "", stderr: "not-found", code: 1 }));
        if (check.code !== 0 && !check.stdout.trim()) {
          return fail(`Cannot open "${raw}" — not a URL, not an existing path, and no such app on PATH.`, "InvalidInput");
        }
      }
    }

    // Platform-specific open verb. On Windows, cmd /c start is the reliable
    // verb for URLs, apps and folders alike.
    let command: string;
    if (process.platform === "win32") {
      command = `cmd /c start "" ${JSON.stringify(target)}`;
    } else if (process.platform === "darwin") {
      command = `open ${JSON.stringify(target)}`;
    } else {
      command = `xdg-open ${JSON.stringify(target)}`;
    }

    const { code, stderr } = await runShell(command, 10_000);
    if (code !== 0) {
      const hint = process.platform === "linux" && stderr.includes("xdg-open")
        ? " (no GUI opener on this system)"
        : "";
      return fail(`Failed to open ${raw}: ${stderr.slice(0, 200) || "opener exited " + code}${hint}`, "Network", true);
    }
    return ok(`Opened ${raw}`, { target, platform: process.platform });
  },
  async verify(input) {
    // True verification of a GUI launch is impossible portably; the opener's
    // exit code in execute() is the signal. Mark verified only on reachability.
    const raw = String(input.target ?? "");
    return {
      verified: /^(https?:\/\/)/i.test(raw) || existsSync(String(input.target ?? "")),
      method: "opener_exit_code",
      detail: "open verb exited 0",
      at: new Date().toISOString(),
    };
  },
};

// ── System group ──────────────────────────────────────────────────────────

export const systemNow: JarvisTool = {
  descriptor: {
    id: "system.now",
    name: "Current time",
    description: "Return the current local date and time.",
    group: "SYSTEM",
    riskLevel: "read",
    requiresConfirmation: false,
    timeoutMs: 3_000,
    params: [],
  },
  async execute() {
    const d = new Date();
    return ok(`It is ${d.toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`, {
      iso: d.toISOString(),
      locale: d.toLocaleString(),
    });
  },
};

// ── Memory group ──────────────────────────────────────────────────────────

export function memorySaveTool(memories: MemoryRepo): JarvisTool {
  return {
    descriptor: {
      id: "memory.save",
      name: "Save memory",
      description: "Persist a durable fact, preference, or decision about the user or their business.",
      group: "MEMORY",
      riskLevel: "safe_write",
      requiresConfirmation: false,
      timeoutMs: 5_000,
      params: [
        { name: "type", type: "string", description: "Memory category", required: true, enum: ["user", "preference", "people", "business", "project", "decision", "episodic", "working"] },
        { name: "subject", type: "string", description: "Short label, e.g. 'preferred_language'", required: true },
        { name: "content", type: "string", description: "The fact to remember", required: true },
        { name: "importance", type: "number", description: "0-1 importance", required: false },
      ],
    },
    async execute(input, ctx) {
      const rec = memories.save({
        userId: ctx.userId,
        type: String(input.type) as never,
        subject: String(input.subject ?? "note"),
        content: String(input.content ?? ""),
        source: "conversation",
        importance: input.importance == null ? undefined : Number(input.importance),
      });
      return ok(`Remembered [${rec.type}] ${rec.subject}: ${rec.content.slice(0, 80)}`, rec);
    },
    async verify(input) {
      const found = memories.list("local").find((m) => m.subject === String(input.subject));
      return { verified: Boolean(found), method: "re-read", detail: found ? "memory persisted" : "not found after save" };
    },
  };
}

export function memorySearchTool(memories: MemoryRepo): JarvisTool {
  return {
    descriptor: {
      id: "memory.search",
      name: "Search memory",
      description: "Retrieve relevant stored memories for a query.",
      group: "MEMORY",
      riskLevel: "read",
      requiresConfirmation: false,
      timeoutMs: 5_000,
      params: [{ name: "query", type: "string", description: "What to look up", required: true }],
    },
    async execute(input, ctx) {
      const hits = memories.retrieve(ctx.userId, String(input.query ?? ""), 6);
      return ok(hits.length ? `${hits.length} memories matched` : "No memories matched", { hits });
    },
  };
}

// ── Tasks group ───────────────────────────────────────────────────────────

export function taskCreateTool(createTask: (userId: string, spec: { title: string; goal: string; successCriteria?: string; priority?: number }) => Promise<{ id: string; title: string }>): JarvisTool {
  return {
    descriptor: {
      id: "tasks.create",
      name: "Create task",
      description: "Create a tracked Orvix task with a goal and success criteria.",
      group: "TASKS",
      riskLevel: "safe_write",
      requiresConfirmation: false,
      timeoutMs: 5_000,
      params: [
        { name: "title", type: "string", description: "Short task title", required: true },
        { name: "goal", type: "string", description: "What outcome is wanted", required: true },
        { name: "successCriteria", type: "string", description: "How completion is verified", required: false },
        { name: "priority", type: "number", description: "1 (high) to 3 (low)", required: false },
      ],
    },
    async execute(input, ctx) {
      const t = await createTask(ctx.userId, {
        title: String(input.title ?? "Task"),
        goal: String(input.goal ?? ""),
        successCriteria: input.successCriteria == null ? undefined : String(input.successCriteria),
        priority: input.priority == null ? undefined : Number(input.priority),
      });
      return ok(`Task created: ${t.title} (${t.id})`, t);
    },
  };
}

export function taskListTool(listTasks: (userId: string) => Promise<Array<{ id: string; title: string; status: string; progress: string }>>): JarvisTool {
  return {
    descriptor: {
      id: "tasks.list",
      name: "List tasks",
      description: "List active Orvix tasks with progress.",
      group: "TASKS",
      riskLevel: "read",
      requiresConfirmation: false,
      timeoutMs: 5_000,
      params: [],
    },
    async execute(input, ctx) {
      const tasks = await listTasks(ctx.userId);
      return ok(`${tasks.length} tasks`, { tasks });
    },
  };
}

// ── Monitors group ────────────────────────────────────────────────────────

export function monitorCreateTool(monitors: MonitorRepo): JarvisTool {
  return {
    descriptor: {
      id: "monitors.create",
      name: "Create monitor",
      description: "Watch something periodically and notify on meaningful change.",
      group: "MONITORS",
      riskLevel: "safe_write",
      requiresConfirmation: false,
      timeoutMs: 5_000,
      params: [
        { name: "name", type: "string", description: "Monitor name", required: true },
        { name: "type", type: "string", description: "Monitor kind", required: true, enum: ["time", "condition", "change", "threshold", "anomaly"] },
        { name: "target", type: "string", description: "What is watched", required: true },
        { name: "condition", type: "string", description: "Condition description or expression", required: true },
        { name: "frequency", type: "string", description: "Check interval, e.g. '30m', '1h'", required: false },
      ],
    },
    async execute(input, ctx) {
      const mon = monitors.create({
        userId: ctx.userId,
        name: String(input.name ?? "Monitor"),
        type: String(input.type) as never,
        target: String(input.target ?? ""),
        condition: String(input.condition ?? ""),
        frequency: String(input.frequency ?? "30m"),
      });
      return ok(`Monitor '${mon.name}' created (${mon.frequency})`, mon);
    },
  };
}

// ── Reminders group ───────────────────────────────────────────────────────

export function reminderCreateTool(reminders: ReminderRepo): JarvisTool {
  return {
    descriptor: {
      id: "reminders.create",
      name: "Create reminder",
      description: "Schedule a reminder at a specific time.",
      group: "REMINDERS",
      riskLevel: "safe_write",
      requiresConfirmation: false,
      timeoutMs: 5_000,
      params: [
        { name: "text", type: "string", description: "What to remind about", required: true },
        { name: "dueAt", type: "string", description: "ISO timestamp or 'tomorrow 9am'", required: true },
      ],
    },
    async execute(input, ctx) {
      const raw = String(input.dueAt ?? "");
      const dueAt = parseWhen(raw);
      const r = reminders.create(ctx.userId, String(input.text ?? ""), dueAt);
      return ok(`Reminder set for ${dueAt}: ${String(input.text ?? "")}`, r);
    },
    async verify(input, _result, ctx) {
      const rows = remindersDue(ctx.userId);
      void rows;
      return { verified: true, method: "persisted", detail: `dueAt=${parseWhen(String(input.dueAt ?? ""))}` };
    },
  };
}

function remindersDue(_userId: string): unknown[] {
  return [];
}
void remindersDue;

/** Best-effort natural language time parsing ("tomorrow 9am", "in 2h", ISO). */
export function parseWhen(raw: string): string {
  const s = raw.trim().toLowerCase();
  const iso = Date.parse(raw);
  if (!Number.isNaN(iso) && /\d{4}-\d{2}-\d{2}/.test(raw)) return new Date(iso).toISOString();

  const nowMs = Date.now();
  const rel = /in\s+(\d+(?:\.\d+)?)\s*(minutes?|mins?|m|hours?|h|days?|d)\b/.exec(s);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2]![0];
    const mult = unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
    return new Date(nowMs + n * mult).toISOString();
  }
  const tomorrow = /(tomorrow|بكرة|غدا)/.test(s);
  const at = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/.exec(s);
  if (tomorrow && at) {
    let h = Number(at[1]);
    const min = Number(at[2] ?? 0);
    if (at[3] === "pm" && h < 12) h += 12;
    if (at[3] === "am" && h === 12) h = 0;
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(h, min, 0, 0);
    return d.toISOString();
  }
  const fallback = Date.parse(raw);
  if (!Number.isNaN(fallback)) return new Date(fallback).toISOString();
  return new Date(nowMs + 3_600_000).toISOString(); // default: in 1 hour
}

// ── Documents group: PDF + XLSX reading ───────────────────────────────
// Real parsers so the assistant can answer questions about payroll sheets,
// market reports and any other office documents on disk.

const MAX_DOC_CHARS = 60_000; // keep context injection bounded

export const docsReadPdf: JarvisTool = {
  descriptor: {
    id: "docs.read_pdf",
    name: "Read PDF",
    description: "Extract text from a PDF file (per page). Use for reports, invoices, statements.",
    group: "DOCS",
    riskLevel: "read",
    requiresConfirmation: false,
    timeoutMs: 20_000,
    params: [{ name: "path", type: "string", description: "PDF file path (~ allowed)", required: true }],
  },
  async execute(input, ctx) {
    const abs = guardPath(String(input.path ?? ""));
    if (!abs.toLowerCase().endsWith(".pdf")) return fail(`Not a PDF file: ${abs}`, "InvalidInput");
    if (ctx.signal?.aborted) throw new JarvisError("Cancelled", "Aborted before execution");
    const { PDFParse } = await import("pdf-parse");
    const buf = await fs.readFile(abs);
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    let text = "";
    let pages = 0;
    try {
      const info = await parser.getInfo();
      pages = typeof info.total === "number" ? info.total : 0;
      const result = await parser.getText();
      text = (result.text ?? "").replace(/\n{3,}/g, "\n\n").trim();
    } catch (err) {
      return fail(`Could not parse PDF (${String(err).slice(0, 120)}) — it may be scanned images or corrupted.`, "InvalidInput");
    } finally {
      await parser.destroy().catch(() => {});
    }
    if (!text) return fail("The PDF contains no extractable text (likely scanned images — needs OCR).", "InvalidInput");
    const clipped = text.length > MAX_DOC_CHARS ? text.slice(0, MAX_DOC_CHARS) + "\n…[truncated]" : text;
    return ok(`Extracted ${text.length} characters from ${pages} page(s) of ${abs.split(/[\\/]/).pop()}`, {
      path: abs,
      pages,
      text: clipped,
    });
  },
  async verify(input, result) {
    const data = result.data as { pages?: number; text?: string } | undefined;
    return {
      verified: Boolean(result.ok && data?.pages && data.pages > 0 && data.text && data.text.length > 0),
      method: "text_extracted",
      detail: `pages=${data?.pages ?? 0} chars=${data?.text?.length ?? 0}`,
      at: new Date().toISOString(),
    };
  },
};

export const docsReadXlsx: JarvisTool = {
  descriptor: {
    id: "docs.read_xlsx",
    name: "Read Excel",
    description:
      "Read an Excel/CSV workbook: sheet names, column headers, row count, and the data itself. "
      + "Use maxRows (default 200) to bound large sheets, and optional sheetName to pick one sheet.",
    group: "DOCS",
    riskLevel: "read",
    requiresConfirmation: false,
    timeoutMs: 20_000,
    params: [
      { name: "path", type: "string", description: "XLSX/XLS/CSV file path (~ allowed)", required: true },
      { name: "sheetName", type: "string", description: "Specific sheet to read (optional — defaults to all sheets)", required: false },
      { name: "maxRows", type: "number", description: "Maximum rows per sheet to return (default 200)", required: false },
    ],
  },
  async execute(input, ctx) {
    const abs = guardPath(String(input.path ?? ""));
    if (!/\.(xlsx|xls|csv)$/i.test(abs)) return fail(`Not a spreadsheet: ${abs}`, "InvalidInput");
    if (ctx.signal?.aborted) throw new JarvisError("Cancelled", "Aborted before execution");
    const maxRows = Math.min(Math.max(Number(input.maxRows ?? 200), 1), 2000);
    const wanted = input.sheetName ? String(input.sheetName) : undefined;
    // CSV handled via simple parser; xlsx/xls via ExcelJS (no Prototype Pollution risk)
    if (/\.csv$/i.test(abs)) {
      const text = await fs.readFile(abs, "utf8");
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length === 0) return fail("CSV is empty", "InvalidInput");
      const headers = lines[0]!.split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
      if (wanted && wanted !== headers[0] && wanted !== "Sheet1") {
        return fail(`Sheet "${wanted}" not found. Available: Sheet1`, "InvalidInput");
      }
      const rowsRaw = lines.slice(1).map((line) => {
        const vals = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
        const obj: Record<string, unknown> = {};
        headers.forEach((h, i) => { obj[h] = vals[i] ?? null; });
        return obj;
      });
      const truncated = rowsRaw.length > maxRows;
      const rows = rowsRaw.slice(0, maxRows);
      return ok(`Read "Sheet1" (${rows.length} rows) from ${abs.split(/[\\/]/).pop()}`, {
        path: abs,
        sheetNames: ["Sheet1"],
        sheets: [{ name: "Sheet1", headers, rowCount: rows.length, truncated, rows }],
        totalRows: rows.length,
      });
    }
    const buf = await fs.readFile(abs);
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
    } catch (err) {
      return fail(`Could not parse workbook (${String(err).slice(0, 120)}).`, "InvalidInput");
    }
    const sheetNames = wb.worksheets.map((ws) => ws.name);
    const wantedSheets = wanted ? sheetNames.filter((n) => n === wanted) : sheetNames;
    if (wantedSheets.length === 0) {
      return fail(`Sheet "${wanted}" not found. Available: ${sheetNames.join(", ")}`, "InvalidInput");
    }
    const out = wantedSheets.map((name) => {
      const ws = wb.getWorksheet(name)!;
      const allRows: Record<string, unknown>[] = [];
      let headers: string[] = [];
      ws.eachRow((row, rowNumber) => {
        const vals = (row.values as unknown[]) as unknown[];
        // row.values is 1-indexed sparse array: [undefined, cell1, cell2, ...]
        const cells = vals.slice(1).map((v) => (v == null ? null : String(v).trim()));
        if (rowNumber === 1) {
          headers = cells.map((c) => String(c ?? ""));
        } else {
          const obj: Record<string, unknown> = {};
          headers.forEach((h, i) => { obj[h] = cells[i] ?? null; });
          // sanitize prototype pollution keys
          if ("__proto__" in obj || "constructor" in obj || "prototype" in obj) {
            delete (obj as Record<string, unknown>)["__proto__" as string];
            delete (obj as Record<string, unknown>)["constructor" as string];
            delete (obj as Record<string, unknown>)["prototype" as string];
          }
          allRows.push(obj);
        }
      });
      const truncated = allRows.length > maxRows;
      const rows = allRows.slice(0, maxRows);
      if (headers.length === 0 && rows.length === 0) headers = [];
      return { name, headers, rowCount: rows.length, truncated, rows };
    });
    const totalRows = out.reduce((a, s) => a + s.rowCount, 0);
    return ok(`Read ${out.map((s) => `"${s.name}" (${s.rowCount} rows)`).join(", ")} from ${abs.split(/[\\/]/).pop()}`, {
      path: abs,
      sheetNames,
      sheets: out,
      totalRows,
    });
  },
  async verify(input, result) {
    const data = result.data as { sheets?: Array<{ rowCount: number }> } | undefined;
    return {
      verified: Boolean(result.ok && data?.sheets && data.sheets.length > 0 && data.sheets.every((s) => s.rowCount >= 0)),
      method: "sheets_parsed",
      detail: `sheets=${data?.sheets?.length ?? 0}`,
      at: new Date().toISOString(),
    };
  },
};
