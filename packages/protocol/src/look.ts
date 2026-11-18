import { z } from "zod";

/**
 * The look as data (ADR 0065): every piece a board draws and every cue the game plays is a file
 * of numbers in `boards/data`, and a studio draft may lay its own over them. These schemas are the
 * shape of both, and their order is the order a file's keys are written in: Save writes an entry
 * as its schema gives it back. Only the shape and its bounds are checked here; the brand book's rules for a
 * piece (docs/BRAND.md section 3) and for a cue (section 8) are checked in `boards` (`lookRules`),
 * where the page shows them, and by the studio's tests over the shipped files.
 */

const num = (min: number, max: number) => z.number().min(min).max(max);

// ---- pieces

/** Where on the 24 unit square, and how far off it a layer may reach. */
const U = num(-12, 36);
/** A length on the square. */
const L = num(0, 48);
/** An angle, in degrees. */
const DEG = num(-720, 720);

/** What the owner calls a layer in the studio's list; nothing draws it. First, so a file reads by it. */
const LayerName = { name: z.string().max(32).optional() };

const LayerBase = {
  /** Cut out of what the layers before it drew, so the ground shows through: the piece's one inner detail. */
  cut: z.boolean().optional(),
  /** Turned about the square's centre, in degrees. */
  turn: DEG.optional(),
  /** Drawn this many times in all, each turned `spread` degrees further about the centre than the last (a cog's teeth, a lobed wheel). */
  copies: z.int().min(1).max(12).optional(),
  spread: DEG.optional(),
};

/** A rounded rectangle. */
export const RectLayerSchema = z.object({ ...LayerName, kind: z.literal("rect"), x: U, y: U, w: L, h: L, r: L, ...LayerBase });
/** A disc. */
export const DiscLayerSchema = z.object({ ...LayerName, kind: z.literal("disc"), x: U, y: U, r: L, ...LayerBase });
/** A filled polygon, corners rounded by `round` (a stroke of its own colour). `points` are x, y pairs. */
export const PolyLayerSchema = z.object({ ...LayerName, kind: z.literal("poly"), points: z.array(U).min(6).max(128).refine((p) => p.length % 2 === 0, "points come in pairs"), round: L, ...LayerBase });
/** A round-ended stroke from one point to another. */
export const BarLayerSchema = z.object({ ...LayerName, kind: z.literal("bar"), x0: U, y0: U, x1: U, y1: U, width: L, ...LayerBase });
/** A stroked arc about (`x`, `y`), from `from` to `to` degrees clockwise from three o'clock. `cap` rounds its ends. */
export const ArcLayerSchema = z.object({ ...LayerName, kind: z.literal("arc"), x: U, y: U, r: L, from: DEG, to: DEG, width: L, cap: z.boolean().optional(), ...LayerBase });
/**
 * A stroked line through `points`, joined round: a horseshoe's legs and bow, a hook. An `arc`
 * entry bends it: from the last point, round the circle about (`x`, `y`) to `to` degrees.
 */
export const PathLayerSchema = z.object({
  ...LayerName,
  kind: z.literal("path"),
  steps: z
    // The arc first: a point would read an arc as itself, dropping the rest of it.
    .array(z.union([z.object({ x: U, y: U, r: L, from: DEG, to: DEG, ccw: z.boolean().optional() }), z.object({ x: U, y: U })]))
    .min(2)
    .max(32),
  width: L,
  cap: z.boolean().optional(),
  /** Filled as well as stroked, as one closed shape. */
  fill: z.boolean().optional(),
  ...LayerBase,
});

export const LayerSchema = z.discriminatedUnion("kind", [RectLayerSchema, DiscLayerSchema, PolyLayerSchema, BarLayerSchema, ArcLayerSchema, PathLayerSchema]);
export type Layer = z.infer<typeof LayerSchema>;
export type LayerKind = Layer["kind"];

/**
 * A piece: its layers, painted in order on the 24 unit square in the piece's one colour. The board
 * picks the colour; `tint` is only the palette token the studio shows the drawing in. A `detail`
 * is not a piece on its own but a shape the board stamps out of another (a plate's cut-out, a
 * sign's hole): it is drawn filled here, and the studio shows it cut out of a tile.
 */
export const DrawingSchema = z.object({ tint: z.string().max(24).optional(), detail: z.boolean().optional(), layers: z.array(LayerSchema).min(1).max(32) });
export type Drawing = z.infer<typeof DrawingSchema>;

/** A puzzle's pieces file: each drawing by the name its board asks for it by. */
export const PiecesFileSchema = z.record(z.string().regex(/^[a-z][a-zA-Z0-9-]*$/).max(48), DrawingSchema);
export type PiecesFile = z.infer<typeof PiecesFileSchema>;

