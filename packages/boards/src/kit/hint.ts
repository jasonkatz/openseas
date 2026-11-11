/**
 * The idle hint a prototype board pulses after the player has done nothing for a while (ADR 0036):
 * the wait, asking the engine once, the pulse, and taking it down again. A board makes one with
 * `KitBoard.idleHint` and says only what is its own: what the engine advises, how that is drawn,
 * and what besides the kit's own reasons holds it back.
 *
 * The kit holds a hint back while input is off, hints are off, there is no state or the round is
 * over, or a move is still playing out. The wait starts again whenever it is held back and whenever
 * the board calls `restart`, which every input and every new state should.
 */
import type { Graphics } from "pixi.js";

export interface IdleHintSpec<S, H> {
  /** Ms the board must sit idle before the hint shows. */
  after: number;
  /** The engine's advice for `state`, or null when it has none. Asked once a `key`, not once a frame. */
  compute(state: S): H | null;
  /**
   * Draw the hint. Called every frame while it shows; `beat` runs from 0 to 1 and back once a
   * `period`, for the board to pulse it by.
   */
  draw(hint: H, beat: number): void;
  /** What the advice is asked again on: the state, unless a ticked board's state moves on every tick while its advice does not. */
  key?(state: S): unknown;
  /** The board's own reasons to hold the hint back besides the kit's: a line being drawn, a finger down. */
  held?(): boolean;
  /** The layer the hint alone is drawn in: cleared before each draw and when the hint goes. */
  layer?: Graphics;
  /** Called when a hint that showed goes away, for anything a draw left outside `layer`. */
  hidden?(): void;
  /** Ms of one beat. */
  period?: number;
  /** Show it while a move still plays out: a ticked board whose next choice is made while the last one animates. */
  whileBusy?: boolean;
}

export class IdleHint<S, H> {
  private idle = 0;
  private wait: number;
  private advice: H | null = null;
  private asked: { key: unknown } | null = null;
  private showing = false;

  constructor(private readonly spec: IdleHintSpec<S, H>) {
    this.wait = spec.after;
  }

  /** True when a move that is still playing out does not hold the hint back. */
  get whileBusy(): boolean {
    return this.spec.whileBusy ?? false;
  }

  /** The hint on show, or null. */
  get current(): H | null {
    return this.showing ? this.advice : null;
  }

  /**
   * The player did something, or the board changed: take the hint down and wait again. `wait` is
   * how long this once (0 shows the next hint as soon as it may, for a player following the hints);
   * the whole `after` unless said. It holds until the next restart.
   */
  restart(wait: number = this.spec.after): void {
    this.idle = 0;
    this.wait = wait;
    this.hide();
  }

  /** The kit calls this every frame, with the state when the board may hint now and null when it may not. */
  frame(dt: number, state: S | null, time: number): void {
    if (state === null || this.spec.held?.()) {
      this.idle = 0;
      this.hide();
      return;
    }
    this.idle += dt;
    if (this.idle < this.wait) {
      this.hide();
      return;
    }
    const key = this.spec.key ? this.spec.key(state) : state;
    if (this.asked === null || this.asked.key !== key) {
      this.asked = { key };
      this.advice = this.spec.compute(state);
    }
    if (this.advice === null) {
      this.hide();
      return;
    }
    this.showing = true;
    this.spec.layer?.clear();
    this.spec.draw(this.advice, 0.5 + 0.5 * Math.sin(time / (this.spec.period ?? 240)));
  }

  private hide(): void {
    if (!this.showing) return;
    this.showing = false;
    this.spec.layer?.clear();
    this.spec.hidden?.();
  }
}
