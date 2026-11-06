/**
 * Many voyages of one scenario, each on its own seed, with the AI at the wheel: how the ship and
 * crew fare on average and how widely. And the replay proof: a voyage's logs, sailed again from
 * their seeds through the reducers, give the same hash after every move (ADR 0003).
 */

import {
  STATIONS,
  hashBattleState,
  hashShipState,
  hashSwordfightState,
  reduceShip,
  createShip,
  createBattleGame,
  reduceBattle,
  createSwordfightGame,
  reduceSwordfight,
  type ShipBattleOutcome,
  type Station,
} from "@openseas/engine";
import type { VoyageSetup } from "./scenario.js";
import { averageOutputs, sailVoyage, type SimPhase, type VoyageSim } from "./sim.js";

export interface RunSummary {
  readonly seed: string;
  readonly phase: SimPhase;
  /** Turns from sailing to the end of the voyage. */
  readonly turns: number;
  readonly hailedBy: string | null;
  readonly engaged: boolean;
  /** How the sea battle ended, or null without one. When a melee followed, how the melee ended. */
  readonly outcome: ShipBattleOutcome | null;
  readonly boarding: boolean;
  readonly battleTurns: number;
  readonly hits: number;
  readonly hitsTaken: number;
  readonly booty: number;
  readonly peakWater: number;
  readonly peakDamage: number;
  readonly meanSpeed: number;
  readonly outputs: Readonly<Record<Station, number>>;
}

export function summarize(sim: VoyageSim): RunSummary {
  const hailed = sim.log.find((e) => e.kind === "hailed");
  const battle = sim.battles[0] ?? null;
  const melee = sim.melees[0] ?? null;
  const last = battle ? battle.states[battle.states.length - 1]! : null;
  const sailing = sim.samples.filter((s) => !s.held);
  return {
    seed: sim.setup.seed,
    phase: sim.phase,
    turns: sim.samples.length,
    hailedBy: hailed ? String(hailed.vars.tier) : null,
    engaged: battle !== null,
    outcome: melee?.outcome ?? battle?.outcome ?? null,
    boarding: melee !== null,
    battleTurns: last?.turn ?? 0,
    hits: last?.hits ?? 0,
    hitsTaken: last?.hitsTaken ?? 0,
    booty: Object.values(sim.booty).reduce((a, b) => a + b, 0),
    peakWater: Math.max(0, ...sim.samples.map((s) => s.water)),
    peakDamage: Math.max(0, ...sim.samples.map((s) => s.damage)),
    meanSpeed: sailing.length ? Math.round(sailing.reduce((n, s) => n + s.speed, 0) / sailing.length) : 0,
    outputs: averageOutputs(sim.samples),
  };
}

/** The seed of run `i` (from 0) of a batch on `seed`. */
export const batchSeed = (seed: string, i: number): string => `${seed}#${i + 1}`;

/**
 * Sail `runs` voyages, yielding to the page between them so it stays responsive and can show
 * progress. Stops early, with what it has, when `signal` aborts.
 */
export async function runBatch(setup: VoyageSetup, runs: number, onProgress?: (done: number) => void, signal?: AbortSignal): Promise<RunSummary[]> {
  const out: RunSummary[] = [];
  let lastYield = Date.now();
  for (let i = 0; i < runs; i++) {
    if (signal?.aborted) break;
    out.push(summarize(sailVoyage({ ...setup, seed: batchSeed(setup.seed, i) })));
    if (Date.now() - lastYield > 30) {
      onProgress?.(out.length);
      await new Promise((r) => setTimeout(r, 0));
      lastYield = Date.now();
    }
  }
  onProgress?.(out.length);
  return out;
}

/** What a batch comes to. Rates are percent of runs; quantiles are over the runs that reached port. */
export interface BatchStats {
  readonly runs: number;
  readonly arrived: number;
  readonly adrift: number;
  readonly abandoned: number;
  readonly turns: { readonly min: number; readonly median: number; readonly p90: number; readonly max: number; readonly mean: number } | null;
  readonly hailed: number;
  readonly engaged: number;
  readonly outcomes: Readonly<Partial<Record<ShipBattleOutcome, number>>>;
  readonly boardings: number;
  /** Fights won, of fights engaged, in percent. */
  readonly winRate: number | null;
  readonly meanBattleTurns: number | null;
  readonly meanHits: number | null;
  readonly meanHitsTaken: number | null;
  readonly meanBooty: number;
  readonly meanPeakWater: number;
  readonly meanPeakDamage: number;
  readonly meanSpeed: number;
  readonly outputs: Readonly<Record<Station, number>>;
  /** Hail counts per tier. */
  readonly tiers: Readonly<Record<string, number>>;
}

