/**
 * The kit's effects layer (ADR 0036): score popups, callouts, particle bursts, rings, beams, a
 * flash and a shake. Every prototype board gets the same feedback vocabulary from here, so a
 * scoring moment reads the same way on all of them. Effects run on the wall clock and never hold a
 * board's state back: a board is settled when its tweens are, whatever is still fading here.
 */
import { Container, Graphics, Text } from "pixi.js";
import { FONT_DISPLAY, INK } from "./art.js";

interface Popup {
  t: Text;
  life: number;
  max: number;
  y0: number;
  rise: number;
  /** A callout scales in and holds; a popup drifts up. */
  callout: boolean;
  /** A callout's settled scale: under 1 when the text is wider than the board. */
  fit: number;
}

interface Particle {
  g: Graphics;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
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

interface Beam {
  g: Graphics;
  life: number;
  max: number;
}

export class Fx {
  readonly layer = new Container();
  private readonly flashRect = new Graphics();
  private readonly popups: Popup[] = [];
  private readonly particles: Particle[] = [];
  private readonly rings: Ring[] = [];
  private readonly beams: Beam[] = [];
  private callout: Popup | null = null;
  private width = 0;
  private height = 0;
  private flashLife = 0;
  private flashMax = 0;
  private flashAlpha = 0;
  private shakeLife = 0;
  private shakeMax = 0;
  private shakeMag = 0;
  private seed = 1;

  /**
   * @param world the container a shake moves: everything the board draws.
   * @param reduced the player asked for reduced motion: no shake, no particles, shorter text.
   */
  constructor(
    private readonly world: Container,
    private readonly reduced: boolean,
  ) {
    this.flashRect.visible = false;
    this.layer.addChild(this.flashRect);
    this.layer.eventMode = "none";
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  /** Small text that drifts up from (x, y) and fades: the points a move just made. */
  popup(x: number, y: number, text: string, color: number = INK.gold, size = 18): void {
    const t = new Text({ text, style: { fontFamily: FONT_DISPLAY, fontSize: Math.max(12, size), fontWeight: "700", fill: color, stroke: { color: 0x000000, width: 3 } } });
    t.anchor.set(0.5);
    t.position.set(Math.max(t.width / 2 + 2, Math.min(this.width - t.width / 2 - 2, x)), y);
    this.layer.addChild(t);
    this.popups.push({ t, life: 0, max: this.reduced ? 350 : 800, y0: y, rise: Math.max(18, size * 1.6), callout: false, fit: 1 });
  }

  /** Big text over the upper third of the board: the name of what just happened. One at a time. */
  say(text: string, color: number = INK.gold, size?: number): void {
    if (this.callout) {
      this.callout.t.destroy();
      const i = this.popups.indexOf(this.callout);
      if (i >= 0) this.popups.splice(i, 1);
    }
    const fontSize = size ?? Math.max(20, Math.min(44, this.width * 0.085));
    const t = new Text({ text, style: { fontFamily: FONT_DISPLAY, fontSize, fontWeight: "900", fill: color, stroke: { color: 0x000000, width: 5 }, letterSpacing: 1, align: "center" } });
    t.anchor.set(0.5);
    t.position.set(this.width / 2, this.height * 0.3);
    // A long callout shrinks to fit the board.
    const fit = t.width > this.width * 0.92 ? (this.width * 0.92) / t.width : 1;
    t.scale.set(fit * 0.7);
    this.layer.addChild(t);
    const p: Popup = { t, life: 0, max: this.reduced ? 500 : 1100, y0: t.y, rise: 0, callout: true, fit };
    this.callout = p;
    this.popups.push(p);
  }

  /** Sparks flying out from (x, y). */
  burst(x: number, y: number, color: number, count = 10, speed = 0.22, size = 4): void {
    if (this.reduced) return;
    const n = Math.min(count, 60 - this.particles.length);
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      const v = speed * (0.4 + this.rand() * 0.8);
      const g = new Graphics();
      const s = size * (0.6 + this.rand() * 0.8);
      g.circle(0, 0, s).fill({ color });
      g.position.set(x, y);
      this.layer.addChild(g);
      this.particles.push({ g, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 350 + this.rand() * 300, size: s });
    }
  }

  /** A ring that grows from r0 to r1 round (x, y) and fades. */
  ring(x: number, y: number, color: number, r0: number, r1: number, ms = 420, width = 3): void {
    const g = new Graphics();
    this.layer.addChild(g);
    this.rings.push({ g, x, y, r0, r1, color, life: 0, max: this.reduced ? ms * 0.5 : ms, width });
  }

