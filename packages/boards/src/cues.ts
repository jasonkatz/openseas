import { CuesFileSchema, type CueData, type When } from "@openseas/protocol";
import type { PuzzleId } from "@openseas/engine";
import shippedCues from "../data/cues.json" with { type: "json" };
import coolingCues from "../data/cues/cooling.json" with { type: "json" };
import enginesCues from "../data/cues/engines.json" with { type: "json" };
import platingCues from "../data/cues/plating.json" with { type: "json" };
import gunneryCues from "../data/cues/gunnery.json" with { type: "json" };
import navigationCues from "../data/cues/navigation.json" with { type: "json" };
import battleCues from "../data/cues/battle.json" with { type: "json" };
import swordfightCues from "../data/cues/swordfight.json" with { type: "json" };
import salvageCues from "../data/cues/salvage.json" with { type: "json" };
import overloadCues from "../data/cues/overload.json" with { type: "json" };
import deflectorsCues from "../data/cues/deflectors.json" with { type: "json" };
import reactorCues from "../data/cues/reactor.json" with { type: "json" };
import scannerCues from "../data/cues/scanner.json" with { type: "json" };
import tugCues from "../data/cues/tug.json" with { type: "json" };
import racksCues from "../data/cues/racks.json" with { type: "json" };
import cuttingCues from "../data/cues/cutting.json" with { type: "json" };
import tractorCues from "../data/cues/tractor.json" with { type: "json" };
import freefallCues from "../data/cues/freefall.json" with { type: "json" };

/**
 * Every cue the game plays, as data (docs/BRAND.md section 8, ADR 0062 decision 5). A cue is a
 * few voices from one small set: a tone on a note of the scale, or a breath of soft noise, written
 * with the rules that vary them by what the board says (ADR 0065), so the
 * studio can revoice one and its Save can write it back. Nothing here touches WebAudio: `audio.ts` plays these, and `studio/test/sound.test.ts` reads them and
 * holds every one to the rules below, so a cue cannot leave the key, sharpen its attack or outstay
 * its length without a test failing.
 *
 * - One key: a tone names a step of `NOTES`, never a frequency.
 * - Soft: an envelope rises from zero over at least `LIMITS.attack` and falls back to zero; a
 *   tone is a sine or a triangle; everything passes a low-pass no brighter than `LIMITS.cutoff`.
 * - Short: a cue is over within `LIMITS.cue`, the beat's within `LIMITS.beat`.
 * - Level: a cue peaks within `LIMITS.band` dB of `LIMITS.peak` (measured in a real browser by
 *   `studio/e2e/sound.spec.ts`; `gain` on each cue is what was tuned to get there).
 *
 * Each puzzle has its own copy of every cue its board plays, in `data/cues/<puzzle>.json`, so a
 * cue revoiced for one puzzle is heard on that puzzle's board and no other (ADR 0070). The game's
 * own cues, played around the boards (the chart, a crew, a sheet), are `data/cues.json`. Which set
 * sounds is the puzzle on screen: the page that shows a board says so with `playCuesOf`.
 */

/** The one key: G major pentatonic, three octaves up from G2, and the G above them. */
export const SCALE = { name: "G major pentatonic", rootHz: 97.99886, semitones: [0, 2, 4, 7, 9], octaves: 3 } as const;

/** The scale's notes in hertz, low to high: 0 is G2, 5 is G3, 10 is G4, 15 is G5. */
export const NOTES: readonly number[] = [
  ...Array.from({ length: SCALE.octaves }, (_, o) => SCALE.semitones.map((s) => SCALE.rootHz * 2 ** (o + s / 12))).flat(),
  SCALE.rootHz * 2 ** SCALE.octaves,
];

export const LIMITS = {
  /** The shortest rise of any envelope, in seconds. */
  attack: 0.008,
  /** The longest a cue lasts, in seconds. */
  cue: 0.4,
  /** The longest the beat's cue rings, in seconds. */
  beat: 0.7,
  /** The brightest any low-pass or noise filter is set, in hertz. */
  cutoff: 2400,
  /** The peak every cue is tuned to, of full scale 1 (about -17 dBFS). */
  peak: 0.14,
  /** How far, in dB either way, a cue's measured peak may sit from `peak`. */
  band: 3,
} as const;