const mean = (xs: readonly number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function quantile(sorted: readonly number[], q: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[i]!;
}

export function batchStats(runs: readonly RunSummary[]): BatchStats {
  const arrived = runs.filter((r) => r.phase === "arrived");
  const turns = arrived.map((r) => r.turns).sort((a, b) => a - b);
  const fights = runs.filter((r) => r.engaged);
  const outcomes: Partial<Record<ShipBattleOutcome, number>> = {};
  for (const r of fights) if (r.outcome) outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
  const tiers: Record<string, number> = {};
  for (const r of runs) if (r.hailedBy) tiers[r.hailedBy] = (tiers[r.hailedBy] ?? 0) + 1;
  const won = fights.filter((r) => r.outcome === "boarded" || r.outcome === "crippled").length;
  const outputs = Object.fromEntries(STATIONS.map((st) => [st, Math.round(mean(runs.map((r) => r.outputs[st])))])) as Record<Station, number>;
  return {
    runs: runs.length,
    arrived: arrived.length,
    adrift: runs.filter((r) => r.phase === "adrift").length,
    abandoned: runs.filter((r) => r.phase === "abandoned").length,
    turns: turns.length ? { min: turns[0]!, median: quantile(turns, 0.5), p90: quantile(turns, 0.9), max: turns[turns.length - 1]!, mean: mean(turns) } : null,
    hailed: runs.filter((r) => r.hailedBy !== null).length,
    engaged: fights.length,
    outcomes,
    boardings: runs.filter((r) => r.boarding).length,
    winRate: fights.length ? (won * 100) / fights.length : null,
    meanBattleTurns: fights.length ? mean(fights.map((r) => r.battleTurns)) : null,
    meanHits: fights.length ? mean(fights.map((r) => r.hits)) : null,
    meanHitsTaken: fights.length ? mean(fights.map((r) => r.hitsTaken)) : null,
    meanBooty: mean(runs.map((r) => r.booty)),
    meanPeakWater: mean(runs.map((r) => r.peakWater)),
    meanPeakDamage: mean(runs.map((r) => r.peakDamage)),
    meanSpeed: mean(runs.map((r) => r.meanSpeed)),
    outputs,
    tiers,
  };
}

export interface Proof {
  readonly ok: boolean;
  /** Moves replayed across the ship's log, every battle's and every melee's. */
  readonly moves: number;
  /** Where the first difference was, or null. */
  readonly mismatch: { readonly log: string; readonly move: number } | null;
}

/**
 * Sail the voyage's logs again from their seeds and compare every hash: the ship's log through the
 * ship reducer, each battle's through the battle reducer, each melee's through the swordfight's.
 */
export function proveVoyage(sim: VoyageSim): Proof {
  let moves = 0;
  let ship = createShip(sim.setup.seed, sim.setup.ship, sim.setup.islandId);
  for (let i = 0; i < sim.shipMoves.length; i++) {
    ship = reduceShip(ship, sim.shipMoves[i]!);
    moves += 1;
    if (hashShipState(ship) !== sim.shipHashes[i]) return { ok: false, moves, mismatch: { log: "ship", move: i + 1 } };
  }
  for (const [n, b] of sim.battles.entries()) {
    let s = createBattleGame(b.seed, b.config);
    for (let i = 0; i < b.moves.length; i++) {
      s = reduceBattle(s, b.moves[i]!);
      moves += 1;
      if (hashBattleState(s) !== b.hashes[i]) return { ok: false, moves, mismatch: { log: `battle ${n + 1}`, move: i + 1 } };
    }
  }
  for (const [n, m] of sim.melees.entries()) {
    let s = createSwordfightGame(m.seed, m.config);
    for (let i = 0; i < m.moves.length; i++) {
      s = reduceSwordfight(s, m.moves[i]!);
      moves += 1;
      if (hashSwordfightState(s) !== m.hashes[i]) return { ok: false, moves, mismatch: { log: `melee ${n + 1}`, move: i + 1 } };
    }
  }
  return { ok: true, moves, mismatch: null };
}

/** The voyage as a file: the setup it sailed and every log with its hashes, for a bug report or another machine. */
export function voyageFile(sim: VoyageSim): string {
  return JSON.stringify(
    {
      kind: "voyage",
      seed: sim.setup.seed,
      islandId: sim.setup.islandId,
      shipConfig: sim.setup.ship,
      ship: { moves: sim.shipMoves, hashes: sim.shipHashes },
      battles: sim.battles.map((b) => ({ tierId: b.tierId, seed: b.seed, config: b.config, moves: b.moves, hashes: b.hashes, outcome: b.outcome })),
      melees: sim.melees.map((m) => ({ tierId: m.tierId, seed: m.seed, config: m.config, fighters: m.fighters, moves: m.moves, hashes: m.hashes, outcome: m.outcome })),
      outcome: sim.phase,
    },
    null,
    1,
  );
}
