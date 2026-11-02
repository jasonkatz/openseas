/**
 * Config overrides as dotted paths, e.g. `{ "specialChancePerMille.keg": 60, "maxMoves": 10 }`.
 * A lab scenario is the content config plus a handful of these, which is what a share link and a
 * preset carry. Arrays (Gunnery's `decks` and `bag`) are leaves: replaced whole, never indexed.
 */
export type Overrides = Readonly<Record<string, unknown>>;

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (!isObj(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

/** A deep copy of `base` with every override set. Unknown paths are created; the validator decides whether they are allowed. */
export function applyOverrides<C>(base: C, overrides: Overrides): C {
  const out = structuredClone(base) as unknown as Obj;
  for (const [path, value] of Object.entries(overrides)) {
    const keys = path.split(".");
    let cur: Obj = out;
    for (const key of keys.slice(0, -1)) {
      if (!isObj(cur[key])) cur[key] = {};
      cur = cur[key] as Obj;
    }
    cur[keys[keys.length - 1]!] = structuredClone(value);
  }
  return out as unknown as C;
}

/** Every leaf of a config as a path, in declaration order. Arrays and primitives are leaves. */
export function leaves(obj: unknown, prefix = ""): Array<{ path: string; value: unknown }> {
  if (!isObj(obj)) return [{ path: prefix, value: obj }];
  const out: Array<{ path: string; value: unknown }> = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isObj(value)) out.push(...leaves(value, path));
    else out.push({ path, value });
  }
  return out;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The overrides that turn `base` into `config`: only the leaves that differ. */
export function diffConfig(base: unknown, config: unknown): Overrides {
  const out: Record<string, unknown> = {};
  for (const { path, value } of leaves(config)) {
    if (!same(getPath(base, path), value)) out[path] = value;
  }
  return out;
}

/** Overrides with the ones equal to the base dropped, so a form that was edited back to content leaves no trace. */
export function pruneOverrides(base: unknown, overrides: Overrides): Overrides {
  const out: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(overrides)) if (!same(getPath(base, path), value)) out[path] = value;
  return out;
}
