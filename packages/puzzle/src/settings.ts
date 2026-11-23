/**
 * A round's settings (docs/puzzles/DOMAIN.md, "Settings"): a value for each of the puzzle's settings
 * and the set of layers that are on. Every host holds them to their bounds and relations here before
 * a round starts, so no two hosts can disagree on what is refused.
 */
import { layerOf, stageOf, type PuzzleDoc, type SettingDecl, type SettingValue, type Sized } from "./document.js";
import { Refused } from "./errors.js";

export interface Settings {
  /** The layers on, in the ladder's order. */
  readonly layers: readonly string[];
  /** The stage those layers make. */
  readonly stage: string;
  /** Every setting that exists in this round, and its value. A setting a layer brings is here only while that layer is on. */
  readonly values: Readonly<Record<string, SettingValue>>;
}

export interface SettingsAsk {
  /** The stage to deal. The whole puzzle, `full`, when absent. */
  readonly stage?: string;
  /** Or the layers on, which must be those of one stage. */
  readonly layers?: readonly string[];
  /** Values that differ from the defaults. A value for a setting whose layer is off is dropped: the setting does not exist. */
  readonly values?: Readonly<Record<string, SettingValue>>;
}

const whole = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

export function valueProblem(s: SettingDecl, v: unknown, sized: (x: Sized) => number | null): string | null {
  const inBounds = (n: number): boolean => (s.min === undefined || n >= s.min) && (s.max === undefined || n <= s.max);
  switch (s.type) {
    case "whole":
    case "percent":
    case "permille":
      if (!whole(v)) return `${s.id} must be a whole number`;
      return inBounds(v) ? null : `${s.id} must be from ${s.min} to ${s.max}`;
    case "flag":
      return typeof v === "boolean" ? null : `${s.id} must be on or off`;
    case "list": {
      if (!Array.isArray(v) || !v.every(whole)) return `${s.id} must be a list of whole numbers`;
      if (!v.every(inBounds)) return `every entry of ${s.id} must be from ${s.min} to ${s.max}`;
      const e = s.entries;
      if (e && "count" in e) {
        const n = sized(e.count);
        if (n !== null && v.length !== n) return `${s.id} must have ${n} entries`;
      } else if (e && (v.length < e.least || v.length > e.most)) return `${s.id} must have from ${e.least} to ${e.most} entries`;
      return null;
    }
    case "maps":
      return Array.isArray(v) && v.length > 0 ? null : `${s.id} must be a list of maps`;
  }
}

/** The settings a round starts from, or `Refused` with every reason they cannot be. */
export function resolveSettings(doc: PuzzleDoc, ask: SettingsAsk = {}): Settings {
  const problems: string[] = [];
  const stage = ask.layers ? stageOf(doc, ask.layers) : (ask.stage ?? "full");
  const ladderLayers: string[] = [];
  let found = false;
  for (const s of doc.ladder) {
    if (found) break;
    ladderLayers.push(...s.adds);
    found = s.stage === stage;
  }
  if (stage === null || !found) throw new Refused("settings", [ask.layers ? "the layers on are not those of any stage" : `no stage ${String(ask.stage)}`]);
  const on = new Set(ladderLayers);

  const known = new Map(doc.settings.map((s) => [s.id, s]));
  for (const id of Object.keys(ask.values ?? {})) if (!known.has(id)) problems.push(`no setting ${id}`);

  const values: Record<string, SettingValue> = {};
  for (const s of doc.settings) {
    const layer = layerOf(doc, "settings", s.id);
    if (layer !== null && !on.has(layer)) continue;
    values[s.id] = ask.values?.[s.id] ?? s.default;
  }
  const sized = (x: Sized): number | null => (typeof x === "number" ? x : typeof values[x] === "number" ? (values[x] as number) : null);
  for (const s of doc.settings) {
    if (!(s.id in values)) continue;
    const p = valueProblem(s, values[s.id], sized);
    if (p) problems.push(p);
  }
  if (problems.length === 0) {
    for (const r of doc.relations) {
      const a = values[r.a];
      // A relation with a setting that a layer brings holds only while that layer is on.
      if (a === undefined) continue;
      if (r.is === "ascending") {
        if (Array.isArray(a) && a.some((x, i) => i > 0 && (x as number) < (a[i - 1] as number))) problems.push(`${r.a} must never fall`);
        continue;
      }
      if (r.is === "fits") {
        const cells = boardCells(doc, sized);
        if (typeof a === "number" && cells !== null && a > cells) problems.push(`${r.a} must fit the board's ${cells} cells`);
        continue;
      }
      const b = r.b === undefined ? undefined : values[r.b];
      if (typeof a !== "number" || typeof b !== "number") continue;
      if (r.is === "at-most" && a > b) problems.push(`${r.a} must be at most ${r.b}`);
      if (r.is === "below" && a >= b) problems.push(`${r.a} must be below ${r.b}`);
    }
  }
  if (problems.length > 0) throw new Refused("settings", problems);
  return { layers: ladderLayers, stage, values };
}

function boardCells(doc: PuzzleDoc, sized: (x: Sized) => number | null): number | null {
  const b = doc.board;
  const [w, h] = b.shape === "grid" ? [b.width, b.height] : [b.sectors, b.rings];
  if (w === undefined || h === undefined) return null;
  const x = sized(w);
  const y = sized(h);
  return x === null || y === null ? null : x * y;
}

/** Reads a round's settings by id, and fails loudly on one the round does not have: the rules may read only what exists. */
export class SettingsReader {
  constructor(
    readonly settings: Settings,
    private readonly touched?: (kind: string, id: string) => void,
  ) {}

  has(layer: string): boolean {
    return this.settings.layers.includes(layer);
  }

  private get(id: string): SettingValue {
    const v = this.settings.values[id];
    if (v === undefined) throw new Error(`the rules read ${id}, a setting this round does not have`);
    this.touched?.("settings", id);
    return v;
  }

  number(id: string): number {
    const v = this.get(id);
    if (typeof v !== "number") throw new Error(`${id} is not a number`);
    return v;
  }

  flag(id: string): boolean {
    const v = this.get(id);
    if (typeof v !== "boolean") throw new Error(`${id} is not a flag`);
    return v;
  }

  list(id: string): readonly number[] {
    const v = this.get(id);
    if (!Array.isArray(v)) throw new Error(`${id} is not a list`);
    return v as readonly number[];
  }

  /** A number, or the setting that holds it. */
  sized(x: Sized): number {
    return typeof x === "number" ? x : this.number(x);
  }
}
