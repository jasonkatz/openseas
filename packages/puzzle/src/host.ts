/**
 * What a host does with rounds (docs/puzzles/DOMAIN.md, "The log", "Versions", "The ladder"): replay
 * a round from its seed, settings and log, keep a judged round, hold a puzzle to its witness
 * rounds, and say when a player clears a stage. A host is the only authority: it derives every
 * score by replaying, and never takes one it was told.
 */
import { stageLayers, versionOf, type PuzzleDoc, type SettingValue } from "./document.js";
import { Refused } from "./errors.js";
import type { Tier } from "./judge.js";
import type { Engine, Log, Read, Round, RoundEvent } from "./round.js";

/** What a host keeps of a judged round. A judged round is final: it is never judged again. */
export interface StoredRound {
  readonly puzzle: string;
  readonly version: string;
  readonly seed: string;
  /** Every setting's value, not only those changed from a default, so a later default never changes what the round was. */
  readonly settings: Readonly<Record<string, SettingValue>>;
  readonly layers: readonly string[];
  readonly log: Log;
  readonly score: number;
  readonly performance: number | null;
  readonly tier: Tier | null;
}

export interface Replayed<S> {
  readonly round: Round<S>;
  /** Each entry's events, in the log's order, and what the final time mark set off last. */
  readonly events: readonly (readonly RoundEvent[])[];
}

/** A round played again from its seed, settings and log. `Refused` when the log holds anything the round does not allow. */
export function replay<S>(engine: Engine<S>, from: { readonly seed: string; readonly layers: readonly string[]; readonly settings: Readonly<Record<string, SettingValue>>; readonly log: Log }): Replayed<S> {
  let round = engine.start(from.seed, engine.settings({ layers: from.layers, values: from.settings }));
  const events: (readonly RoundEvent[])[] = [];
  for (const entry of from.log.entries) {
    const played = engine.play(round, entry);
    round = played.round;
    events.push(played.events);
  }
  const closed = engine.mark(round, from.log.end);
  events.push(closed.events);
  return { round: closed.round, events };
}

/**
 * Judges a finished round and makes what the host keeps of it. The round is replayed from its log
 * here, so the score is the host's own and the log is known to be the whole story. Refused when
 * the round has not ended: only an ended round is judged.
 */
export function judge<S>(engine: Engine<S>, from: { readonly seed: string; readonly layers: readonly string[]; readonly settings: Readonly<Record<string, SettingValue>>; readonly log: Log }): StoredRound {
  const { round } = replay(engine, from);
  if (!round.ended) throw new Refused("round", ["the round has not ended, so it cannot be judged"]);
  const read = engine.read(round);
  return { puzzle: round.puzzle, version: round.version, seed: round.seed, settings: round.settings.values, layers: round.settings.layers, log: from.log, score: read.score, performance: read.performance, tier: read.tier };
}

/**
 * Whether these rules can replay a stored round: it is this puzzle's, and it was dealt on the
 * major these rules are. A minor never changes how a stored round replays, since every setting's
 * value is kept with it.
 */
export function replays(doc: PuzzleDoc, stored: { readonly puzzle: string; readonly version: string }): boolean {
  const [a, b] = [versionOf(doc.version), versionOf(stored.version)];
  return stored.puzzle === doc.id && a !== null && b !== null && a.major === b.major;
}

/** A recorded round a puzzle keeps with the read it must give. */
export interface WitnessRound {
  readonly name: string;
  readonly version: string;
  readonly seed: string;
  readonly layers: readonly string[];
  readonly settings: Readonly<Record<string, SettingValue>>;
  readonly log: Log;
  readonly read: Read;
  /** The round's fingerprint at its end: the board, the streams and everything else. */
  readonly hash: string;
}

export function recordWitness<S>(engine: Engine<S>, name: string, from: { readonly seed: string; readonly layers: readonly string[]; readonly settings: Readonly<Record<string, SettingValue>>; readonly log: Log }): WitnessRound {
  const { round } = replay(engine, from);
  return { name, version: round.version, seed: round.seed, layers: round.settings.layers, settings: round.settings.values, log: from.log, read: engine.read(round), hash: engine.hash(round) };
}

/**
 * How a witness round differs from what the rules give now. Empty when it still gives the read
 * recorded for it. Anything else means the change raises the major, and the witnesses are recorded
 * again. Tier starts and the scale are judgement, not replay, so performance and tier are not held.
 */
export function checkWitness<S>(engine: Engine<S>, witness: WitnessRound): string[] {
  const out: string[] = [];
  if (!replays(engine.doc, { puzzle: engine.doc.id, version: witness.version })) return [`${witness.name} was recorded on version ${witness.version}: record the witness rounds again for ${engine.doc.version}`];
  let got: Read;
  let hash: string;
  try {
    const { round } = replay(engine, witness);
    got = engine.read(round);
    hash = engine.hash(round);
  } catch (e) {
    return [`${witness.name} no longer replays: ${e instanceof Error ? e.message : String(e)}`];
  }
  const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
  if (got.score !== witness.read.score) out.push(`${witness.name} scored ${witness.read.score} and now scores ${got.score}`);
  for (const part of ["paid", "stats", "gauges", "moves", "ended"] as const) if (!same(got[part], witness.read[part])) out.push(`${witness.name} reads a different ${part}`);
  if (out.length === 0 && hash !== witness.hash) out.push(`${witness.name} ends as a different round`);
  return out;
}

/**
 * Whether a player has cleared a stage's threshold, from their rounds at that stage (newest last).
 * The measures that need a part of the guide still open (how many rounds an average reads, wins
 * over a stand-in) are not judged yet.
 */
export function clears(doc: PuzzleDoc, stage: string, rounds: readonly { readonly score: number }[]): boolean {
  const s = doc.ladder.find((x) => x.stage === stage);
  if (!s) throw new Error(`no stage ${stage}`);
  if (!s.advance) return false;
  if (s.advance.measure === "best-round") return rounds.some((r) => r.score >= s.advance!.threshold);
  if (s.advance.measure === "rounds-played") return rounds.length >= s.advance.threshold;
  throw new Error(`a threshold measured by ${s.advance.measure} is not judged yet`);
}

/** The stage after one, or null after the last. A player only moves forward. */
export function nextStage(doc: PuzzleDoc, stage: string): string | null {
  const i = doc.ladder.findIndex((x) => x.stage === stage);
  return i >= 0 && i + 1 < doc.ladder.length ? doc.ladder[i + 1]!.stage : null;
}

export { stageLayers };
