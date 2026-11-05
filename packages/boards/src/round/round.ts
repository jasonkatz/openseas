import { InvalidMoveError, type PuzzleDef } from "@openseas/engine";
import type { ClientMetrics } from "@openseas/protocol";
import type { GameSocket } from "../api/socket.js";
import { LatencyMeter } from "../metrics.js";
import type { Clock } from "./clock.js";

/** One applied move and the engine's state hash after it. Rated rounds send exactly this. */
export interface LoggedMove<M> {
  readonly seq: number;
  readonly move: M;
  readonly hash: string;
}

export interface RoundOptions<S, M, C> {
  def: PuzzleDef<S, M, C>;
  seed: string;
  config: C;
  /** Round start and end on `clock`. Timed engines count their ticks from `startedAt`. */
  startedAt: number;
  deadlineAt: number;
  clock: Clock;
  /** Present for rated rounds; the move log streams to the server as it happens. */
  rated: { socket: GameSocket; sessionId: string } | null;
  /** Moves the server already holds (a round resumed after a reconnect): replayed from the seed, never sent again. */
  replay?: readonly M[];
  onChange(state: S, prev: S | null): void;
  onFinished(): void;
}

/**
 * One round of any puzzle on the client. Runs the engine locally for instant feel and streams the
 * move log (ADR 0003). Never computes anything the server will not recompute. Keeps the log it
 * sent, with the hash after every move, so a harness can replay and compare it.
 */
export class PuzzleRound<S, M, C> {
  state: S;
  readonly metrics = new LatencyMeter();
  readonly log: LoggedMove<M>[] = [];
  private finished = false;

  constructor(readonly opts: RoundOptions<S, M, C>) {
    this.state = opts.def.create(opts.seed, opts.config);
    for (const move of opts.replay ?? []) {
      const next = opts.def.reduce(this.state, move);
      this.log.push({ seq: this.log.length, move, hash: opts.def.hash(next) });
      this.state = next;
    }
    opts.onChange(this.state, null);
    if (opts.def.isFinished(this.state)) this.finish();
  }

  get rated(): boolean {
    return this.opts.rated !== null;
  }

  get isFinished(): boolean {
    return this.finished;
  }

  /** The engine's hash of the current state. */
  get hash(): string {
    return this.opts.def.hash(this.state);
  }

  /** True when the engine accepts the move right now. Cheap enough for input gating. */
  canApply(move: M): boolean {
    if (this.finished) return false;
    try {
      this.opts.def.reduce(this.state, move);
      return true;
    } catch (e) {
      if (e instanceof InvalidMoveError) return false;
      throw e;
    }
  }

  /** Apply a player move. Returns the new state, or null when the engine refused it. */
  apply(move: M, countsAsInput = true): S | null {
    if (this.finished) return null;
    let next: S;
    try {
      next = this.opts.def.reduce(this.state, move);
    } catch (e) {
      if (e instanceof InvalidMoveError) return null;
      throw e;
    }
    if (countsAsInput) this.metrics.markInput();
    const prev = this.state;
    this.state = next;
    const seq = this.log.length;
    const hash = this.opts.def.hash(next);
    this.log.push({ seq, move, hash });
    if (this.opts.rated) {
      this.opts.rated.socket.send({
        type: "puzzle.move",
        sessionId: this.opts.rated.sessionId,
        seq,
        move: move as never,
        hash,
      });
    }
    this.opts.onChange(next, prev);
    if (this.opts.def.isFinished(next)) this.finish();
    return next;
  }

  /**
   * Apply a move the server already logged for this round (the melee's end, which it decided and
   * wrote itself): nothing is sent, the round is finished here as it is there.
   */
  settleLocal(move: M): void {
    if (this.finished) return;
    let next: S;
    try {
      next = this.opts.def.reduce(this.state, move);
    } catch (e) {
      if (!(e instanceof InvalidMoveError)) throw e;
      next = this.state;
    }
    const prev = this.state;
    this.state = next;
    if (next !== prev) this.log.push({ seq: this.log.length, move, hash: this.opts.def.hash(next) });
    this.finished = true;
    this.opts.onChange(next, prev);
    this.opts.onFinished();
  }

  /** Called when the clock runs out, the board locks, or the player stops. Idempotent. */
  finish(): void {
    if (this.finished) return;
    this.finished = true;
    if (this.opts.rated) {
      const metrics: ClientMetrics = this.metrics.summary();
      this.opts.rated.socket.send({
        type: "puzzle.finish",
        sessionId: this.opts.rated.sessionId,
        hash: this.hash,
        metrics,
      });
    }
    this.opts.onFinished();
  }

  abandon(): void {
    if (this.finished) return;
    this.finished = true;
    if (this.opts.rated) this.opts.rated.socket.send({ type: "puzzle.abandon", sessionId: this.opts.rated.sessionId });
  }
}
