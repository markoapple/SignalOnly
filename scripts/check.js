// Lightweight syntax check for every JavaScript file in the extension.
// Avoids needing a real bundler. Runs `node --check` on each .js file.
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import process from "node:process";

const SKIP_DIRS = new Set(["node_modules", ".git", "assets", "docs"]);
const SKIP_FILES = new Set([]);

const rootDir = process.cwd();
const files = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (!SKIP_DIRS.has(entry)) walk(full);
      continue;
    }
    if (extname(entry) !== ".js") continue;
    if (SKIP_FILES.has(entry)) continue;
    files.push(full);
  }
}

walk(rootDir);

let failed = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    failed += 1;
    process.stderr.write(`FAIL ${file}\n${result.stderr}\n`);
  } else {
    process.stdout.write(`ok   ${file}\n`);
  }
}

if (failed > 0) {
  process.stderr.write(`\n${failed} file(s) failed syntax check.\n`);
  process.exit(1);
}
process.stdout.write(`\nAll ${files.length} JavaScript files passed syntax check.\n`);
