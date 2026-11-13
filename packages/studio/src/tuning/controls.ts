import type { z } from "zod";
import type { HarnessPuzzle } from "../puzzles.js";
import { getPath, leaves } from "../scenario/overrides.js";
import { GROUP_IDS, type GroupId, type TuningGroups } from "./groups.js";

/**
 * How a number is tuned (DESIGN.md 3.14): a slider for a range, a stepper for a small whole
 * number, a curve for a list of numbers, a switch, a choice, and plain JSON for the few keys that
 * are none of those (a deck's layout, a fight's line-up).
 */
export type ControlKind = "slider" | "stepper" | "curve" | "toggle" | "choice" | "text" | "json";

/** A unit read from a key's name. Its label is `studio.unit.<unit>` in the message table. */
export type Unit = "permille" | "percent" | "points" | "moves" | "ticks" | "ms" | "seconds";

export interface Control {
  /** The key in the content file: `config.specialChancePerMille.charge`, `roundSeconds`. */
  readonly key: string;
  /** The last part of the key, and the parts before it when the key sits in a branch. */
  readonly name: string;
  readonly branch: string | null;
  readonly kind: ControlKind;
  readonly shipped: unknown;
  /** One line from beside the wire schema; a branch's line stands for its keys that have none. */
  readonly description: string | null;
  readonly unit: Unit | null;
  /** The wire schema's own bounds, where it has them. The panel never offers past them. */
  readonly min: number | null;
  readonly max: number | null;
  readonly integer: boolean;
  /** For a choice: what the schema allows. */
  readonly options: readonly (string | number)[];
  /** Shown, not tuned: the boards' animation timing is built on it. */
  readonly locked: boolean;
}

export interface ControlGroup {
  readonly id: GroupId | "other";
  readonly controls: readonly Control[];
}

type Schema = z.ZodType & { def: { type: string; innerType?: Schema; options?: Schema[]; values?: unknown[] }; shape?: Record<string, Schema>; element?: Schema; options?: unknown[] };

/** A schema with its `default` and `optional` wrappers taken off. */
function bare(schema: Schema): Schema {
  let s = schema;
  while ((s.def.type === "default" || s.def.type === "optional" || s.def.type === "nullable") && s.def.innerType) s = s.def.innerType;
  return s;
}

function schemaAt(root: Schema, path: string): { schema: Schema | null; description: string | null } {
  let s: Schema | null = root;
  let description: string | null = null;
  for (const part of path.split(".")) {
    const next: Schema | undefined = s ? bare(s).shape?.[part] : undefined;
    if (!next) return { schema: null, description };
    description = next.description ?? description;
    s = next;
  }
  return { schema: s, description };
}

const UNITS: ReadonlyArray<readonly [RegExp, Unit]> = [
  [/per ?mille$|permille$/i, "permille"],
  [/percent(s)?$/i, "percent"],
  [/(points|penalty|bonus)$/i, "points"],
  [/moves$/i, "moves"],
  [/ticks(min|max)?$/i, "ticks"],
  [/ms$/i, "ms"],
  [/seconds$/i, "seconds"],
];

/** The unit a key's name says it is in. A branch names the unit for its keys (`specialChancePerMille.charge`). */
export function unitOf(key: string): Unit | null {
  const parts = key.split(".");
  for (let i = parts.length - 1; i >= 0; i--) {
    for (const [pattern, unit] of UNITS) if (pattern.test(parts[i]!)) return unit;
  }
  return null;
}

/** A whole number small enough to step through: a count of kinds, a width, a grace. */
const SMALL = 12;

function numberKind(shipped: number, integer: boolean): ControlKind {
  return integer && Math.abs(shipped) <= SMALL ? "stepper" : "slider";
}

function finite(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) && Math.abs(n) < Number.MAX_SAFE_INTEGER ? n : null;
}

