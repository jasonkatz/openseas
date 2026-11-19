import { CueDataSchema, DrawingSchema, NO_LOOK, NO_WORDS, WordsSchema, type CueData, type Drawing, type Look, type Words } from "@openseas/protocol";
import type { Overrides } from "./overrides.js";

/**
 * A draft as the query string of a puzzle's page, on the studio and on `/play` alike, so a tuned
 * round is one link: `/play/gunnery?seed=keg-3&seconds=60&c.spawnEveryTicks=20`.
 *
 *   seed        the engine seed; absent means a fresh random seed each start
 *   seconds     round length; absent means the content round length
 *   c.<path>    a config override; the value is JSON when it parses, a string otherwise
 *   pace        the live tier indicator's window in seconds; absent means content's `paceSeconds`
 *   thresholds  the thresholds the round is rated against, as JSON; absent means content's
 *   stage       the stage of the puzzle's ladder to deal (ADR 0066), by its id; absent means the whole puzzle
 *   text.<key>      a string of the message table rewritten (ADR 0057), by its key
 *   category        the puzzle's category, where the draft changes it
 *   piece.<name>    a piece redrawn (ADR 0065): its drawing, as JSON
 *   cue.<name>      a cue revoiced (ADR 0065): its voices and rules, as JSON
 *   speed       clock rate (default 1); the transport bar sets it (ADR 0068)
 *   paused      1 to start with the clock stopped; for a script, as above
 *   hints       0 to turn idle hints off
 *   start       any value: start the round as soon as the page opens
 *
 * An address kept from before ADR 0062 may also carry a pick of a take: `sprite.<frame>=<hash>`,
 * for a frame of the puzzle's atlas, or `sound.<cue>=<hash>` (or `=synth`), for a cue. Nothing
 * draws a frame or plays a sample now, so such a parameter is read past like any the page does
 * not know: the address still opens, on the board as it is drawn and sounded, and the parameter
 * is not written back (ADR 0063, ADR 0064).
 */
export interface Scenario {
  seed: string | null;
  /** The stage of the puzzle's ladder the round is dealt at (ADR 0066); null is the whole puzzle. A play setting, like the seed: a draft's numbers are laid over it and it is not saved with them. */
  stage: string | null;
  roundSeconds: number | null;
  overrides: Overrides;
  paceSeconds: number | null;
  /** Unchecked: whatever JSON the link carried. The frame's checks decide whether it can be played. */
  thresholds: unknown;
  /** The strings rewritten and the category changed (ADR 0057). Only what has their shape is kept from a link. */
  words: Words;
  /** The pieces redrawn and the cues revoiced (ADR 0065). Only what has their shape is kept from a link. */
  look: Look;
  speed: number;
  paused: boolean;
  hints: boolean;
  autostart: boolean | null;
}

export const EMPTY_SCENARIO: Scenario = { seed: null, stage: null, roundSeconds: null, overrides: {}, paceSeconds: null, thresholds: null, words: NO_WORDS, look: NO_LOOK, speed: 1, paused: false, hints: true, autostart: null };

function parseValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function parseScenario(search: string): Scenario {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const overrides: Record<string, unknown> = {};
  for (const [key, raw] of q.entries()) if (key.startsWith("c.") && key.length > 2) overrides[key.slice(2)] = parseValue(raw);
  // A rewritten string that is not one (cut short in a pasted link) is dropped, each on its own.
  const texts: Record<string, string> = {};
  for (const [key, raw] of q.entries()) if (key.startsWith("text.") && key.length > 5 && WordsSchema.safeParse({ texts: { [key.slice(5)]: raw } }).success) texts[key.slice(5)] = raw;
  const category = WordsSchema.safeParse({ category: q.get("category") });
  const words: Words = { texts, category: category.success ? category.data.category : null };
  // A drawing or a cue that is not one (cut short in a pasted link) is dropped, each on its own.
  const pieces: Record<string, Drawing> = {};
  const cues: Record<string, CueData> = {};
  for (const [key, raw] of q.entries()) {
    if (key.startsWith("piece.") && key.length > 6) {
      const d = DrawingSchema.safeParse(parseValue(raw));
      if (d.success) pieces[key.slice(6)] = d.data;
    } else if (key.startsWith("cue.") && key.length > 4) {
      const c = CueDataSchema.safeParse(parseValue(raw));
      if (c.success) cues[key.slice(4)] = c.data;
    }
  }
  const seconds = Number(q.get("seconds"));
  const pace = Number(q.get("pace"));
  const speed = Number(q.get("speed"));
  const start = q.get("start");
  return {
    seed: q.get("seed") || null,
    stage: /^[a-z]+$/.test(q.get("stage") ?? "") && q.get("stage") !== "full" ? q.get("stage") : null,
    roundSeconds: Number.isInteger(seconds) && seconds > 0 ? seconds : null,
    overrides,
    paceSeconds: q.has("pace") && Number.isFinite(pace) ? pace : null,
    thresholds: q.has("thresholds") ? parseValue(q.get("thresholds")!) : null,
    words,
    look: { pieces, cues },
    speed: speed > 0 ? speed : 1,
    paused: q.get("paused") === "1",
    hints: q.get("hints") !== "0",
    autostart: start ? true : null,
  };
}

/** The query string for a scenario, without the leading `?`. Empty when nothing differs from a plain visit. */
export function formatScenario(s: Scenario): string {
  const q = new URLSearchParams();
  if (s.seed) q.set("seed", s.seed);
  if (s.stage) q.set("stage", s.stage);
  if (s.roundSeconds !== null) q.set("seconds", String(s.roundSeconds));
  for (const [path, value] of Object.entries(s.overrides)) q.set(`c.${path}`, typeof value === "string" ? value : JSON.stringify(value));
  if (s.paceSeconds !== null) q.set("pace", String(s.paceSeconds));
  if (s.thresholds !== null) q.set("thresholds", JSON.stringify(s.thresholds));
  for (const [key, text] of Object.entries(s.words.texts)) q.set(`text.${key}`, text);
  if (s.words.category) q.set("category", s.words.category);
  for (const [name, d] of Object.entries(s.look.pieces)) q.set(`piece.${name}`, JSON.stringify(d));
  for (const [name, c] of Object.entries(s.look.cues)) q.set(`cue.${name}`, JSON.stringify(c));
  if (s.speed !== 1) q.set("speed", String(s.speed));
  if (s.paused) q.set("paused", "1");
  if (!s.hints) q.set("hints", "0");
  if (s.autostart) q.set("start", "1");
  return q.toString();
}

/** The link that plays this scenario alone: its puzzle's `/play` page on the same numbers, for a tester. */
export function playLink(origin: string, puzzle: string, s: Scenario): string {
  const qs = formatScenario({ ...s, autostart: null, speed: 1, paused: false });
  return `${origin}/play/${puzzle}${qs ? `?${qs}` : ""}`;
}
