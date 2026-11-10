/**
 * Many voyages of one scenario, each on its own seed, with the AI at the helm: how the ship and
 * crew fare on average and how widely. And the replay proof: a voyage's logs, flown again from
 * their seeds through the reducers under the server's rules, give the same hash after every move
 * (ADR 0003).
 */

import {
  BATTLE_DEF,
  InvalidMoveError,
  STATIONS,
  SWORDFIGHT_DEF,
  hashShipState,
  reduceShip,
  replayLog,
  createShip,
  type RejectReason,
  type Replay,
  type ShipBattleOutcome,
  type Station,
} from "@openseas/engine";
import type { VoyageSetup } from "./scenario.js";
import { averageOutputs, flyVoyage, type SimPhase, type VoyageSim } from "./sim.js";

export interface RunSummary {
  readonly seed: string;
  readonly phase: SimPhase;
  /** Turns from flying to the end of the voyage. */
  readonly turns: number;
  readonly hailedBy: string | null;
  readonly engaged: boolean;
  /** How the space battle ended, or null without one. When a melee followed, how the melee ended. */
  readonly outcome: ShipBattleOutcome | null;
  readonly boarding: boolean;
  readonly battleTurns: number;
  readonly hits: number;
  readonly hitsTaken: number;
  readonly plunder: number;
  readonly peakHeat: number;
  readonly peakDamage: number;
  readonly meanSpeed: number;
  readonly outputs: Readonly<Record<Station, number>>;
}

export function summarize(sim: VoyageSim): RunSummary {
  const hailed = sim.log.find((e) => e.kind === "hailed");
  const battle = sim.battles[0] ?? null;
  const melee = sim.melees[0] ?? null;
  const last = battle ? battle.states[battle.states.length - 1]! : null;
  const flying = sim.samples.filter((s) => !s.held);
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
    plunder: Object.values(sim.plunder).reduce((a, b) => a + b, 0),
    peakHeat: Math.max(0, ...sim.samples.map((s) => s.heat)),
    peakDamage: Math.max(0, ...sim.samples.map((s) => s.damage)),
    meanSpeed: flying.length ? Math.round(flying.reduce((n, s) => n + s.speed, 0) / flying.length) : 0,
    outputs: averageOutputs(sim.samples),
  };
}

/** The seed of run `i` (from 0) of a batch on `seed`. */
export const batchSeed = (seed: string, i: number): string => `${seed}#${i + 1}`;

/**
 * Fly `runs` voyages, yielding to the page between them so it stays responsive and can show
 * progress. Stops early, with what it has, when `signal` aborts.
 */
export async function runBatch(setup: VoyageSetup, runs: number, onProgress?: (done: number) => void, signal?: AbortSignal): Promise<RunSummary[]> {
  const out: RunSummary[] = [];
  let lastYield = Date.now();
  for (let i = 0; i < runs; i++) {
    if (signal?.aborted) break;
    out.push(summarize(flyVoyage({ ...setup, seed: batchSeed(setup.seed, i) })));
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
  readonly meanPlunder: number;
  readonly meanPeakHeat: number;
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
    meanPlunder: mean(runs.map((r) => r.plunder)),
    meanPeakHeat: mean(runs.map((r) => r.peakHeat)),
    meanPeakDamage: mean(runs.map((r) => r.peakDamage)),
    meanSpeed: mean(runs.map((r) => r.meanSpeed)),
    outputs,
    tiers,
  };
}

/** The first move of a voyage's logs the server would refuse: which log, the move counted from 1, and why. */
export interface Mismatch {
  readonly log: string;
  readonly move: number;
  readonly reason: RejectReason;
  /** The engine's own words, for an illegal move. */
  readonly message?: string;
}

export interface Proof {
  readonly ok: boolean;
  /** Moves replayed across the ship's log, every battle's and every melee's. */
  readonly moves: number;
  /** Where the first refusal was, or null. */
  readonly mismatch: Mismatch | null;
}

/** A fight's replay as the server would judge it: refused at its first divergence, or else at its first refused move. */
function fightMismatch<S, M>(log: string, r: Replay<S, M>): Mismatch | null {
  if (r.divergedAt !== null) return { log, move: r.divergedAt + 1, reason: "divergence" };
  if (!r.rejection) return null;
  return { log, move: r.rejection.atSeq + 1, reason: r.rejection.reason, ...(r.rejection.message !== undefined ? { message: r.rejection.message } : {}) };
}

/**
 * Fly the voyage's logs again from their seeds and judge them as the server would: the ship's log
 * through the ship reducer, and each battle's and each melee's through the engine's replay of its
 * puzzle, every hash compared. A move the server would refuse is reported, never thrown.
 */
export function proveVoyage(sim: VoyageSim): Proof {
  let moves = 0;
  // The ship is no puzzle: nothing caps its log, so only its reducer and its hashes judge it.
  let ship = createShip(sim.setup.seed, sim.setup.ship, sim.setup.outpostId);
  for (let i = 0; i < sim.shipMoves.length; i++) {
    try {
      ship = reduceShip(ship, sim.shipMoves[i]!);
    } catch (e) {
      if (e instanceof InvalidMoveError) return { ok: false, moves, mismatch: { log: "ship", move: i + 1, reason: "illegal_move", message: e.message } };
      throw e;
    }
    moves += 1;
    if (hashShipState(ship) !== sim.shipHashes[i]) return { ok: false, moves, mismatch: { log: "ship", move: i + 1, reason: "divergence" } };
  }
  // A fight keeps time by the ship's turns, not a round's length, so none of its moves is judged late.
  for (const [n, b] of sim.battles.entries()) {
    const r = replayLog(BATTLE_DEF, b.seed, b.config, b.moves, { hashes: b.hashes });
    moves += r.applied;
    const bad = fightMismatch(`battle ${n + 1}`, r);
    if (bad) return { ok: false, moves, mismatch: bad };
  }
  for (const [n, m] of sim.melees.entries()) {
    const r = replayLog(SWORDFIGHT_DEF, m.seed, m.config, m.moves, { hashes: m.hashes });
    moves += r.applied;
    const bad = fightMismatch(`melee ${n + 1}`, r);
    if (bad) return { ok: false, moves, mismatch: bad };
  }
  return { ok: true, moves, mismatch: null };
}

/** The voyage as a file: the setup it flew and every log with its hashes, for a bug report or another machine. */
export function voyageFile(sim: VoyageSim): string {
  return JSON.stringify(
    {
      kind: "voyage",
      seed: sim.setup.seed,
      outpostId: sim.setup.outpostId,
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
