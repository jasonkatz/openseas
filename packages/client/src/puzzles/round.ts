import { InvalidMoveError, type PuzzleDef } from "@openseas/engine";
import type { ClientMetrics } from "@openseas/protocol";
import type { GameSocket } from "../api/socket.js";
import { LatencyMeter } from "../metrics.js";

export interface RoundOptions<S, M, C> {
  def: PuzzleDef<S, M, C>;
  seed: string;
  config: C;
  /** Local wall-clock ms when the round ends. */
  deadlineAt: number;
  /** Present for rated rounds; the move log streams to the server as it happens. */
  rated: { socket: GameSocket; sessionId: string } | null;
  onChange(state: S, prev: S | null): void;
  onFinished(): void;
}

/**
 * One practice round of any puzzle on the client. Runs the engine locally for instant feel and
 * streams the move log (ADR 0003). Never computes anything the server will not recompute.
 */
export class PuzzleRound<S, M, C> {
  state: S;
  readonly metrics = new LatencyMeter();
  private seq = 0;
  private finished = false;

  constructor(readonly opts: RoundOptions<S, M, C>) {
    this.state = opts.def.create(opts.seed, opts.config);
    opts.onChange(this.state, null);
    if (opts.def.isFinished(this.state)) this.finish();
  }

  get rated(): boolean {
    return this.opts.rated !== null;
  }

  get isFinished(): boolean {
    return this.finished;
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
    const seq = this.seq++;
    if (this.opts.rated) {
      this.opts.rated.socket.send({
        type: "puzzle.move",
        sessionId: this.opts.rated.sessionId,
        seq,
        move: move as never,
        hash: this.opts.def.hash(next),
      });
    }
    this.opts.onChange(next, prev);
    if (this.opts.def.isFinished(next)) this.finish();
    return next;
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
        hash: this.opts.def.hash(this.state),
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

  /** The server already closed the round (a duty board cut short): take no more input, send nothing. */
  stop(): void {
    this.finished = true;
  }
}
