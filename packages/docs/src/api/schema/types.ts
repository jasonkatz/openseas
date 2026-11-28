import paletteRaw from "../../../content/api/space.palette.json?raw";
/**
 * The reference as data. Each of the three top-level objects (puzzle, skin, theme) is written here
 * as a tree of typed fields, down to primitive values. The reference pages are drawn from it, the
 * search finds every field in it, and the tests hold the written examples to it.
 *
 * Every string a reader sees is inline Markdown.
 */

/** A part of a puzzle that other parts name by its id. A field that holds such an id says which. */
export type RefTarget =
  | "setting"
  | "move"
  | "control"
  | "event"
  | "phase"
  | "payout"
  | "layer"
  | "piece"
  | "zone"
  | "gauge"
  | "stat"
  | "multiplier"
  | "task"
  | "draw"
  | "check"
  | "stand-in"
  | "puzzle"
  | "theme"
  | "cue"
  | "colour"
  | "event field";

export interface EnumValue {
  readonly value: string | number;
  readonly description: string;
}

export interface Alternative {
  /** A few words that tell this form from the others. */
  readonly label: string;
  readonly description?: string;
  readonly type: Type;
}

export interface Variant {
  readonly value: string;
  readonly description: string;
  readonly fields: readonly Field[];
}

export type Type =
  | { readonly kind: "string"; readonly format?: string; readonly pattern?: string }
  | { readonly kind: "integer"; readonly min?: number; readonly max?: number; readonly unit?: string }
  | { readonly kind: "number"; readonly min?: number; readonly max?: number; readonly unit?: string }
  | { readonly kind: "boolean" }
  | { readonly kind: "literal"; readonly value: string | number }
  | { readonly kind: "enum"; readonly values: readonly EnumValue[] }
  /** A string that is the id of a declared part. */
  | { readonly kind: "ref"; readonly to: RefTarget }
  /** A named value type, defined on the types page. */
  | { readonly kind: "alias"; readonly name: string }
  | { readonly kind: "array"; readonly of: Type; readonly min?: number; readonly max?: number; readonly noun?: string }
  /** An array of fixed length, each position with a meaning. */
  | { readonly kind: "tuple"; readonly of: readonly { readonly name: string; readonly type: Type }[] }
  /** An object whose keys the author chooses, or that come from a fixed set, all with values of one type. */
  | { readonly kind: "map"; readonly key: string; readonly keyNote: string; readonly keys?: readonly EnumValue[]; readonly of: Type }
  | { readonly kind: "object"; readonly noun?: string; readonly fields: readonly Field[] }
  /** An object that takes one of several forms, told apart by one field. */
  | { readonly kind: "variants"; readonly noun: string; readonly on: string; readonly variants: readonly Variant[]; readonly common: readonly Field[] }
  | { readonly kind: "union"; readonly of: readonly Alternative[] }
  /** A type that holds itself, or one defined once and shown wherever it is used. */
  | { readonly kind: "lazy"; readonly noun: string; readonly note: string; readonly get: () => Type };

export type Need = "required" | "optional" | { readonly when: string };

/** One constraint on a field: what it needs beside it, or what it may not sit beside. */
export interface Rule {
  readonly kind: "only" | "never" | "must";
  readonly text: string;
}

export interface Field {
  readonly name: string;
  readonly type: Type;
  readonly need: Need;
  readonly description: string;
  /** What leaving it out means, where it may be left out. */
  readonly absent?: string;
  readonly rules?: readonly Rule[];
}

export interface Example {
  readonly title: string;
  /** A line on what the example shows, where it is not plain. */
  readonly note?: string;
  readonly value: unknown;
}

export type Root = "puzzle" | "skin" | "theme";

/** One reference page: a top-level object, or an object that belongs to one. */
export interface ObjectPage {
  readonly root: Root;
  /** The key under its parent, and the last part of its address. Empty for the top-level object itself. */
  readonly key: string;
  readonly title: string;
  readonly lede: string;
  /** A paragraph or two before the fields: what the object is, in plain words. */
  readonly about?: readonly string[];
  /** Where the ideas behind it are explained. */
  readonly ideas?: { readonly title: string; readonly path: string };
  readonly need: Need;
  readonly absent?: string;
  /** The type of the whole value: an object, an array of objects, or a map. */
  readonly type: Type;
  /** What must hold across fields: the combinations that are refused, and what one part asks of another. */
  readonly rules?: readonly string[];
  readonly examples: readonly Example[];
}

