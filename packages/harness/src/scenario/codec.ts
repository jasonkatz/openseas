import type { Overrides } from "./overrides.js";

/**
 * Everything a lab round needs, as the query string of a puzzle page, so a condition worth
 * testing is one link: `/gunnery?seed=keg-3&seconds=60&c.spawnEveryTicks=20&start=lab`.
 *
 *   seed        the engine seed; absent means a fresh random seed each start
 *   seconds     round length; absent means the content round length
 *   c.<path>    a config override; the value is JSON when it parses, a string otherwise
 *   speed       clock rate for lab rounds (default 1)
 *   paused      1 to start with the clock stopped
 *   hints       0 to turn idle hints off in a lab round (they are on, as in unrated practice)
 *   start       lab, unrated or recorded: start that round as soon as the page opens (rated, the
 *               old name for recorded, still works in links made before ADR 0028)
 *   review      1: review the round file left in sessionStorage by the home page
 */
export interface Scenario {
  seed: string | null;
  roundSeconds: number | null;
  overrides: Overrides;
  speed: number;
  paused: boolean;
  hints: boolean;
  autostart: "lab" | "unrated" | "recorded" | null;
  review: boolean;
}

export const EMPTY_SCENARIO: Scenario = { seed: null, roundSeconds: null, overrides: {}, speed: 1, paused: false, hints: true, autostart: null, review: false };

export const SPEEDS = [0.25, 0.5, 1, 2, 4] as const;

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
  const speed = Number(q.get("speed"));
  const start = q.get("start");
  return {
    seed: q.get("seed") || null,
    roundSeconds: Number.isInteger(seconds) && seconds > 0 ? seconds : null,
    overrides,
    speed: speed > 0 ? speed : 1,
    paused: q.get("paused") === "1",
    hints: q.get("hints") !== "0",
    autostart: start === "lab" || start === "unrated" || start === "recorded" ? start : start === "rated" ? "recorded" : null,
    review: q.get("review") === "1",
  };
}

/** The query string for a scenario, without the leading `?`. Empty when nothing differs from a plain visit. */
export function formatScenario(s: Scenario): string {
  const q = new URLSearchParams();
  if (s.seed) q.set("seed", s.seed);
  if (s.roundSeconds !== null) q.set("seconds", String(s.roundSeconds));
  for (const [path, value] of Object.entries(s.overrides)) q.set(`c.${path}`, typeof value === "string" ? value : JSON.stringify(value));
  if (s.speed !== 1) q.set("speed", String(s.speed));
  if (s.paused) q.set("paused", "1");
  if (!s.hints) q.set("hints", "0");
  if (s.autostart) q.set("start", s.autostart);
  return q.toString();
}

/** A link that opens the page on this scenario and starts the lab round at once. */
export function shareLink(origin: string, pathname: string, s: Scenario): string {
  const qs = formatScenario({ ...s, autostart: "lab", review: false });
  return `${origin}${pathname}${qs ? `?${qs}` : ""}`;
}