// ---- cues

/** How many notes the one key has: three octaves of five, and the root above them (docs/BRAND.md section 8). */
export const NOTE_COUNT = 16;

/**
 * Whether a voice sounds, by one of the cue's parameters: from `from` to `to`, both inclusive. A
 * flag reads as 1 when set and 0 when not.
 */
export const WhenSchema = z.object({ param: z.string().min(1).max(24), from: z.number().optional(), to: z.number().optional() });
export type When = z.infer<typeof WhenSchema>;

/**
 * A voice sounded again a number of times the board says: `floor(param)` held between `min` and
 * `max` copies in all (none, where `min` is 0), each `note` steps and `at` seconds after the last.
 */
export const RepeatSchema = z.object({ param: z.string().min(1).max(24), min: z.int().min(0).max(8), max: z.int().min(0).max(8), note: z.int().min(-8).max(8), at: num(0, 0.4) });
export type Repeat = z.infer<typeof RepeatSchema>;

const VoiceTiming = {
  /** Seconds after the cue starts. */
  at: num(0, 1),
  /** Seconds from silence to full. */
  attack: num(0, 1),
  /** Seconds from full back to silence. */
  release: num(0.001, 1),
  level: num(0.001, 1),
};
const VoiceRules = { when: WhenSchema.optional(), repeat: RepeatSchema.optional() };

/** A note of the scale, sounded soft. */
export const ToneVoiceSchema = z.object({
  kind: z.literal("tone"),
  /** A step of the scale: 0 is its root, two octaves down. */
  note: z.int().min(0).max(NOTE_COUNT - 1),
  wave: z.enum(["sine", "triangle"]),
  ...VoiceTiming,
  /** Kept where it is when the cue is shifted. */
  fixed: z.boolean().optional(),
  ...VoiceRules,
});
/** A breath of noise through a filter moving from one cutoff to another: a low-pass, or a band-pass where `band`. */
export const AirVoiceSchema = z.object({ kind: z.literal("air"), ...VoiceTiming, from: num(20, 20_000), to: num(20, 20_000), band: z.boolean(), ...VoiceRules });

export const VoiceDataSchema = z.discriminatedUnion("kind", [ToneVoiceSchema, AirVoiceSchema]);
export type VoiceData = z.infer<typeof VoiceDataSchema>;

/**
 * Every tone of the cue moved up the scale by `round(clamp(per × (param + offset), min, max))`
 * steps (`floor` where `round` is "floor"): a cascade climbing, a far sounding lower.
 */
export const ShiftSchema = z.object({ param: z.string().min(1).max(24), per: num(-16, 16), offset: num(-100, 100), min: num(-16, 16), max: num(-16, 16), round: z.enum(["floor", "round"]) });
export type Shift = z.infer<typeof ShiftSchema>;

/** The cue's level scaled from `from` to `to` as its parameter goes from 0 to 1. */
export const SwellSchema = z.object({ param: z.string().min(1).max(24), from: num(0, 2), to: num(0, 2) });

/** A cue: its voices, its level (1 is about the peak every cue is tuned to), its low-pass and its rules. */
export const CueDataSchema = z.object({
  level: num(0.01, 4),
  /** The low-pass the whole cue passes through, in hertz. */
  cutoff: num(20, 20_000),
  voices: z.array(VoiceDataSchema).min(1).max(16),
  shift: ShiftSchema.optional(),
  swell: SwellSchema.optional(),
  /** Another level and low-pass while a parameter holds. */
  alt: z.object({ when: WhenSchema, level: num(0.01, 4), cutoff: num(20, 20_000) }).optional(),
});
export type CueData = z.infer<typeof CueDataSchema>;

export const CuesFileSchema = z.record(z.string().regex(/^[a-z][a-zA-Z0-9]*$/).max(32), CueDataSchema);
export type CuesFile = z.infer<typeof CuesFileSchema>;

// ---- a draft's look

const few = (o: Record<string, unknown>): boolean => Object.keys(o).length <= 64;

/**
 * What a draft redraws and revoices (ADR 0065): the puzzle's pieces by their names, and cues by
 * theirs. A cue is the game's, not one puzzle's: a draft that revoices one revoices it on every
 * board that plays it, and its pull request says so.
 */
export const LookSchema = z.object({
  pieces: z.record(z.string().regex(/^[a-z][a-zA-Z0-9-]*$/).max(48), DrawingSchema).refine(few, "too many pieces").default({}),
  cues: z.record(z.string().regex(/^[a-z][a-zA-Z0-9]*$/).max(32), CueDataSchema).refine(few, "too many cues").default({}),
});
export type Look = z.infer<typeof LookSchema>;
export const NO_LOOK: Look = { pieces: {}, cues: {} };
