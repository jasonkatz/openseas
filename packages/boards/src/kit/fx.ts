/**
 * The kit's effects layer (ADR 0036), to the brand book's motion (docs/BRAND.md section 6): score
 * popups, a callout, a ring, a line, and the beat. Every prototype board gets the same feedback
 * vocabulary from here, so a scoring moment reads the same way on all of them. There is no shake,
 * no flash, no glow and no shower of particles: a big moment is the beat, one amber pulse of the
 * whole board. Effects run on the wall clock and never hold a board's state back: a board is
 * settled when its tweens are, whatever is still fading here.
 */
import { Container, Graphics, Text } from "pixi.js";
import { MOTION } from "../look/tokens.js";
import { FONT, FONT_MONO, INK } from "./art.js";

interface Popup {
  t: Text;
  life: number;
  max: number;
  y0: number;
  rise: number;
}

interface Ring {
  g: Graphics;
  x: number;
  y: number;
  r0: number;
  r1: number;
  color: number;
  life: number;
  max: number;
  width: number;
}

interface Line {
  g: Graphics;
  life: number;
  max: number;
}

const outCubic = (t: number): number => 1 - (1 - t) ** 3;

export class Fx {
  readonly layer = new Container();
  private readonly beatRect = new Graphics();
  private readonly popups: Popup[] = [];
  private readonly rings: Ring[] = [];
  private readonly lines: Line[] = [];
  private callout: Popup | null = null;
  private width = 0;
  private height = 0;
  /** Where the board is on the canvas: what the beat pulses. The whole canvas until a board says. */
  private frame: { x: number; y: number; w: number; h: number } | null = null;
  private beatNow: { life: number; strength: number } | null = null;

  /**
   * @param world everything the board draws: the beat swells it a hair.
   * @param reduced the player asked for reduced motion: the beat is a still flash, text does not drift.
   */
  constructor(
    private readonly world: Container,
    private readonly reduced: boolean,
  ) {
    this.beatRect.visible = false;
    this.layer.addChild(this.beatRect);
    this.layer.eventMode = "none";
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.frame = null;
  }

  /** The board's own rectangle on the canvas, in CSS pixels: the beat covers this and nothing round it. */
  setFrame(x: number, y: number, w: number, h: number): void {
    this.frame = { x, y, w, h };
  }

  /** Small numbers that drift up from (x, y) and fade: the points a move just made. Mono, bold, with a ground edge so they read over any piece. */
  popup(x: number, y: number, text: string, color: number = INK.cream, size = 18): void {
    const fontSize = Math.max(13, size);
    const t = new Text({ text, style: { fontFamily: FONT_MONO, fontSize, fontWeight: "700", fill: color, stroke: { color: INK.ground, width: Math.max(3, fontSize * 0.2), join: "round" } }, resolution: 2 });
    t.anchor.set(0.5);
    t.position.set(Math.max(t.width / 2 + 2, Math.min(this.width - t.width / 2 - 2, x)), y);
    this.layer.addChild(t);
    this.popups.push({ t, life: 0, max: this.reduced ? 450 : 900, y0: y, rise: this.reduced ? 0 : Math.max(18, size * 1.4) });
  }

  /** Big text over the upper third of the board: the name of what just happened. One at a time. */
  say(text: string, color: number = INK.cream, size?: number): void {
    if (this.callout) {
      this.callout.t.destroy();
      const i = this.popups.indexOf(this.callout);
      if (i >= 0) this.popups.splice(i, 1);
    }
    const f = this.frame ?? { x: 0, y: 0, w: this.width, h: this.height };
    const fontSize = size ?? Math.max(20, Math.min(40, f.w * 0.085));
    const t = new Text({ text, style: { fontFamily: FONT, fontSize, fontWeight: "700", fill: color, stroke: { color: INK.ground, width: Math.max(4, fontSize * 0.18), join: "round" }, align: "center" }, resolution: 2 });
    t.anchor.set(0.5);
    t.position.set(f.x + f.w / 2, f.y + f.h * 0.3);
    // A long callout shrinks to fit the board.
    if (t.width > f.w * 0.92) t.scale.set((f.w * 0.92) / t.width);
    this.layer.addChild(t);
    const p: Popup = { t, life: 0, max: this.reduced ? 600 : 1100, y0: t.y, rise: 0 };
    this.callout = p;
    this.popups.push(p);
  }

