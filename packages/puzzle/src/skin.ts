/**
 * The skin and the theme (docs/puzzles/DOMAIN.md, "The skin", "Themes"), as documents, and when each
 * is ready. Neither sets a number a round plays, so nothing here reaches the rules: a host reads
 * them to dress a round.
 */
import { requiredTexts } from "./check.js";
import type { ChangeKind, PuzzleDoc } from "./document.js";

export type Ease = "linear" | "in" | "out" | "in-out";

export interface Motion {
  /** Each board change's length and easing, eased out when it names none, and how a piece leaves. */
  readonly changes: { readonly [K in ChangeKind]: { readonly ms: number; readonly ease?: Ease; readonly as?: "shrink" | "fade" } };
  /** Milliseconds between the places of one event. */
  readonly stagger: number;
  /** The pulse: its length, its colour, and how strongly it covers the board, from the smallest moment to the biggest, each 0 to 1. */
  readonly beat: { readonly ms: number; readonly color: string; readonly strength: { readonly from: number; readonly to: number } };
  readonly reduced: { readonly changes: "cut" | "as-is"; readonly beat: "still" | "as-is" };
}

export interface SkinEvent {
  readonly cues?: readonly string[];
  readonly marks?: readonly ({ readonly ring: string } | { readonly line: string })[];
  /** The place field the event's points rise from. */
  readonly points?: string;
  /** The callout's rank, 1 the highest. An entry shows at most one: the highest it earned. */
  readonly callout?: number;
}

/** A drawing: shapes on a 24-unit square in one of the theme's colours. Its layers are the painter's to read. */
export interface SkinDrawing {
  readonly tint?: string;
  readonly over?: string;
  readonly layers: readonly unknown[];
  readonly count?: unknown;
}

/** A cue: a short synthesized sound. Its voices are the player's to read; the checks read only what the sound frame limits. */
export interface SkinCue {
  readonly cutoff: number;
  readonly voices: readonly { readonly kind: string; readonly note?: number; readonly at: number; readonly attack: number; readonly release: number }[];
}

export interface Skin {
  readonly puzzle: string;
  readonly theme: string;
  readonly pieces: Readonly<Record<string, SkinDrawing | Readonly<Record<string, SkinDrawing>>>>;
  readonly cues: Readonly<Record<string, SkinCue>>;
  readonly motion: Motion;
  readonly events: Readonly<Record<string, SkinEvent>>;
  readonly texts: Readonly<Record<string, string>>;
  /**
   * What the board itself shows of a gauge: rows counted from the bottom or the top, washed in one
   * of the theme's colours. The guide does not yet say how a gauge is drawn on a board (ADR 0088).
   */
  readonly board?: { readonly gauges?: Readonly<Record<string, { readonly rows: "bottom" | "top"; readonly color: string }>> };
}

export const FIXED_COLOURS = ["ground", "raised", "line", "text", "dim", "yours", "danger"] as const;
export const HOST_TEXTS = ["tier.green", "tier.steady", "tier.sharp", "tier.masterful", "tier.legendary", "start", "countdown", "end"] as const;
/** The events every host has, the same for every puzzle, that a skin voices. */
export const HOST_EVENTS = ["start", "countdown", "end"] as const;

export interface Theme {
  readonly id: string;
  readonly palette: {
    readonly fixed: Readonly<Record<(typeof FIXED_COLOURS)[number], string>>;
    readonly pieces: Readonly<Record<string, string>>;
    readonly names?: Readonly<Record<string, string>>;
  };
  readonly type: { readonly faces: { readonly text: string; readonly numbers: string }; readonly sizes: Readonly<Record<string, { readonly px: number; readonly weight: "regular" | "bold" }>> };
  /** The sound frame: how many notes the scale has, the longest cue and the highest cutoff. */
  readonly sound: { readonly scale: readonly string[]; readonly longestMs: number; readonly cutoff: number };
  readonly cues: Readonly<Record<string, SkinCue>>;
  readonly motion: Motion;
  readonly texts: Readonly<Record<string, string>>;
}

/** The colours a skin may name: the theme's fixed colours, its own names for them, and its piece colours. */
export function themeColours(theme: Theme): ReadonlySet<string> {
  return new Set([...FIXED_COLOURS, ...Object.values(theme.palette.names ?? {}), ...Object.keys(theme.palette.pieces)]);
}

const cueMs = (c: SkinCue): number => Math.round(c.voices.reduce((end, v) => Math.max(end, v.at + v.attack + v.release), 0) * 1000);

/** How a cue breaks the theme's sound frame. The beat's cue is heard alone and may ring longer, so its length is not held. */
function cueProblems(name: string, cue: SkinCue, theme: Theme): string[] {
  const out: string[] = [];
  if (cue.cutoff > theme.sound.cutoff) out.push(`cue ${name} is brighter than the theme's ${theme.sound.cutoff} Hz`);
  if (name !== "beat" && cueMs(cue) > theme.sound.longestMs) out.push(`cue ${name} is longer than the theme's ${theme.sound.longestMs} ms`);
  for (const v of cue.voices) if (v.kind === "tone" && (!Number.isInteger(v.note) || v.note! < 0 || v.note! >= theme.sound.scale.length)) out.push(`cue ${name} plays a note outside the theme's scale`);
  return out;
}

