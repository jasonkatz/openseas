// Guards rule 1 of CLAUDE.md: the engine is pure. Fails if any engine source file
// references a source of impurity. Run as `pnpm --filter @openseas/engine lint`.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../src", import.meta.url).pathname;
const banned = [
  /\bDate\b/,
  /\bMath\.random\b/,
  /\bsetTimeout\b/,
  /\bsetInterval\b/,
  /\bperformance\.now\b/,
  /\bprocess\./,
  /\bconsole\./,
  /\bfetch\(/,
  /\bimport\s+[^"']*from\s+["'](?!\.)/, // any non-relative import
  /\brequire\(/,
  /\bglobalThis\b/,
  /\bwindow\b/,
];

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".ts")) files.push(p);
  }
};
walk(root);

let failed = false;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  text.split("\n").forEach((line, i) => {
    if (line.trimStart().startsWith("//")) return;
    for (const re of banned) {
      if (re.test(line)) {
        failed = true;
        console.error(`${file}:${i + 1}: impure reference ${re}: ${line.trim()}`);
      }
    }
  });
}
if (failed) process.exit(1);
console.log(`engine purity check passed (${files.length} files)`);
