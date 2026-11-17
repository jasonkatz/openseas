/**
 * Every cue the game plays, as data (docs/BRAND.md section 8, ADR 0062 decision 5). A cue is a
 * few voices from one small set: a tone on a note of the scale, or a breath of soft noise. Nothing
 * here touches WebAudio: `audio.ts` plays these, and `studio/test/sound.test.ts` reads them and
 * holds every one to the rules below, so a cue cannot leave the key, sharpen its attack or outstay
 * its length without a test failing.
 *
 * - One key: a tone names a step of `NOTES`, never a frequency.
 * - Soft: an envelope rises from zero over at least `LIMITS.attack` and falls back to zero; a
 *   tone is a sine or a triangle; everything passes a low-pass no brighter than `LIMITS.cutoff`.
 * - Short: a cue is over within `LIMITS.cue`, the beat's within `LIMITS.beat`.
 * - Level: a cue peaks within `LIMITS.band` dB of `LIMITS.peak` (measured in a real browser by
 *   `studio/e2e/sound.spec.ts`; `gain` on each cue is what was tuned to get there).
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

// ---- the voices: every cue is made of these four

/** A plain sine: the game's ordinary voice. `len` is the whole of it, rise and fall. */
const soft = (note: number, at: number, len: number, level = 1, attack = 0.01): Tone => ({ kind: "tone", wave: "sine", note: step(note), at, attack, release: len - attack, level });
/** A triangle: a little more body, for a note that should carry on a small speaker. */
const warm = (note: number, at: number, len: number, level = 1, attack = 0.012): Tone => ({ kind: "tone", wave: "triangle", note: step(note), at, attack, release: len - attack, level });
/** A slow sine for the bottom of the scale: weight under a cue. */
const low = (note: number, at: number, len: number, level = 1, attack = 0.02): Tone => ({ kind: "tone", wave: "sine", note: step(note), at, attack, release: len - attack, level });
/** Soft noise through a moving filter. */
const air = (at: number, len: number, from: number, to: number, level = 1, band = false, attack = 0.015): Air => ({ kind: "air", at, attack, release: len - attack, level, from, to, band });

/** A cue from its voices. `level` is what was tuned by measurement: 1 is about the target peak. */
const cue = (level: number, cutoff: number, voices: readonly Voice[]): Cue => ({ voices, cutoff, gain: level * LIMITS.peak });

/** A cascade's or a line's note: `from` and up a step of the scale at a time, held at the top. */
const climb = (from: number, steps: number): number => step(from + Math.max(0, Math.floor(steps)));

/**
 * The cues. Each is a function of what the board knows (a chain's depth, a streak's length) to
 * the voices that say it. What rises steps up the scale, what falls steps down, and a bad thing
 * is low and soft.
 */
