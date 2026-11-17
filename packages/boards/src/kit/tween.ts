/**
 * The kit's animation clock (ADR 0036). A board schedules tweens and timers against it and asks
 * whether any are still running; a new engine state flushes whatever is left, so a board never
 * animates on top of a state it has already left behind.
 *
 * Motion is short and eased (docs/BRAND.md section 6): a move is 120ms, ease-out, and nothing
 * bounces or overshoots; a removed piece shrinks to nothing in 160ms. `move` and `remove` are those
 * two, so a board types neither number.
 */
import { MOTION } from "../look/tokens.js";

export type Ease = (t: number) => number;

export const ease = {
  linear: (t: number): number => t,
  inQuad: (t: number): number => t * t,
  outQuad: (t: number): number => 1 - (1 - t) * (1 - t),
  inCubic: (t: number): number => t * t * t,
  outCubic: (t: number): number => 1 - (1 - t) ** 3,
  inOutCubic: (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
} as const;

export interface TweenOptions {
  /** Ms to wait before the tween starts. */
  delay?: number;
  ease?: Ease;
  /** Called once when the tween ends, on a flush too. */
  done?: () => void;
}

/** The properties `to` can move. `scale` sets both axes. */
export interface Tweenable {
  x?: number;
  y?: number;
  alpha?: number;
  rotation?: number;
  scale?: number;
}

interface Target {
  x: number;
  y: number;
  alpha: number;
  rotation: number;
  scale: { x: number; y: number; set(v: number): void };
}

interface Item {
  /** Ms until it starts. */
  delay: number;
  /** Ms it runs for; 0 for a timer. */
  ms: number;
  elapsed: number;
  started: boolean;
  ease: Ease;
  start: (() => void) | null;
  step: ((k: number) => void) | null;
  done: (() => void) | null;
}

export class Tweens {
  private items: Item[] = [];
  /** Time runs this many times faster: a board sets it above 1 for reduced motion. */
  rate = 1;

  /** True while anything scheduled has not finished. */
  get busy(): boolean {
    return this.items.length > 0;
  }

  /** Call `step` with the eased progress, 0 to 1, over `ms`. */
  run(ms: number, step: (k: number) => void, opts: TweenOptions = {}): void {
    this.items.push({ delay: opts.delay ?? 0, ms: Math.max(0, ms), elapsed: 0, started: false, ease: opts.ease ?? ease.outCubic, start: null, step, done: opts.done ?? null });
  }

  /** Move a display object's properties from where they are when the tween starts to `props`. */
  to(target: object, props: Tweenable, ms: number, opts: TweenOptions = {}): void {
    const t = target as Target;
    let from: Required<Tweenable> = { x: 0, y: 0, alpha: 1, rotation: 0, scale: 1 };
    const item: Item = {
      delay: opts.delay ?? 0,
      ms: Math.max(0, ms),
      elapsed: 0,
      started: false,
      ease: opts.ease ?? ease.outCubic,
      start: () => {
        from = { x: t.x, y: t.y, alpha: t.alpha, rotation: t.rotation, scale: t.scale.x };
      },
      step: (k) => {
        if (props.x !== undefined) t.x = from.x + (props.x - from.x) * k;
        if (props.y !== undefined) t.y = from.y + (props.y - from.y) * k;
        if (props.alpha !== undefined) t.alpha = from.alpha + (props.alpha - from.alpha) * k;
        if (props.rotation !== undefined) t.rotation = from.rotation + (props.rotation - from.rotation) * k;
        if (props.scale !== undefined) t.scale.set(from.scale + (props.scale - from.scale) * k);
      },
      done: opts.done ?? null,
    };
    this.items.push(item);
  }

  /** A move: `props` reached in 120ms, eased out. */
  move(target: object, props: Tweenable, opts: TweenOptions = {}): void {
    this.to(target, props, MOTION.move, opts);
  }

  /** A clear: the piece shrinks to nothing in 160ms. `done` is where the caller hides or frees it. */
  remove(target: object, opts: TweenOptions = {}): void {
    this.to(target, { scale: 0 }, MOTION.clear, opts);
  }

  /** Call `fn` once, `ms` from now. */
  after(ms: number, fn: () => void): void {
    this.items.push({ delay: Math.max(0, ms), ms: 0, elapsed: 0, started: false, ease: ease.linear, start: null, step: null, done: fn });
  }

  update(dt: number): void {
    if (this.items.length === 0) return;
    const step = dt * this.rate;
    // Items scheduled by a callback this frame start on the next one.
    const current = this.items;
    this.items = [];
    const keep: Item[] = [];
    for (const it of current) {
      if (this.advance(it, step)) keep.push(it);
    }
    this.items = keep.concat(this.items);
  }

  /** Finish everything now, in the order it would have finished, callbacks included. */
  flush(): void {
    for (let guard = 0; this.items.length > 0 && guard < 10_000; guard++) {
      let first = 0;
      let soonest = Infinity;
      this.items.forEach((it, i) => {
        const left = it.delay + it.ms - it.elapsed;
        if (left < soonest) {
          soonest = left;
          first = i;
        }
      });
      const [it] = this.items.splice(first, 1);
      if (!it) break;
      // Everything else moves forward by the same amount, so later items still end later.
      for (const other of this.items) this.advance(other, Math.max(0, soonest), true);
      this.advance(it, Infinity);
    }
    this.items = [];
  }

  /** Drop everything without finishing it. */
  clear(): void {
    this.items = [];
  }

  /** Returns true while the item still has time to run. With `hold`, an item that would end stays for the flush to end it in order. */
  private advance(it: Item, dt: number, hold = false): boolean {
    if (it.delay > 0) {
      const used = Math.min(it.delay, dt);
      it.delay -= used;
      dt -= used;
      if (it.delay > 0) return true;
    }
    if (!it.started) {
      it.started = true;
      it.start?.();
    }
    it.elapsed = Math.min(it.ms, it.elapsed + dt);
    const k = it.ms === 0 ? 1 : it.elapsed / it.ms;
    if (k >= 1) {
      if (hold) {
        it.elapsed = it.ms;
        return true;
      }
      it.step?.(1);
      it.done?.();
      return false;
    }
    it.step?.(it.ease(k));
    return true;
  }
}