/** A note of the scale, sounded soft. */
export interface Tone {
  kind: "tone";
  /** A step of `NOTES`. */
  note: number;
  wave: "sine" | "triangle";
  /** Seconds after the cue starts. */
  at: number;
  /** Seconds from zero to full. */
  attack: number;
  /** Seconds from full back to zero. */
  release: number;
  level: number;
}

/** A breath of noise through a filter that moves from one cutoff to another: a hiss, a thud's body, a whoosh. */
export interface Air {
  kind: "air";
  at: number;
  attack: number;
  release: number;
  level: number;
  /** The filter's cutoff as the breath starts and as it ends, in hertz. */
  from: number;
  to: number;
  /** A band-pass (a whoosh) where true, else a low-pass (a hiss, a thump). */
  band: boolean;
}

export type Voice = Tone | Air;

export interface Cue {
  voices: readonly Voice[];
  /** The low-pass the whole cue passes through, in hertz. */
  cutoff: number;
  /** The cue's level, tuned so it peaks at `LIMITS.peak`. */
  gain: number;
}

const top = NOTES.length - 1;
const step = (note: number): number => Math.max(0, Math.min(top, Math.round(note)));
const unit = (x: number): number => Math.max(0, Math.min(1, x));
const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));

/** A parameter a board passes a cue: a count or an amount is a number, a flag a boolean. */
export interface CueParam {
  readonly name: string;
  readonly kind: "count" | "amount" | "flag";
}
const count = (name: string) => ({ name, kind: "count" }) as const;
const amount = (name: string) => ({ name, kind: "amount" }) as const;
const flag = (name: string) => ({ name, kind: "flag" }) as const;

/**
 * Every cue's name and what a board asks it with, in order (ADR 0065). This is code, as the call
 * is: a board says `sfx.clear(chain, pieces)`. How each cue sounds is data, in `data/cues.json`,
 * whose rules name these parameters; a test holds the two files to each other.
 */
export const CUE_PARAMS = {
  /** A move that scored. */
  swap: [],
  /** A move that cleared nothing: quieter and lower, so scoring moves stand out. */
  swapQuiet: [],
  /** One cascade step. `chain` 1 is the move's own clear; each later step climbs the scale. */
  clear: [count("chain"), count("pieces")],
  /** Two or more runs cleared at once: a quick run up the scale, a note a run. */
  multi: [count("groups")],
  /** A streak milestone: higher for a longer streak. */
  streak: [count("count")],
  /** A streak just ended. */
  streakLost: [],
  /** The heat dropped: a soft hiss, and a falling note a row. */
  vent: [count("rows")],
  /** The heat rose a row. */
  rise: [],
  /** The heat crossed into the danger half. Never a buzzer. */
  alarm: [],
  /** A charge going off. */
  charge: [],
  /** A magnet pulling a row in. */
  magnet: [],
  /** Slag lifted, or anything rare and good. */
  slag: [],
  /** Plating: a plate welded down, duller when it hangs over sound hull. */
  welder: [flag("waste")],
  /** Plating: a sealed breach's plates lift away. */
  plateLift: [],
  /** Plating tears open, or a hit lands on the hull, lower when `loud`. */
  crack: [flag("loud")],
  /** A move that will not go. */
  bump: [],
  /** A piece picked, stepped onto or added to a line: `steps` climbs the scale. */
  pop: [count("steps")],
  /** A discharge. */
  zap: [],
  /** Something sliding or flying off. */
  whoosh: [],
  /** Something heavy stopping. */
  thud: [],
  /** A sounding: `near` 0 (close) to 8 (far) steps it down the scale. */
  ping: [count("near")],
  /** A small right answer. */
  good: [],
  /** A wrong answer or a penalty. */
  bad: [],
  /** Power building, from higher the higher `level` (0 to 1) is. */
  power: [amount("level")],
  /** The clock's last seconds, and a cursor's step: higher when `urgent`. */
  tick: [flag("urgent")],
  /** A round starting. */
  start: [],
  /** A round over. */
  end: [],
  /** The beat's one sound (docs/BRAND.md section 6), the same on every board; `strength` (0 to 1) only lifts it a little. */
  beat: [amount("strength")],
} as const satisfies Record<string, readonly CueParam[]>;

