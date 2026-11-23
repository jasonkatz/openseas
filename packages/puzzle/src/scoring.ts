/**
 * How points are worked out (docs/puzzles/DOMAIN.md, "Scoring"). A payout's points come from its
 * growth and the setting that sizes it; multipliers that meet on one event multiply together and the
 * result is rounded down once, for the event; and the event's points are split by payout, so a round
 * can always be broken down.
 */
import type { MultiplierDecl, PayoutDecl } from "./document.js";
import type { SettingsReader } from "./settings.js";

/** A table's entry for a count, counted from 1. The last entry holds. */
export function stepped(table: readonly number[], count: number): number {
  if (table.length === 0 || count < 1) return 0;
  return table[Math.min(count, table.length) - 1]!;
}

/** What a payout pays for a count, before any multiplier. */
export function payoutPoints(payout: PayoutDecl, count: number | null, settings: SettingsReader): number {
  const size = payout.reads[0];
  if (size === undefined) throw new Error(`payout ${payout.id} reads no setting to size it`);
  if (payout.growth === "flat") return settings.number(size);
  if (count === null) throw new Error(`payout ${payout.id} grows, so it must count a field`);
  if (!Number.isInteger(count) || count < 0) throw new Error(`payout ${payout.id} counted ${count}`);
  if (payout.growth === "stepped") return stepped(settings.list(size), count);
  // Past its cap a payout grows no faster: the count stops there.
  const n = payout.cap === undefined ? count : Math.min(count, settings.sized(payout.cap));
  return payout.growth === "linear" ? settings.number(size) * n : settings.number(size) * n * n;
}

/** The percent a multiplier scales by now: its setting, or its table's entry for the streak or the cascade's step. */
export function multiplierPercent(m: MultiplierDecl, settings: SettingsReader, streak: number, step: number): number {
  if ("percent" in m.by) return settings.number(m.by.percent);
  const table = settings.list(m.by.table);
  // A streak of n successes in a row reads the entry after them, so the first success is paid at the first entry.
  return stepped(table, m.by.index === "streak" ? streak + 1 : step);
}

export interface Paid {
  readonly points: number;
  /** The event's points by payout. They sum to `points`. */
  readonly paid: Readonly<Record<string, number>>;
}

/**
 * One event's points. Each payout is scaled by the multipliers that scale it, the sum is rounded
 * down once, and the whole points are shared out by payout: each takes its own rounded down, and
 * the points left over go one each to the payouts that lost the largest fraction, in the order
 * they were paid.
 */
export function settleEvent(pays: readonly { readonly payout: string; readonly base: number }[], multipliers: readonly { readonly percent: number; readonly scales: readonly string[] }[]): Paid {
  if (pays.length === 0) return { points: 0, paid: {} };
  const denominator = 100n ** BigInt(multipliers.length);
  const exact = pays.map((p) => {
    let n = BigInt(p.base);
    for (const m of multipliers) n *= m.scales.includes(p.payout) ? BigInt(m.percent) : 100n;
    return n;
  });
  const total = exact.reduce((a, b) => a + b, 0n) / denominator;
  const shares = exact.map((n) => n / denominator);
  let left = total - shares.reduce((a, b) => a + b, 0n);
  const byLoss = exact.map((n, i) => ({ i, loss: n % denominator })).sort((x, y) => (x.loss === y.loss ? x.i - y.i : x.loss > y.loss ? -1 : 1));
  for (const { i } of byLoss) {
    if (left <= 0n) break;
    shares[i] = shares[i]! + 1n;
    left -= 1n;
  }
  const points = Number(total);
  if (!Number.isSafeInteger(points)) throw new Error("an event's points are too large to count");
  const paid: Record<string, number> = {};
  pays.forEach((p, i) => {
    paid[p.payout] = (paid[p.payout] ?? 0) + Number(shares[i]!);
  });
  return { points, paid };
}
