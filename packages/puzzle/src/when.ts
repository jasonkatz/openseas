// A condition: one short comparison over an event's fields and the puzzle's settings, and nothing
// more (ADR 0092, rung 2). It is data, so a tuning panel can show it and anyone can read it.
//
//   <left> <op> <right>     op is one of  >=  >  <=  <  ==  !=
//
// Each side is a whole number, a setting's id, or a field of the event. A field that holds places
// may be followed by `.length`, and counts as its length either way.
import type { Settings } from "./types.js";

const SHAPE = /^\s*([A-Za-z_]\w*(?:\.length)?|-?\d+)\s*(>=|<=|==|!=|>|<)\s*([A-Za-z_]\w*(?:\.length)?|-?\d+)\s*$/;

/** What is wrong with a condition as written, or null. Asked once, when a puzzle is put together. */
export function whenProblem(when: string, fields: readonly string[], settings: readonly string[]): string | null {
  const m = SHAPE.exec(when);
  if (!m) return `"${when}" is not a comparison of two values`;
  for (const side of [m[1]!, m[3]!]) {
    if (/^-?\d+$/.test(side)) continue;
    const name = side.replace(/\.length$/, "");
    if (!fields.includes(name) && !settings.includes(name)) return `"${when}" names ${name}, which is neither a field of the event nor a setting`;
  }
  return null;
}

/** Whether an event meets a condition. A field is looked for before a setting of the same name. */
export function holds(when: string, fields: Readonly<Record<string, unknown>>, settings: Settings): boolean {
  const m = SHAPE.exec(when);
  if (!m) throw new Error(`"${when}" is not a comparison of two values`);
  const value = (side: string): number => {
    if (/^-?\d+$/.test(side)) return Number(side);
    const name = side.replace(/\.length$/, "");
    const v = name in fields ? fields[name] : settings[name];
    if (Array.isArray(v)) return v.length;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v !== "number") throw new Error(`"${when}": ${name} has no number to compare`);
    return v;
  };
  const [a, b] = [value(m[1]!), value(m[3]!)];
  switch (m[2]) {
    case ">=": return a >= b;
    case ">": return a > b;
    case "<=": return a <= b;
    case "<": return a < b;
    case "==": return a === b;
    default: return a !== b;
  }
}
