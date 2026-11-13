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
  speed: number;
  paused: boolean;
  hints: boolean;
  autostart: boolean | null;
}

export const EMPTY_SCENARIO: Scenario = { seed: null, roundSeconds: null, overrides: {}, paceSeconds: null, thresholds: null, speed: 1, paused: false, hints: true, autostart: null };

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