/** A top-level object: its own page, the group headings its fields are listed under, and when it is ready. */
export interface RootObject {
  readonly root: Root;
  readonly file: string;
  readonly title: string;
  readonly lede: string;
  readonly about: readonly string[];
  /** The fields in the order the file is written, each a field, or a field with a page of its own. */
  readonly groups: readonly { readonly title: string; readonly note?: string; readonly fields: readonly (Field | ObjectPage)[] }[];
  readonly ready: { readonly intro: string; readonly items: readonly string[]; readonly outro?: string };
  readonly example: Example;
}

const COLOURS = JSON.parse(paletteRaw) as { fixed: { ground: string; yours: string } };

export const isPage = (f: Field | ObjectPage): f is ObjectPage => "root" in f;

// ---- builders, so a schema reads as a list of fields

export const str = (format?: string, pattern?: string): Type => ({ kind: "string", ...(format ? { format } : {}), ...(pattern ? { pattern } : {}) });
export const int = (min?: number, max?: number, unit?: string): Type => ({ kind: "integer", ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}), ...(unit ? { unit } : {}) });
export const num = (min?: number, max?: number, unit?: string): Type => ({ kind: "number", ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}), ...(unit ? { unit } : {}) });
export const bool: Type = { kind: "boolean" };
export const lit = (value: string | number): Type => ({ kind: "literal", value });
export const en = (...values: readonly (readonly [string | number, string])[]): Type => ({ kind: "enum", values: values.map(([value, description]) => ({ value, description })) });
export const ref = (to: RefTarget): Type => ({ kind: "ref", to });
export const alias = (name: string): Type => ({ kind: "alias", name });
export const arr = (of: Type, opts: { min?: number; max?: number; noun?: string } = {}): Type => ({ kind: "array", of, ...opts });
export const tuple = (...of: readonly (readonly [string, Type])[]): Type => ({ kind: "tuple", of: of.map(([name, type]) => ({ name, type })) });
export const map = (key: string, keyNote: string, of: Type, keys?: readonly (readonly [string, string])[]): Type => ({
  kind: "map",
  key,
  keyNote,
  of,
  ...(keys ? { keys: keys.map(([value, description]) => ({ value, description })) } : {}),
});
export const obj = (fields: readonly Field[], noun?: string): Type => ({ kind: "object", fields, ...(noun ? { noun } : {}) });
export const or = (...of: readonly Alternative[]): Type => ({ kind: "union", of });
export const lazy = (noun: string, note: string, get: () => Type): Type => ({ kind: "lazy", noun, note, get });

interface FieldOpts {
  readonly absent?: string;
  readonly only?: string | readonly string[];
  readonly never?: string | readonly string[];
  readonly must?: string | readonly string[];
}

const list = (v: string | readonly string[] | undefined): readonly string[] => (v === undefined ? [] : typeof v === "string" ? [v] : v);

function field(need: Need, name: string, type: Type, description: string, opts: FieldOpts = {}): Field {
  const rules: Rule[] = [
    ...list(opts.only).map((text) => ({ kind: "only" as const, text })),
    ...list(opts.never).map((text) => ({ kind: "never" as const, text })),
    ...list(opts.must).map((text) => ({ kind: "must" as const, text })),
  ];
  return { name, type, need, description, ...(opts.absent ? { absent: opts.absent } : {}), ...(rules.length ? { rules } : {}) };
}

/** A field every object of its kind has. */
export const req = (name: string, type: Type, description: string, opts?: FieldOpts): Field => field("required", name, type, description, opts);
/** A field that may be left out. */
export const opt = (name: string, type: Type, description: string, opts?: FieldOpts): Field => field("optional", name, type, description, opts);
/** A field that is required in one case and refused in every other. */
export const when = (cond: string, name: string, type: Type, description: string, opts?: FieldOpts): Field => field({ when: cond }, name, type, description, opts);

// ---- the value types every object shares

/** An id: the neutral word a part is known by. */
export const id = alias("id");
/** One plain sentence. */
export const sentence = alias("sentence");
/** A whole number, or the setting that holds it. */
export const amount = alias("amount");
export const condition = alias("condition");
export const name = alias("name");

export interface AliasDef {
  readonly name: string;
  readonly primitive: string;
  readonly description: string;
  readonly detail?: readonly string[];
  readonly values?: readonly EnumValue[];
  readonly examples: readonly string[];
  /** Tells a written value from a wrong one, where a pattern can. */
  readonly pattern?: RegExp;
}

