/**
 * Where a round reads the time. The game and unrated harness rounds read the wall clock; a lab
 * round in the harness reads a clock it can slow, pause and step. The engines never read either:
 * time reaches them as ticks carried in moves (ADR 0015).
 */
export interface Clock {
  now(): number;
}

export const wallClock: Clock = { now: () => Date.now() };

/**
 * A clock the harness drives. It governs the round's deadline and the ticks timed engines are
 * advanced to; the renderers' own animations keep running on the wall clock. Starts aligned with
 * the wall clock so deadlines computed from it read naturally.
 */
export class LabClock implements Clock {
  private virtual: number;
  private anchor: number;
  private rate: number;
  private paused = false;
  private readonly listeners = new Set<() => void>();

  constructor(rate = 1, paused = false) {
    this.virtual = Date.now();
    this.anchor = this.virtual;
    this.rate = rate;
    this.paused = paused;
  }

  now(): number {
    this.settle();
    return this.virtual;
  }

  get speed(): number {
    return this.rate;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  setSpeed(rate: number): void {
    if (!(rate > 0)) throw new Error(`clock speed must be positive, got ${rate}`);
    this.settle();
    this.rate = rate;
    this.emit();
  }

  pause(): void {
    this.settle();
    this.paused = true;
    this.emit();
  }

  resume(): void {
    this.anchor = Date.now();
    this.paused = false;
    this.emit();
  }

  /** Move time forward by `ms`, paused or not. */
  step(ms: number): void {
    this.settle();
    this.virtual += Math.max(0, ms);
    this.emit();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private settle(): void {
    const real = Date.now();
    if (!this.paused) this.virtual += (real - this.anchor) * this.rate;
    this.anchor = real;
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
