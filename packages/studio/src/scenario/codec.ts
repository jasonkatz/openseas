import { NO_PICKS, PicksSchema, type Picks } from "@openseas/protocol";
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
 *   sprite.<frame>  a pick (ADR 0052): the hash of the take drawn for that frame
 *   sound.<cue>     a pick: the hash of the take played for that cue, or `synth` for the synthesized cue
 *   speed       clock rate (default 1); for a script, the studio has no control for it
 *   paused      1 to start with the clock stopped; for a script, as above
 *   hints       0 to turn idle hints off
 *   start       any value: start the round as soon as the page opens
 */
export interface Scenario {
  seed: string | null;
  roundSeconds: number | null;
  overrides: Overrides;
  paceSeconds: number | null;
  /** Unchecked: whatever JSON the link carried. The frame's checks decide whether it can be played. */
  thresholds: unknown;
  /** The takes picked for frames and cues. Only what has a pick's shape is kept from a link. */
  picks: Picks;
  speed: number;
  paused: boolean;
  hints: boolean;
  autostart: boolean | null;
}

export const EMPTY_SCENARIO: Scenario = { seed: null, roundSeconds: null, overrides: {}, paceSeconds: null, thresholds: null, picks: NO_PICKS, speed: 1, paused: false, hints: true, autostart: null };

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
  const picked = { sprites: {} as Record<string, string>, sounds: {} as Record<string, string> };
  for (const [key, raw] of q.entries()) {
    if (key.startsWith("sprite.") && key.length > 7) picked.sprites[key.slice(7)] = raw;
    else if (key.startsWith("sound.") && key.length > 6) picked.sounds[key.slice(6)] = raw;
  }
  // A pick that is not one (a hash cut short in a pasted link) is dropped, each on its own.
  const picks: Picks = { sprites: {}, sounds: {} };
  for (const [name, hash] of Object.entries(picked.sprites)) if (PicksSchema.safeParse({ sprites: { [name]: hash } }).success) picks.sprites[name] = hash;
  for (const [name, hash] of Object.entries(picked.sounds)) if (PicksSchema.safeParse({ sounds: { [name]: hash } }).success) picks.sounds[name] = hash as Picks["sounds"][string];
  const seconds = Number(q.get("seconds"));
  const pace = Number(q.get("pace"));
  const speed = Number(q.get("speed"));
  const start = q.get("start");
  return {
    seed: q.get("seed") || null,
    roundSeconds: Number.isInteger(seconds) && seconds > 0 ? seconds : null,
    overrides,
    paceSeconds: q.has("pace") && Number.isFinite(pace) ? pace : null,
    thresholds: q.has("thresholds") ? parseValue(q.get("thresholds")!) : null,
    picks,
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
  if (s.roundSeconds !== null) q.set("seconds", String(s.roundSeconds));
  for (const [path, value] of Object.entries(s.overrides)) q.set(`c.${path}`, typeof value === "string" ? value : JSON.stringify(value));
  if (s.paceSeconds !== null) q.set("pace", String(s.paceSeconds));
  if (s.thresholds !== null) q.set("thresholds", JSON.stringify(s.thresholds));
  for (const [name, hash] of Object.entries(s.picks.sprites)) q.set(`sprite.${name}`, hash);
  for (const [name, hash] of Object.entries(s.picks.sounds)) q.set(`sound.${name}`, hash);
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
