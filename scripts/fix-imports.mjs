// One-shot codemod: rewrite relative .js import specifiers to .ts so Node
// can execute TypeScript sources directly (verbatimModuleSyntax style).
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = ["packages", "apps", "tests"];
const changed = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "dist" || name === ".freebuff") continue;
      walk(p);
    } else if (name.endsWith(".ts")) {
      const src = readFileSync(p, "utf8");
      const next = src.replace(/(from\s+["'])(\.[^"']*?)\.js(["'])/g, "$1$2.ts$3");
      if (next !== src) {
        writeFileSync(p, next);
        changed.push(p);
      }
    }
  }
}

for (const r of roots) walk(r);
console.log(`rewrote imports in ${changed.length} files:`);
for (const c of changed) console.log("  " + c);
