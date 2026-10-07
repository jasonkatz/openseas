import {
  createBilgingGame,
  hashBilgingState,
  previewSwap,
  reduceBilging,
  swapIllegalReason,
  type BilgingConfig,
  type BilgingMove,
  type BilgingState,
  type MoveReport,
} from "@openseas/engine";
import type { ClientMetrics } from "@openseas/protocol";
import type { GameSocket } from "../api/socket.js";
import { LatencyMeter } from "../metrics.js";

export interface RoundOptions {
  seed: string;
  config: BilgingConfig;
  /** Local wall-clock ms when the round ends. */
  deadlineAt: number;
  /** Present for rated rounds; the move log streams to the server as it happens. */
  rated: { socket: GameSocket; sessionId: string } | null;
  onChange(state: BilgingState, report: MoveReport | null): void;
  onFinished(): void;
}

/**
 * One Bilging round on the client. Runs the engine locally for instant feel and streams the move
 * log (ADR 0003). Never computes anything the server will not recompute.
 */
export class BilgingRound {
  state: BilgingState;
  readonly metrics = new LatencyMeter();
  private seq = 0;
  private finished = false;

  constructor(readonly opts: RoundOptions) {
    this.state = createBilgingGame(opts.seed, opts.config);
    opts.onChange(this.state, null);
  }

  get rated(): boolean {
    return this.opts.rated !== null;
  }

  canSwap(col: number, row: number): boolean {
    return !this.finished && swapIllegalReason(this.state, col, row) === null;
  }

  preview(col: number, row: number): readonly number[] {
    if (this.finished) return [];
    return previewSwap(this.state, col, row).cells;
  }

  swap(col: number, row: number): MoveReport | null {
    if (!this.canSwap(col, row)) return null;
    this.metrics.markInput();
    return this.apply({ type: "swap", col, row });
  }

  private apply(move: BilgingMove): MoveReport | null {
    const next = reduceBilging(this.state, move);
    this.state = next;
    const seq = this.seq++;
    if (this.opts.rated) {
      this.opts.rated.socket.send({
        type: "puzzle.move",
        sessionId: this.opts.rated.sessionId,
        seq,
        move,
        hash: hashBilgingState(next),
      });
    }
    this.opts.onChange(next, next.lastMove);
    if (next.finished) this.finish();
    return next.lastMove;
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
        hash: hashBilgingState(this.state),
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

  get isFinished(): boolean {
    return this.finished;
  }
}