export type CueName = keyof typeof CUE_PARAMS;
type ArgOf<P> = P extends { kind: "flag" } ? boolean : number;
type ArgsOf<T extends readonly CueParam[]> = T extends readonly [infer H, ...infer R extends readonly CueParam[]] ? [ArgOf<H>, ...ArgsOf<R>] : [];
export type CueArgs<K extends CueName> = ArgsOf<(typeof CUE_PARAMS)[K]>;

/** How the game's own cues sound as the build ships them: `data/cues.json`, checked as it loads. Every cue has one here. */
export const SHIPPED_CUES: Readonly<Record<CueName, CueData>> = CuesFileSchema.parse(shippedCues) as Record<CueName, CueData>;

const PUZZLE_FILES: Readonly<Record<PuzzleId, unknown>> = {
  cooling: coolingCues, engines: enginesCues, plating: platingCues, gunnery: gunneryCues, navigation: navigationCues, battle: battleCues, swordfight: swordfightCues, salvage: salvageCues, overload: overloadCues, deflectors: deflectorsCues, reactor: reactorCues, scanner: scannerCues, tug: tugCues, racks: racksCues, cutting: cuttingCues, tractor: tractorCues, freefall: freefallCues,
};
/**
 * Each puzzle's own cues as the build ships them: `data/cues/<puzzle>.json`, checked as they load,
 * a copy of every cue that puzzle's board and its round play, the beat's among them (ADR 0070, ADR 0071).
 */
export const PUZZLE_SHIPPED_CUES: Readonly<Record<PuzzleId, Readonly<Partial<Record<CueName, CueData>>>>> = Object.fromEntries(
  Object.entries(PUZZLE_FILES).map(([id, file]) => [id, CuesFileSchema.parse(file)]),
) as Record<PuzzleId, Partial<Record<CueName, CueData>>>;

/** Which set of cues sounds: the puzzle on screen, or the game's own around the boards. */
let playing: PuzzleId | null = null;

/**
 * Say which puzzle is on screen, so its own cues are the ones heard; null for the game around the
 * boards. The page that shows a board calls it as the board comes, and with null as it goes.
 */
export function playCuesOf(puzzle: PuzzleId | null): void {
  playing = puzzle;
}

/** How a cue sounds as shipped for a puzzle, or for the game when no puzzle is named: the puzzle's own copy, where it has one. */
export function shippedCueOf(puzzle: PuzzleId | null, name: CueName): CueData {
  return (puzzle ? PUZZLE_SHIPPED_CUES[puzzle][name] : undefined) ?? SHIPPED_CUES[name];
}

let over: Readonly<Partial<Record<CueName, CueData>>> = {};
let revision = 0;
const listeners = new Set<() => void>();

/**
 * Cues laid over the shipped ones on this page, the puzzle on screen's: the studio's draft revoices them and the board
 * plays them at once. Presentation only, as a draft's words are. The game never sets one. An empty
 * set puts every cue back.
 */
