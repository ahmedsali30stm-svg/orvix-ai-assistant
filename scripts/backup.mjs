#!/usr/bin/env node
// Simple daily backup for .jarvis/jarvis.db (WAL-safe: copies main db + wal)
import { copyFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const dataDir = process.env.JARVIS_DATA_DIR ?? ".jarvis";
const outDir = join(dataDir, "backups");
mkdirSync(outDir, { recursive: true });

const stamp = new Date().toISOString().slice(0, 10);
const src = resolve(dataDir, "jarvis.db");
if (!existsSync(src)) {
  console.log(`no db at ${src} — nothing to backup`);
  process.exit(0);
}
const dest = join(outDir, `jarvis-${stamp}.db`);
try {
  copyFileSync(src, dest);
  // also copy WAL/SHM if present for point-in-time restore hint
  for (const ext of ["-wal", "-shm"]) {
    const s = src + ext;
    if (existsSync(s)) {
      try { copyFileSync(s, dest + ext); } catch {}
    }
  }
  console.log(`backup ok → ${dest}`);
  // retention: keep 7 most recent
  const files = readdirSync(outDir).filter(f => f.startsWith("jarvis-") && f.endsWith(".db")).sort();
  while (files.length > 7) {
    const old = files.shift();
    try { 
      const { unlinkSync } = await import("node:fs");
      unlinkSync(join(outDir, old));
      try { unlinkSync(join(outDir, old + "-wal")); } catch {}
      try { unlinkSync(join(outDir, old + "-shm")); } catch {}
      console.log(`pruned old backup ${old}`);
    } catch {}
  }
  const st = statSync(dest);
  console.log(`size ${(st.size/1024).toFixed(1)} KB`);
} catch (e) {
  console.error("backup failed:", e.message);
  process.exit(1);
}