  /** A line through `points` (x0, y0, x1, y1, ...) that flashes and fades: a beam, a tether, a cut. */
  beam(points: readonly number[], color: number, width = 4, ms = 320): void {
    if (points.length < 4) return;
    const g = new Graphics();
    g.moveTo(points[0]!, points[1]!);
    for (let i = 2; i + 1 < points.length; i += 2) g.lineTo(points[i]!, points[i + 1]!);
    g.stroke({ width: width * 2.4, color, alpha: 0.25, cap: "round", join: "round" });
    g.moveTo(points[0]!, points[1]!);
    for (let i = 2; i + 1 < points.length; i += 2) g.lineTo(points[i]!, points[i + 1]!);
    g.stroke({ width, color: 0xffffff, alpha: 0.9, cap: "round", join: "round" });
    this.layer.addChild(g);
    this.beams.push({ g, life: 0, max: this.reduced ? ms * 0.5 : ms });
  }

  /** A wash of color over the whole board. */
  flash(color: number, alpha = 0.22, ms = 260): void {
    this.flashRect.clear().rect(0, 0, this.width, this.height).fill({ color });
    this.flashRect.visible = true;
    this.flashAlpha = this.reduced ? alpha * 0.5 : alpha;
    this.flashLife = 0;
    this.flashMax = ms;
  }

  /** Rattle the board: a hit, a burst, a big score. */
  shake(magnitude = 6, ms = 260): void {
    if (this.reduced) return;
    this.shakeMag = Math.max(this.shakeLife < this.shakeMax ? this.shakeMag : 0, magnitude);
    this.shakeLife = 0;
    this.shakeMax = ms;
  }

  update(dt: number): void {
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i]!;
      p.life += dt;
      const k = Math.min(1, p.life / p.max);
      if (p.callout) {
        const inK = Math.min(1, p.life / 160);
        p.t.scale.set(p.fit * (0.7 + 0.3 * (1 - (1 - inK) ** 3)));
        p.t.alpha = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
      } else {
        p.t.y = p.y0 - (1 - (1 - k) ** 2) * p.rise;
        p.t.alpha = k < 0.65 ? 1 : 1 - (k - 0.65) / 0.35;
      }
      if (k >= 1) {
        p.t.destroy();
        this.popups.splice(i, 1);
        if (this.callout === p) this.callout = null;
      }
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.life += dt;
      const k = Math.min(1, p.life / p.max);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.985;
      p.vy = p.vy * 0.985 + 0.0004 * dt;
      p.g.position.set(p.x, p.y);
      p.g.alpha = 1 - k;
      p.g.scale.set(1 - k * 0.6);
      if (k >= 1) {
        p.g.destroy();
        this.particles.splice(i, 1);
      }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]!;
      r.life += dt;
      const k = Math.min(1, r.life / r.max);
      const e = 1 - (1 - k) ** 3;
      r.g.clear().circle(r.x, r.y, r.r0 + (r.r1 - r.r0) * e).stroke({ width: r.width * (1 - k * 0.6), color: r.color, alpha: 1 - k });
      if (k >= 1) {
        r.g.destroy();
        this.rings.splice(i, 1);
      }
    }
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i]!;
      b.life += dt;
      const k = Math.min(1, b.life / b.max);
      b.g.alpha = 1 - k * k;
      if (k >= 1) {
        b.g.destroy();
        this.beams.splice(i, 1);
      }
    }
    if (this.flashRect.visible) {
      this.flashLife += dt;
      const k = Math.min(1, this.flashLife / this.flashMax);
      this.flashRect.alpha = this.flashAlpha * (1 - k);
      if (k >= 1) this.flashRect.visible = false;
    }
    if (this.shakeLife < this.shakeMax) {
      this.shakeLife += dt;
      const k = Math.min(1, this.shakeLife / this.shakeMax);
      const m = this.shakeMag * (1 - k);
      this.world.position.set((this.rand() * 2 - 1) * m, (this.rand() * 2 - 1) * m);
      if (k >= 1) this.world.position.set(0, 0);
    }
  }

  /** Drop every effect at once: the board was rebuilt under them. */
  clear(): void {
    for (const p of this.popups) p.t.destroy();
    for (const p of this.particles) p.g.destroy();
    for (const r of this.rings) r.g.destroy();
    for (const b of this.beams) b.g.destroy();
    this.popups.length = 0;
    this.particles.length = 0;
    this.rings.length = 0;
    this.beams.length = 0;
    this.callout = null;
    this.flashRect.visible = false;
    this.shakeLife = this.shakeMax;
    this.world.position.set(0, 0);
  }

  /** Scatter for effects only: nothing here reaches an engine, and a renderer must not use Math.random for anything a replay would show. */
  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
}