export const ALIASES: readonly AliasDef[] = [
  {
    name: "id",
    primitive: "string",
    description: "The neutral word a part is known by. It starts with a lower-case letter and holds only letters, digits and underscores.",
    detail: [
      "An id never carries a word from a theme: the skin names everything a player sees. A piece is `prize`, and the space theme calls it a loot crate.",
      "Ids are unique among parts of one kind. A setting and an event may share an id, as Paths' `streak` gauge, event and layer do. Two settings may not.",
    ],
    examples: ["paths", "roundSeconds", "prize_floor"],
    pattern: /^[a-z][A-Za-z0-9_]*$/,
  },
  {
    name: "sentence",
    primitive: "string",
    description: "One plain sentence, in English, with no word from a theme. It is read by whoever tunes or builds the puzzle, never by a player.",
    detail: ["Changing a sentence raises no version: wording changes no round."],
    examples: ["kinds dealt; more makes long paths harder to find", "a closed path took every prize"],
  },
  {
    name: "name",
    primitive: "string",
    description: "A short lower-case word the author chooses for something that is not a part of its own: a state, a grade, a preset, a placeholder, a colour.",
    examples: ["hot", "clean", "shark", "count"],
    pattern: /^[a-z][A-Za-z0-9_]*$/,
  },
  {
    name: "version",
    primitive: "string",
    description: "Two whole numbers joined by a dot: `major.minor`. Every puzzle starts at `0.1`.",
    detail: ["The major rises when a change can make a stored round replay differently. The minor rises when any other number changes. See [Versions](/domain/versions)."],
    examples: ["0.1", "2.4", "3.0"],
    pattern: /^\d+\.\d+$/,
  },
  {
    name: "amount",
    primitive: "integer or string",
    description: "A whole number, or the id of the setting that holds it. Written as a number it is fixed. Written as a setting's id it follows that setting, so a tuning panel can change it.",
    detail: ["A setting named here must be of type `whole`."],
    examples: ["8", "\"width\"", "\"maxPrizes\""],
  },
  {
    name: "condition",
    primitive: "string",
    description: "A condition on an event: one comparison of a field of the event or a setting with another, or with a whole number. The loop reads it, so a reader, a board and a skin all know exactly when it holds.",
    detail: [
      "It is written `<left> <op> <right>`, where the op is one of `>=`, `>`, `<=`, `<`, `==` and `!=`. Each side is a whole number, a setting's id, or a field of the event. A field that holds places counts as how many it holds.",
      "A condition joins nothing with `and` or `or` and does no arithmetic. Where a rule needs more, the rules report a field that says so and the condition reads it.",
    ],
    examples: ["prizes > 0", "path >= streakMin"],
  },
  {
    name: "map",
    primitive: "array",
    description: "One hand-drawn map: a row for each row of the board, each row a list with one terrain id for each cell. A plain cell is written `plain`.",
    detail: ["Every map of a setting fills the same board, and passes the check the setting names."],
    examples: ["[[\"plain\", \"wall\"], [\"port\", \"plain\"]]"],
  },
  {
    name: "colour",
    primitive: "string",
    description: "A colour as six hexadecimal digits after a `#`, in the order red, green, blue.",
    examples: [COLOURS.fixed.ground, COLOURS.fixed.yours],
    pattern: /^#[0-9a-fA-F]{6}$/,
  },
  {
    name: "colour name",
    primitive: "string",
    description: "The name of one of the theme's colours. A skin never writes a colour's value: it names a colour, and the theme says what it is.",
    detail: ["It is one of the seven fixed colours, the theme's own name for one of them, or one of the theme's piece colours. See the theme's [palette](/api/theme#palette)."],
    examples: ["yours", "amber", "sky"],
  },
  {
    name: "note",
    primitive: "string",
    description: "A musical note: a letter from A to G, an optional `#` or `b`, and its octave.",
    examples: ["G2", "D4", "F#3"],
    pattern: /^[A-G][#b]?\d$/,
  },
];

/** The values a move, an event or a signal can carry. Each names what travels in the log or on an event. */
export const FIELD_TYPES: Record<string, string> = {
  place: "One place: a cell on the board or a numbered spot in a zone. On a grid a cell is `{ x, y }`, counted from the top left. On rings it is `{ ring, sector }`.",
  places: "A list of places, in order: a path, a group, the cells inside a loop.",
  direction: "One of the ways the board's cells touch: on a grid `up`, `down`, `left` or `right`, and the four diagonals where cells touch on eight.",
  piece: "One piece, or a kind of one: what was taken from a zone, which kind a bounty names.",
  seat: "One seat, as its number.",
  side: "One side, as its number.",
  number: "A whole number.",
  flag: "True or false.",
  points: "The points the event pays. The rules leave it out and the loop fills it in when it pays the event.",
  outcome: "How a round between sides ended: its reason and its placing.",
};

export const fieldTypes = (...names: readonly string[]): Type => en(...names.map((n) => [n, FIELD_TYPES[n]!] as const));
