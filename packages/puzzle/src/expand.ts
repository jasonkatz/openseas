// Showing a puzzle: nothing a puzzle is made of is hidden behind its parts (ADR 0092).
import { MERGE, type Composed, type PartHooks } from "./puzzle.js";

/** The whole document a puzzle's parts and defaults make, as JSON: what the loop runs. */
export const expand = (p: Composed): string => `${JSON.stringify(p.document, null, 2)}\n`;

/** Which part answers each hook, and in what order. */
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
