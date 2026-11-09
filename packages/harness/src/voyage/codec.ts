import { isStation, type Station } from "@openseas/engine";
import type { Content } from "@openseas/content";
import { HAIL_ORDERS, SCRIPT_ACTIONS, defaultScenario, type CrewSpec, type HailOrder, type ScriptAction, type ScriptStep, type VoyageScenario } from "./scenario.js";

/**
 * A voyage scenario as the query string of the voyage page, so a crew worth testing is one link,
 * as a lab round is (ADR 0019):
 *
 *   seed     the voyage's seed
 *   ship     ship class id; lane  lane id
 *   hail     engage, evade or ignore
 *   helm    ai or you
 *   cap      the AI captain's accuracy,aggression in percent
 *   p        a pirate, repeated in boarding order: station~duty~spread~skill~thinkTicks~blade~name
 *            (station `-` for none)
 *   do       a script step, repeated: turn~pirate~action~station (pirate counts from 1)
 *   w.<path> a world override; the value is JSON when it parses, a string otherwise
 *   runs     batch size
 *   start    fly or batch: do that as soon as the page opens
 *
 * Anything absent is the default scenario's.
 */
export type VoyageAutostart = "launch" | "batch" | null;

const SEP = "~";

function parseValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

const num = (raw: string | undefined, fallback: number): number => {
  const n = Number(raw);
  return raw !== undefined && raw !== "" && Number.isFinite(n) ? n : fallback;
};

const stationOf = (raw: string | undefined): Station | null => (raw && isStation(raw) ? raw : null);

function parsePirate(raw: string): CrewSpec {
  const [station, duty, spread, skill, think, blade, ...name] = raw.split(SEP);
  return {
    station: stationOf(station),
    duty: num(duty, 100),
    spread: num(spread, 15),
    sword: { skill: num(skill, 60), thinkTicks: num(think, 14), blade: num(blade, 0) },
    name: name.join(SEP),
  };
}

function formatPirate(c: CrewSpec): string {
  return [c.station ?? "-", c.duty, c.spread, c.sword.skill, c.sword.thinkTicks, c.sword.blade, c.name].join(SEP);
}

function parseStep(raw: string): ScriptStep | null {
  const [turn, who, action, station] = raw.split(SEP);
  if (!SCRIPT_ACTIONS.includes(action as ScriptAction)) return null;
  return { turn: num(turn, 1), who: num(who, 1) - 1, action: action as ScriptAction, station: stationOf(station) };
}

const formatStep = (s: ScriptStep): string => [s.turn, s.who + 1, s.action, s.station ?? "-"].join(SEP);

export function parseVoyage(content: Content, search: string): { scenario: VoyageScenario; autostart: VoyageAutostart } {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const d = defaultScenario(content);
  const world: Record<string, unknown> = {};
  for (const [key, raw] of q.entries()) if (key.startsWith("w.") && key.length > 2) world[key.slice(2)] = parseValue(raw);
  const crew = q.getAll("p").map(parsePirate);
  const script = q.getAll("do").map(parseStep).filter((s): s is ScriptStep => s !== null);
  const [acc, agg] = (q.get("cap") ?? "").split(",");
  const hail = q.get("hail");
  const start = q.get("start");
  return {
    scenario: {
      seed: q.get("seed") || d.seed,
      shipClassId: q.get("ship") || d.shipClassId,
      laneId: q.get("lane") || d.laneId,
      hail: HAIL_ORDERS.includes(hail as HailOrder) ? (hail as HailOrder) : d.hail,
      helm: q.get("helm") === "you" ? "you" : "ai",
      captain: { accuracy: num(acc, d.captain.accuracy), aggression: num(agg, d.captain.aggression) },
      crew: crew.length ? crew : d.crew,
      script,
      world,
      runs: num(q.get("runs") ?? undefined, d.runs),
    },
    autostart: start === "launch" || start === "batch" ? start : null,
  };
}

/** The query string for a scenario, without the leading `?`; only what differs from the default. */
export function formatVoyage(content: Content, sc: VoyageScenario, autostart: VoyageAutostart = null): string {
  const d = defaultScenario(content);
  const q = new URLSearchParams();
  if (sc.seed !== d.seed) q.set("seed", sc.seed);
  if (sc.shipClassId !== d.shipClassId) q.set("ship", sc.shipClassId);
  if (sc.laneId !== d.laneId) q.set("lane", sc.laneId);
  if (sc.hail !== d.hail) q.set("hail", sc.hail);
  if (sc.helm !== d.helm) q.set("helm", sc.helm);
  if (sc.captain.accuracy !== d.captain.accuracy || sc.captain.aggression !== d.captain.aggression) q.set("cap", `${sc.captain.accuracy},${sc.captain.aggression}`);
  const crew = sc.crew.map(formatPirate);
  if (JSON.stringify(crew) !== JSON.stringify(d.crew.map(formatPirate))) for (const p of crew) q.append("p", p);
  for (const s of sc.script) q.append("do", formatStep(s));
  for (const [path, value] of Object.entries(sc.world)) q.set(`w.${path}`, typeof value === "string" ? value : JSON.stringify(value));
  if (sc.runs !== d.runs) q.set("runs", String(sc.runs));
  if (autostart) q.set("start", autostart);
  return q.toString();
}
