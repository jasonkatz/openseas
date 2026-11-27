// THROWAWAY SPIKE. expand: any composed puzzle, written out as the top rung's files.
import { MERGE, type Composed, type PartHooks } from "./puzzle.js";

/** Which part answers each hook, and in what order: the merge, made visible. */
export function explain(p: Composed): string {
  const rows: string[] = [];
  for (const hook of Object.keys(MERGE) as (keyof PartHooks)[]) {
    const who = p.parts.filter((x) => x.hooks[hook]);
    if (who.length === 0) continue;
    const says = (x: (typeof who)[number]): string => (hook === "canMove" || hook === "onMove" ? `${x.name} (${Object.keys(x.hooks[hook]!).join(", ")})` : x.name);
    rows.push(`${hook.padEnd(10)} ${who.map(says).join(", then ")}${who.length > 1 ? `   [${MERGE[hook]}]` : ""}`);
  }
  return rows.join("\n");
}

const call = (x: Composed["parts"][number]): string => `${x.name}(${(x.args ?? []).map((a) => JSON.stringify(a)).join(", ")})`;

/** The puzzle's document in full, and a rules file that names every hook the parts answer. */
export function expand(p: Composed): { document: string; rules: string } {
  const id = p.document.id;
  const names = [...new Set(p.parts.map((x) => x.name))];
  const rules = [
    `// Expanded from ${id}.puzzle.ts. The rules of ${id}, as one flat object of hooks.`,
    `// Which part answers each hook, in order:`,
    ...explain(p).split("\n").map((l) => `//   ${l}`),
    `import { defineRules, mergeHooks, ${names.join(", ")} } from "@openseas/puzzle";`,
    ``,
    `export default defineRules(mergeHooks([${p.parts.map(call).join(", ")}]));`,
    ``,
  ].join("\n");
  return { document: `${JSON.stringify(p.document, null, 2)}\n`, rules };
}