export const CUES = {
  /** A move that scored. */
  swap: () => cue(1.07, 1800, [warm(10, 0, 0.11)]),
  /** A move that cleared nothing: quieter and lower, so scoring moves stand out. */
  swapQuiet: () => cue(0.86, 1200, [soft(8, 0, 0.07), air(0, 0.05, 900, 500, 0.3)]),
  /** One cascade step. `chain` 1 is the move's own clear; each later step climbs the scale. */
  clear: (chain: number, pieces: number) => {
    const n = climb(7, chain - 1);
    const voices: Voice[] = [soft(n, 0, 0.22), warm(n + 2, 0.02, 0.18, 0.35), air(0, 0.12, 1600, 500, 0.3)];
    if (pieces >= 5) voices.push(soft(n + 5, 0.06, 0.3, 0.4));
    // A deep step lands with the root under it.
    if (chain >= 3) voices.push(low(0, 0, 0.25, 0.8));
    return cue(0.82, 2200, voices);
  },
  /** Two or more runs cleared at once: a quick run up the scale, a note a run. */
  multi: (groups: number) => cue(0.9, 2200, Array.from({ length: Math.max(1, Math.min(4, Math.floor(groups))) }, (_, i) => warm(10 + i, 0.05 + i * 0.05, 0.16))),
  /** A streak milestone: four steps up and a held note, higher for a longer streak. */
  streak: (count: number) => {
    const lift = Math.min(4, Math.max(0, Math.floor(count / 4)));
    return cue(0.98, 2200, [...[5, 7, 8, 10].map((n, i) => warm(n + lift, i * 0.05, 0.14, 0.55)), warm(11 + lift, 0.2, 0.2)]);
  },
  /** A streak just ended: three steps down. */
  streakLost: () => cue(1.0, 1400, [soft(8, 0, 0.14, 0.8), soft(6, 0.09, 0.16, 0.8), soft(5, 0.18, 0.2, 0.9)]),
  /** The heat dropped: a soft hiss, and a falling note a row. */
  vent: (rows: number) => cue(1.45, 2000, [air(0, 0.32, 1900, 600, 1), ...Array.from({ length: Math.max(0, Math.min(3, Math.floor(rows))) }, (_, i) => soft(12 - i, 0.04 + i * 0.08, 0.16, 0.3))]),
  /** The heat rose a row: two low notes, a step up. */
  rise: () => cue(1.0, 1000, [warm(3, 0, 0.14, 0.8), warm(4, 0.09, 0.17, 0.9)]),
  /** The heat crossed into the danger half: two low notes, falling. Never a buzzer. */
  alarm: () => cue(1.0, 900, [warm(5, 0, 0.18), warm(3, 0.17, 0.22)]),
  /** A charge going off: the root, with a breath falling away over it. */
  charge: () => cue(0.86, 1400, [air(0, 0.38, 900, 120, 0.9), low(0, 0, 0.38), warm(5, 0, 0.3, 0.25)]),
  /** A magnet pulling a row in: a breath opening, and an octave up. */
  magnet: () => cue(1.2, 2000, [air(0, 0.36, 300, 1700, 0.6, true), soft(6, 0, 0.16, 0.6), soft(10, 0.12, 0.24, 0.7)]),
  /** Slag lifted, or anything rare and good: two high notes. */
  slag: () => cue(1.1, 2400, [warm(12, 0, 0.12, 0.7), soft(15, 0.06, 0.2, 0.8)]),
  /** Plating: a plate welded down. A short breath, a low knock and a note, duller when the plate hangs over sound hull. */
  welder: (waste: boolean) => {
    const voices: Voice[] = [air(0, 0.07, 1900, 900, waste ? 0.35 : 0.55), low(1, 0, 0.09, 0.5, 0.012), warm(waste ? 8 : 11, 0.05, waste ? 0.12 : 0.22, waste ? 0.7 : 1)];
    if (!waste) voices.push(soft(14, 0.05, 0.16, 0.25));
    return cue(waste ? 1.3 : 0.95, waste ? 1400 : 2200, voices);
  },
  /** Plating: a sealed breach's plates lift away. A breath opening under three steps up. */
  plateLift: () => cue(1.55, 2200, [air(0, 0.3, 700, 1500, 0.5, true), soft(8, 0, 0.14, 0.5), soft(10, 0.08, 0.14, 0.5), soft(13, 0.16, 0.16, 0.5)]),
  /** Plating tears open, or a hit lands on the hull: a breath falling away over low notes, lower when `loud`. */
  crack: (loud: boolean) => {
    const voices: Voice[] = [air(0, 0.14, 1900, 400, loud ? 0.9 : 0.6), warm(4, 0.02, loud ? 0.2 : 0.12, 0.6)];
    if (loud) voices.push(low(1, 0.08, 0.3, 0.8));
    return cue(loud ? 1.08 : 1.55, 1600, voices);
  },
  /** A move that will not go: a short dull knock. */
  bump: () => cue(0.95, 800, [air(0, 0.05, 700, 250, 0.5), warm(3, 0, 0.09)]),
  /** A piece picked, stepped onto or added to a line: `step` climbs the scale, so a long line sings upward. */
  pop: (steps: number) => cue(1.0, 2200, [soft(climb(8, steps), 0, 0.1)]),
  /** A discharge: a breath falling away under two quick notes down. */
  zap: () => cue(1.5, 2200, [air(0, 0.16, 1900, 500, 0.8, true), warm(13, 0, 0.07, 0.5), warm(10, 0.05, 0.1, 0.5)]),
  /** Something sliding or flying off: a breath opening. */
  whoosh: () => cue(2.6, 2000, [air(0, 0.24, 400, 1800, 1, true, 0.06)]),
  /** Something heavy stopping. */
  thud: () => cue(0.74, 700, [air(0, 0.06, 600, 180, 0.5), low(1, 0, 0.14, 1, 0.012), warm(1, 0, 0.1, 0.4)]),
  /** A sounding: one held note; `near` 0 (close) to 8 (far) steps it down the scale. */
  ping: (near: number) => {
    const n = top - Math.round(Math.max(0, Math.min(8, near)));
    return cue(0.92, 2400, [soft(n, 0, 0.38), soft(n + 5, 0.01, 0.2, 0.2)]);
  },
  /** A small right answer: a fifth up. */
  good: () => cue(1.0, 2200, [warm(10, 0, 0.1, 0.8), warm(13, 0.08, 0.18)]),
  /** A wrong answer or a penalty: two low notes, falling. */
  bad: () => cue(1.0, 900, [warm(6, 0, 0.15, 0.8), warm(3, 0.12, 0.24, 0.9)]),
  /** Power building: two steps up, from higher the higher `level` (0 to 1) is. */
  power: (level: number) => {
    const n = 4 + Math.round(unit(level) * 6);
    return cue(1.05, 2000, [warm(n, 0, 0.1, 0.7), warm(n + 2, 0.08, 0.13, 0.9)]);
  },
  /** The clock's last seconds, and a cursor's step: one very short note, higher when `urgent`. */
  tick: (urgent: boolean) => cue(1.0, 2200, [soft(urgent ? 13 : 11, 0, 0.055)]),
  /** A round starting: an octave up. */
  start: () => cue(1.0, 2000, [warm(5, 0, 0.14, 0.8), warm(10, 0.1, 0.22)]),
  /** A round over: four steps up the scale. */
  end: () => cue(0.95, 2200, [warm(5, 0, 0.2, 0.7), warm(8, 0.06, 0.2, 0.7), warm(10, 0.12, 0.2, 0.8), warm(13, 0.18, 0.22)]),
  /**
   * The beat's one sound (docs/BRAND.md section 6): the root, its fifth and its octave, low and
   * ringing, with the third laid softly on top. The same on every board; `strength` (0 to 1) only
   * lifts it a little.
   */
  beat: (strength: number) => cue(0.62 * (0.75 + 0.25 * unit(strength)), 1600, [low(0, 0, 0.7, 1, 0.03), warm(3, 0, 0.66, 0.55, 0.03), soft(5, 0.01, 0.6, 0.5, 0.03), soft(7, 0.03, 0.5, 0.2, 0.03)]),
} satisfies Record<string, (...args: never[]) => Cue>;

export type CueName = keyof typeof CUES;
export type CueArgs<K extends CueName> = Parameters<(typeof CUES)[K]>;

/**
 * What each cue is called with when it is only listened to or measured: the first row is what the
 * studio's Sounds list plays, and the rest reach the ends of what a board may ask for, so the
 * tests hold the whole range to the rules.
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

export const CUE_NAMES = Object.keys(CUES) as CueName[];

/** The cue for a name and its arguments. */
export function cueOf<K extends CueName>(name: K, args: CueArgs<K>): Cue {
  return (CUES[name] as (...a: CueArgs<K>) => Cue)(...args);
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