export function overrideCues(next: Readonly<Partial<Record<string, CueData>>>): void {
  const known = Object.fromEntries(Object.entries(next).filter(([k, v]) => k in CUE_PARAMS && v)) as Partial<Record<CueName, CueData>>;
  if (JSON.stringify(known) === JSON.stringify(over)) return;
  over = known;
  revision++;
  for (const l of listeners) l();
}
export const cueOverrideRevision = (): number => revision;
export function subscribeCues(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** How a cue sounds on this page: the draft's, where it revoices it, else the puzzle on screen's own as shipped. */
export const cueDataOf = (name: CueName): CueData => over[name] ?? shippedCueOf(playing, name);

/** The number a parameter reads as: a flag is 1 or 0, anything not a number 0. */
function paramValue(params: readonly CueParam[], args: readonly unknown[], name: string): number {
  const a = args[params.findIndex((p) => p.name === name)];
  if (typeof a === "boolean") return a ? 1 : 0;
  return typeof a === "number" && Number.isFinite(a) ? a : 0;
}

/**
 * A cue's voices for what the board passed it, by its data's rules: the voices whose `when`
 * holds, each sounded as many times as its `repeat` says, every tone not `fixed` shifted up the
 * scale by `shift`; the level and low-pass of `alt` while it holds; the level scaled by `swell`.
 */
export function cueFrom(data: CueData, params: readonly CueParam[], args: readonly unknown[]): Cue {
  const value = (name: string): number => paramValue(params, args, name);
  const holds = (w: When | undefined): boolean => !w || ((w.from === undefined || value(w.param) >= w.from) && (w.to === undefined || value(w.param) <= w.to));
  const s = data.shift;
  const lift = s ? (s.round === "floor" ? Math.floor : Math.round)(clamp(s.per * (value(s.param) + s.offset), s.min, s.max)) : 0;
  const voices: Voice[] = [];
  for (const v of data.voices) {
    if (!holds(v.when)) continue;
    const r = v.repeat;
    const copies = r ? clamp(Math.floor(value(r.param)), r.min, r.max) : 1;
    for (let i = 0; i < copies; i++) {
      const at = v.at + (r ? i * r.at : 0);
      if (v.kind === "tone") voices.push({ kind: "tone", note: step(v.note + (v.fixed ? 0 : lift) + (r ? i * r.note : 0)), wave: v.wave, at, attack: v.attack, release: v.release, level: v.level });
      else voices.push({ kind: "air", at, attack: v.attack, release: v.release, level: v.level, from: v.from, to: v.to, band: v.band });
    }
  }
  const alt = data.alt && holds(data.alt.when) ? data.alt : null;
  let level = alt ? alt.level : data.level;
  if (data.swell) level *= data.swell.from + (data.swell.to - data.swell.from) * unit(value(data.swell.param));
  return { voices, cutoff: alt ? alt.cutoff : data.cutoff, gain: level * LIMITS.peak };
}

/**
 * What each cue is called with when it is only listened to or measured: the first row is what the
 * studio plays, and the rest reach the ends of what a board may ask for, so the tests hold the
 * whole range to the rules.
 */
export const PROBES: { readonly [K in CueName]: readonly CueArgs<K>[] } = {
  swap: [[]],
  swapQuiet: [[]],
  clear: [[1, 3], [1, 6], [2, 4], [3, 3], [6, 8], [12, 20], [0, 0]],
  multi: [[2], [1], [4], [9], [0]],
  streak: [[4], [1], [8], [12], [16], [40]],
  streakLost: [[]],
  vent: [[1], [2], [3], [6], [0]],
  rise: [[]],
  alarm: [[]],
  charge: [[]],
  magnet: [[]],
  slag: [[]],
  welder: [[false], [true]],
  plateLift: [[]],
  crack: [[true], [false]],
  bump: [[]],
  pop: [[0], [3], [9], [30], [-2]],
  zap: [[]],
  whoosh: [[]],
  thud: [[]],
  ping: [[0], [3], [6], [8], [20], [-1]],
  good: [[]],
  bad: [[]],
  power: [[0.5], [0], [1], [3]],
  tick: [[false], [true]],
  start: [[]],
  end: [[]],
  beat: [[0.5], [0], [1]],
};

export const CUE_NAMES = Object.keys(CUE_PARAMS) as CueName[];

/** The cue for a name and its arguments, as it sounds on this page. */
export function cueOf<K extends CueName>(name: K, args: CueArgs<K>): Cue {
  return cueFrom(cueDataOf(name), CUE_PARAMS[name], args);
}

/** The cue for a name and its arguments as shipped for a puzzle (or the game, for null), whatever is on screen: for the sound tests, which hold every copy to the rules. */
export function shippedCue<K extends CueName>(puzzle: PuzzleId | null, name: K, args: CueArgs<K>): Cue {
  return cueFrom(shippedCueOf(puzzle, name), CUE_PARAMS[name], args);
}

/** How long a voice lasts from the cue's start, in seconds. */
export const voiceEnd = (v: Voice): number => v.at + v.attack + v.release;

/** How long a cue lasts, in seconds: its last voice back at zero. */
export const cueLength = (c: Cue): number => c.voices.reduce((end, v) => Math.max(end, voiceEnd(v)), 0);

/**
 * A voice's envelope, a point a millisecond: a half-cosine up from zero over `attack`, then a
 * decay that is back at exactly zero after `release`. The same shape for every voice.
 */
export function envelope(attack: number, release: number): Float32Array {
  const n = Math.max(3, Math.round((attack + release) * 1000) + 1);
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * (attack + release);
    if (t < attack) curve[i] = 0.5 - 0.5 * Math.cos((Math.PI * t) / attack);
    else {
      const x = (t - attack) / release;
      curve[i] = Math.exp(-3 * x) * (1 - x);
    }
  }
  curve[0] = 0;
  curve[n - 1] = 0;
  return curve;
}