function control(key: string, shipped: unknown, schema: Schema | null, description: string | null, locked: boolean): Control {
  const dot = key.lastIndexOf(".");
  const head = key.slice(0, dot);
  const base = {
    key,
    name: key.slice(dot + 1),
    branch: head === "config" || dot < 0 ? null : head.replace(/^config\./, ""),
    shipped,
    description,
    unit: unitOf(key),
    min: null as number | null,
    max: null as number | null,
    integer: false,
    options: [] as (string | number)[],
    locked,
  };
  const s = schema ? bare(schema) : null;
  const type = s?.def.type;
  if (typeof shipped === "number") {
    const n = s as unknown as { minValue?: number; maxValue?: number; isInt?: boolean } | null;
    const literals = type === "union" ? (s!.def.options ?? []).flatMap((o) => bare(o).def.values ?? []) : [];
    if (literals.length > 0 && literals.every((v) => typeof v === "number")) return { ...base, kind: "choice", options: literals as number[], integer: true };
    const min = finite(n?.minValue);
    const max = finite(n?.maxValue);
    const integer = n?.isInt ?? Number.isInteger(shipped);
    return { ...base, kind: numberKind(shipped, integer), min, max, integer };
  }
  if (typeof shipped === "boolean") return { ...base, kind: "toggle" };
  if (typeof shipped === "string") {
    if (type === "enum") return { ...base, kind: "choice", options: (s!.options ?? []) as string[] };
    return { ...base, kind: "text" };
  }
  if (Array.isArray(shipped) && shipped.length > 0 && shipped.every((v) => typeof v === "number")) {
    const el = s?.element ? (bare(s.element) as unknown as { minValue?: number; maxValue?: number; isInt?: boolean }) : null;
    return { ...base, kind: "curve", min: finite(el?.minValue), max: finite(el?.maxValue), integer: el?.isInt ?? true };
  }
  return { ...base, kind: "json" };
}

/**
 * Every control of a puzzle's config, in the sections its groups file puts them in (tuning/groups).
 * Built from the content file (which keys there are, and their shipped values) and bounded by the
 * wire schema (what each may be), so a new key in content is a new control with no code here. A
 * key the groups file forgot lands in `other`; test/tuning.test.ts keeps that empty.
 */
export function configControls<S, M, C>(puzzle: HarnessPuzzle<S, M, C>, groups: TuningGroups): ControlGroup[] {
  const root = puzzle.configSchema as Schema;
  const all = leaves(puzzle.config).map(({ path, value }) => {
    const { schema, description } = schemaAt(root, path);
    return { path, control: control(`config.${path}`, value, schema, description, puzzle.locked.includes(path.split(".")[0]!)) };
  });
  const taken = new Set<string>();
  const out: ControlGroup[] = [];
  for (const id of GROUP_IDS) {
    const controls: Control[] = [];
    for (const entry of groups[id] ?? []) {
      for (const c of all) {
        if ((c.path === entry || c.path.startsWith(`${entry}.`)) && !taken.has(c.path)) {
          taken.add(c.path);
          controls.push(c.control);
        }
      }
    }
    if (controls.length) out.push({ id, controls });
  }
  const rest = all.filter((c) => !taken.has(c.path)).map((c) => c.control);
  if (rest.length) out.push({ id: "other", controls: rest });
  return out;
}

/** The controls for the numbers beside `config`: the round's length and the live tier's window. Thresholds have a control of their own. */
export function roundControls(shipped: { roundSeconds: number; paceSeconds: number }, bounds: { roundSeconds: [number, number]; paceSeconds: [number, number] }): Control[] {
  const one = (key: "roundSeconds" | "paceSeconds", kind: ControlKind): Control => ({
    key,
    name: key,
    branch: null,
    kind,
    shipped: shipped[key],
    description: null,
    unit: "seconds",
    min: bounds[key][0],
    max: bounds[key][1],
    integer: true,
    options: [],
    locked: false,
  });
  return [one("roundSeconds", "slider"), one("paceSeconds", "slider")];
}

/** Where a slider runs: from the schema's floor to a few times the shipped value, never past the schema, always reaching the value it shows. */
export function sliderRange(c: Control, value: number): { min: number; max: number } {
  const shipped = typeof c.shipped === "number" ? c.shipped : value;
  const min = Math.min(c.min ?? 0, value, shipped);
  const reach = Math.max(shipped * 3, 10);
  const pow = 10 ** Math.max(0, Math.floor(Math.log10(reach)) - 1);
  const nice = Math.ceil(reach / pow) * pow;
  return { min, max: Math.max(Math.min(c.max ?? Infinity, nice), value, shipped) };
}

/** The value a config key has in a config, by its control's key. */
export function valueAt(config: unknown, key: string): unknown {
  return getPath(config, key.replace(/^config\./, ""));
}