  /** A ring that moves from r0 to r1 round (x, y) and fades: where something landed. One flat stroke. */
  ring(x: number, y: number, color: number, r0: number, r1: number, ms: number = MOTION.clear, width = 2): void {
    const g = new Graphics();
    this.layer.addChild(g);
    this.rings.push({ g, x, y, r0: this.reduced ? r1 : r0, r1, color, life: 0, max: ms, width });
  }

  /** A line through `points` (x0, y0, x1, y1, ...) that shows and fades: a beam, a tether, a cut. One flat stroke. */
  beam(points: readonly number[], color: number, width = 4, ms = 320): void {
    if (points.length < 4) return;
    const g = new Graphics();
    g.moveTo(points[0]!, points[1]!);
    for (let i = 2; i + 1 < points.length; i += 2) g.lineTo(points[i]!, points[i + 1]!);
    g.stroke({ width, color, cap: "round", join: "round" });
    this.layer.addChild(g);
    this.lines.push({ g, life: 0, max: this.reduced ? ms * 0.5 : ms });
  }

  /**
   * The beat (docs/BRAND.md section 6): the whole board pulses once in amber and swells a hair, in
   * 420ms. `strength` is 0 to 1; a bigger moment is a slightly stronger pulse, never a second
   * effect. A stronger one while one is playing takes it over; it never stacks. Reduced motion
   * keeps it as a still flash. A board reserves it for its named compound move and one or two
   * other rare things, and asks through `KitBoard.beat`.
   */
  beat(strength = 0.5): void {
    const s = Math.max(0, Math.min(1, strength));
    this.beatNow = { life: 0, strength: Math.max(s, this.beatNow?.strength ?? 0) };
  }

  update(dt: number): void {
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i]!;
      p.life += dt;
      const k = Math.min(1, p.life / p.max);
      p.t.y = p.y0 - outCubic(k) * p.rise;
      p.t.alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      if (k >= 1) {
        p.t.destroy();
        this.popups.splice(i, 1);
        if (this.callout === p) this.callout = null;
      }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]!;
      r.life += dt;
      const k = Math.min(1, r.life / r.max);
      r.g.clear().circle(r.x, r.y, r.r0 + (r.r1 - r.r0) * outCubic(k)).stroke({ width: r.width, color: r.color, alpha: 1 - k });
      if (k >= 1) {
        r.g.destroy();
        this.rings.splice(i, 1);
      }
    }
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const b = this.lines[i]!;
      b.life += dt;
      const k = Math.min(1, b.life / b.max);
      b.g.alpha = 1 - k * k;
      if (k >= 1) {
        b.g.destroy();
        this.lines.splice(i, 1);
      }
    }
    this.drawBeat(dt);
  }

  private drawBeat(dt: number): void {
    const b = this.beatNow;
    if (!b) return;
    b.life += dt;
    const t = b.life / MOTION.beat;
    const f = this.frame ?? { x: 0, y: 0, w: this.width, h: this.height };
    const cx = f.x + f.w / 2;
    const cy = f.y + f.h / 2;
    // The world swells about the board's centre.
    this.world.pivot.set(cx, cy);
    this.world.position.set(cx, cy);
    if (t >= 1) {
      this.beatNow = null;
      this.beatRect.visible = false;
      this.world.scale.set(1);
      return;
    }
    // Up in the first quarter, down over the rest.
    const env = this.reduced ? 1 : t < 0.25 ? outCubic(t / 0.25) : 1 - outCubic((t - 0.25) / 0.75);
    this.beatRect.clear().rect(f.x, f.y, f.w, f.h).fill({ color: INK.amber, alpha: (0.14 + 0.16 * b.strength) * env });
    this.beatRect.visible = true;
    this.world.scale.set(this.reduced ? 1 : 1 + 0.012 * b.strength * env);
  }

  /** Drop every effect at once: the board was rebuilt under them. */
  clear(): void {
    for (const p of this.popups) p.t.destroy();
    for (const r of this.rings) r.g.destroy();
    for (const b of this.lines) b.g.destroy();
    this.popups.length = 0;
    this.rings.length = 0;
    this.lines.length = 0;
    this.callout = null;
    this.beatNow = null;
    this.beatRect.visible = false;
    this.world.scale.set(1);
  }
}
