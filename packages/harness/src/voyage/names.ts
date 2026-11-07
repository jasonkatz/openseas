import { t } from "@openseas/boards";
import type { CrewSpec } from "./scenario.js";
import type { SimEntry } from "./sim.js";

/** A pirate's display name: their own, or "Pirate n" by boarding order (from 1). */
export const pirateName = (crew: readonly CrewSpec[], i: number): string => crew[i]?.name.trim() || t("harness.voyage.pirate_n", { n: i + 1 });

/**
 * Names for every id a voyage's log can carry: `p<n>` is the scenario's pirate n, `mate:<seq>` a
 * deckhand, numbered in the order they signed on, so the log reads like a ship's log.
 */
export function namer(crew: readonly CrewSpec[], log: readonly SimEntry[]): (id: string) => string {
  const hands = new Map<string, number>();
  for (const e of log) if (e.kind === "hired" && !hands.has(String(e.vars.who))) hands.set(String(e.vars.who), hands.size + 1);
  return (id) => {
    if (id.startsWith("mate:")) return t("harness.voyage.deckhand_n", { n: hands.get(id) ?? 0 });
    const n = Number(id.slice(1));
    return Number.isInteger(n) && n >= 1 ? pirateName(crew, n - 1) : id;
  };
}

export const stationName = (s: string): string => (s ? t(`station.${s}`) : t("harness.voyage.no_station"));