function motionProblems(what: string, m: Motion, colours: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const kind of ["arrive", "leave", "travel", "change"] as const) {
    const c = m.changes[kind];
    if (!c || !(c.ms >= 0) || (c.ease !== undefined && !["linear", "in", "out", "in-out"].includes(c.ease))) out.push(`${what} has no motion for a piece that ${kind}s`);
  }
  if (!(m.stagger >= 0)) out.push(`${what} has no stagger`);
  if (!m.beat || !(m.beat.ms > 0) || !colours.has(m.beat.color)) out.push(`${what} has no beat in one of the theme's colours`);
  else if (!(m.beat.strength?.from >= 0 && m.beat.strength.to >= m.beat.strength.from && m.beat.strength.to <= 1)) out.push(`${what}'s beat needs a strength that rises, from 0 to 1`);
  if (!m.reduced) out.push(`${what} does not say what reduced motion does`);
  return out;
}

/** Every way a theme falls short of ready, apart from holding a skin for every puzzle, which its host checks. */
export function checkTheme(theme: Theme): string[] {
  const out: string[] = [];
  for (const c of FIXED_COLOURS) if (!theme.palette.fixed[c]) out.push(`the fixed colour ${c} is not filled`);
  if (Object.keys(theme.palette.pieces).length < 8) out.push("a theme has at least eight piece colours");
  if (!theme.type.faces.text || !theme.type.faces.numbers || Object.keys(theme.type.sizes).length === 0) out.push("the type names its faces and sizes");
  if (theme.sound.scale.length === 0 || !(theme.sound.longestMs > 0) || !(theme.sound.cutoff > 0)) out.push("the sound frame needs a scale and its limits");
  for (const [name, cue] of Object.entries(theme.cues)) out.push(...cueProblems(name, cue, theme));
  out.push(...motionProblems("the theme", theme.motion, themeColours(theme)));
  for (const k of HOST_TEXTS) if (!theme.texts[k]) out.push(`the host text ${k} is missing`);
  return out;
}

/** Every way a skin falls short of ready against its puzzle and its theme. */
export function checkSkin(doc: PuzzleDoc, skin: Skin, theme: Theme): string[] {
  const out: string[] = [];
  if (skin.puzzle !== doc.id) out.push(`the skin dresses ${skin.puzzle}, not ${doc.id}`);
  if (skin.theme !== theme.id) out.push(`the skin names the theme ${skin.theme}, not ${theme.id}`);
  const colours = themeColours(theme);

  // A drawing for every piece, state and kind.
  const drawing = (key: string): void => {
    const d = skin.pieces[key];
    if (!d) return void out.push(`no drawing for ${key}`);
    for (const one of "layers" in d ? [d as SkinDrawing] : Object.values(d)) if (one.tint !== undefined && !colours.has(one.tint)) out.push(`the drawing of ${key} wears ${one.tint}, which is not one of the theme's colours`);
  };
  for (const p of doc.pieces) {
    const family = doc.settings.find((s) => s.id === p.family);
    if (family?.max !== undefined) for (let k = 1; k <= family.max; k++) drawing(`${p.id}_${k}`);
    else {
      drawing(p.id);
      const d = skin.pieces[p.id];
      if (Array.isArray(p.states) && d && !("layers" in d)) for (const s of p.states) if (!(s in d)) out.push(`no drawing for ${p.id} when it is ${s}`);
    }
  }

  // Events: cues that exist, marks and points from the event's own places, a text for every callout.
  const events = new Map(doc.events.map((e) => [e.id, e]));
  for (const [id, e] of Object.entries(skin.events)) {
    const decl = events.get(id);
    if (!decl && !(HOST_EVENTS as readonly string[]).includes(id)) {
      out.push(`the skin dresses ${id}, which is not an event`);
      continue;
    }
    for (const c of e.cues ?? []) {
      if (!skin.cues[c]) out.push(`${id} plays ${c}, which the skin has no cue for`);
      if (c === "beat") out.push(`${id} plays the beat's cue, which is heard alone on the moment`);
    }
    const places = (field: string): boolean => decl !== undefined && (decl.fields[field] === "place" || decl.fields[field] === "places");
    for (const m of e.marks ?? []) {
      const field = "ring" in m ? m.ring : m.line;
      if (!places(field)) out.push(`${id} is marked from ${field}, which is not one of its place fields`);
    }
    if (e.points !== undefined && !places(e.points)) out.push(`${id}'s points rise from ${e.points}, which is not one of its place fields`);
    if (e.callout !== undefined) {
      if (!(Number.isInteger(e.callout) && e.callout >= 1)) out.push(`${id}'s callout needs a rank from 1`);
      if (!skin.texts[`event.${id}`]) out.push(`${id} has a callout and no text event.${id}`);
    }
  }
  for (const [id, g] of Object.entries(skin.board?.gauges ?? {})) {
    if (!doc.gauges.some((x) => x.id === id)) out.push(`the board shows ${id}, which is not a gauge`);
    if (!colours.has(g.color)) out.push(`the board shows ${id} in ${g.color}, which is not one of the theme's colours`);
  }
  if (!skin.cues["beat"]) out.push("the skin has no beat cue");
  for (const [name, cue] of Object.entries(skin.cues)) out.push(...cueProblems(name, cue, theme));
  out.push(...motionProblems("the skin", skin.motion, colours));

  // A text for every key, keeping its placeholders.
  const declared = new Map(doc.texts.map((t) => [t.key, t.placeholders ?? []]));
  for (const key of new Set([...requiredTexts(doc), ...declared.keys()])) {
    const text = skin.texts[key];
    if (text === undefined || text.trim() === "") out.push(`no text for ${key}`);
    else for (const p of declared.get(key) ?? []) if (!text.includes(`{${p}}`)) out.push(`the text for ${key} lost its place for {${p}}`);
  }
  return out;
}
