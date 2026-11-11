import { Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import {
  OVERLOAD_FULL,
  overloadCellChar,
  overloadChainValue,
  overloadHint,
  overloadRegenProgress,
  overloadStreakPercentAt,
  overloadTapIllegalReason,
  type OverloadCell,
  type OverloadEvent,
  type OverloadHint,
  type OverloadState,
} from "@openseas/engine";
import { sfx } from "../audio.js";
import { FONT, INK, drawPanel, drawWell, mix } from "../kit/art.js";
import { Grid, GridCursor, KitBoard } from "../kit/board.js";
import { ease } from "../kit/tween.js";

export interface OverloadCallbacks {
  /** The player tapped a capacitor. Returns false when the round did not take the tap. */
  onTap(cell: number): boolean;
  /** First settled frame after a new state. */
  onFrame(): void;
}

export interface OverloadLabels {
  /** The chain playing out: its bursts so far and what that many are worth. */
  chain(count: number, points: number): string;
  streak(count: number, percent: number): string;
  streakMax: string;
  streakLost: string;
  bigChain: string;
  hugeChain: string;
  refund(count: number): string;
  noTaps: string;
}

export interface OverloadRendererOptions {
  showMarks: boolean;
  labels: OverloadLabels;
}

type ChainEvent = Extract<OverloadEvent, { type: "chain" }>;

interface CapView {
  s: Sprite;
  id: number;
  /** The charge drawn, which trails the engine's while a chain plays. */
  charge: number;
  booster: boolean;
  /** False from the moment it bursts until a fresh capacitor takes its place. */
  live: boolean;
}

interface Spark {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  age: number;
  ms: number;
  double: boolean;
}

/** The strip over the bank, in cells: the tap lamps and the chain count. */
const STRIP = 0.95;
const WAVE_MS = 190;
const HINT_AFTER_MS = 5000;
/** After a hinted priming tap, the tap it set up is marked this soon. */
const HINT_FOLLOW_MS = 1200;
const LABEL_HOLD_MS = 1300;
/** Chains this long get a callout and a shake. */
const BIG = 10;
const HUGE = 20;

/** One color a charge, as a second cue: the lit parts of the ring carry the count. */
const CHARGE_COLOR = [0x4a5f86, 0x58c4f6, 0xf5d021, 0xff6b5e, 0xffffff] as const;
const CASE = 0x1a2942;
const RIM = 0x4d6b9c;
const UNLIT = 0x2a3d60;
const SPARK = 0xfff2c4;
const LAMP = 0x7fd7ff;

/** Draws the capacitor bank and turns a tap into a move. Scores nothing: every number it shows is the engine's. */
export class OverloadRenderer extends KitBoard<OverloadState> {
  private readonly grid = new Grid(6, 7);
  private readonly bg = new Graphics();
  private readonly glow = new Graphics();
  private readonly capLayer = new Container();
  private readonly sparkLayer = new Graphics();
  private readonly hintLayer = new Graphics();
  private readonly cursorLayer = new Graphics();
  private readonly lamps = new Graphics();
  private label: Text | null = null;
  private labelText = "";
  private labelColor: number = INK.text;
  /** The chain's count stays in the strip until this time. */
  private labelHold = 0;
  private views: CapView[] = [];
  /** The engine's bank the board shows, or is playing its way to. A state with the same one only moved the clock. */
  private bank: readonly OverloadCell[] | null = null;
  /** The `seq` of the last engine event played. */
  private shownSeq = 0;
  /** Taps a chain gave back that its animation has not handed over yet. */
  private heldBack = 0;
  private litShown = -1;
  private quietLamps = false;
  private readonly lampLitAt: number[] = [];
  private refusedAt = -10_000;
  private tickAt = 0;
  private sparks: Spark[] = [];
  private readonly cursor = new GridCursor(this.grid, this.cursorLayer);
  /** A tap worth making is marked after a pause, in rounds that allow hints, while there is a tap to make it with. */
  private readonly hint = this.idleHint<OverloadHint>({
    after: HINT_AFTER_MS,
    layer: this.hintLayer,
    held: () => (this.state?.taps ?? 0) < 1,
    // A state that only moves the clock keeps the advice.
    key: (state) => state.cells,
    compute: (state) => overloadHint(state),
    draw: (hint, beat) => {
      const g = this.grid;
      const x = g.x(hint.cell);
      const y = g.y(hint.cell);
      const wave = beat * 2 - 1;
      const pulse = this.reduced ? 0.8 : 0.55 + 0.4 * wave;
      const r = g.cell * (0.46 + (this.reduced ? 0 : 0.025 * wave));
      this.hintLayer.circle(x, y, r).stroke({ width: Math.max(2.5, g.cell * 0.06), color: INK.white, alpha: pulse });
      if (hint.prime) {
        // A plus: this tap charges, the next one sets the chain off.
        const a = g.cell * 0.17;
        const w = Math.max(3, g.cell * 0.075);
        const px = x + g.cell * 0.3;
        const py = y - g.cell * 0.3;
        this.hintLayer.circle(px, py, a * 1.25).fill({ color: INK.bg, alpha: 0.85 });
        this.hintLayer.roundRect(px - a, py - w / 2, a * 2, w, w / 2).fill({ color: INK.white });
        this.hintLayer.roundRect(px - w / 2, py - a, w, a * 2, w / 2).fill({ color: INK.white });
      }
    },
  });

  constructor(
    host: HTMLElement,
    private readonly cb: OverloadCallbacks,
    private readonly opts: OverloadRendererOptions,
  ) {
    super(host, "overload", cb.onFrame, opts.showMarks);
  }

  protected build(): void {
    this.label = new Text({ text: "", style: { fontFamily: FONT, fontSize: 16, fontWeight: "700", fill: INK.text, letterSpacing: 0.5 } });
    this.label.anchor.set(1, 0.5);
    this.world.addChild(this.bg, this.glow, this.capLayer, this.sparkLayer, this.hintLayer, this.cursorLayer, this.lamps, this.label);
  }

  protected layout(width: number, height: number): void {
    const g = this.grid;
    if (this.state) {
      g.cols = this.state.config.width;
      g.rows = this.state.config.height;
    }
    g.fit(width, height, { top: STRIP, margin: 8 });
    const pad = Math.max(4, g.cell * 0.12);
    const strip = g.cell * STRIP;
    this.bg.clear();
    drawPanel(this.bg, g.ox - pad, g.oy - strip - pad, g.width + pad * 2, g.height + strip + pad * 2, Math.max(10, g.cell * 0.28));
    for (let i = 0; i < g.cols * g.rows; i++) drawWell(this.bg, g.x(i) - g.cell / 2, g.y(i) - g.cell / 2, g.cell);
    this.bg.roundRect(g.ox, g.oy - Math.max(3, pad * 0.6), g.width, 2, 1).fill({ color: INK.edge, alpha: 0.5 });
    if (this.label) {
      this.label.style.fontSize = Math.max(12, Math.round(g.cell * 0.34));
      this.label.position.set(g.ox + g.width - pad * 0.5, g.oy - strip * 0.56);
    }
    this.publishGeom(g.ox, g.oy, g.cell);
    this.sparks = [];
    this.sparkLayer.clear();
    this.heldBack = 0;
    this.litShown = -1;
    this.labelHold = 0;
    if (this.state) {
      this.bank = this.state.cells;
      this.shownSeq = this.state.eventSeq;
      this.snap(this.state.cells);
    }
    this.drawLamps();
    this.cursor.draw(this.app.canvas);
  }

  private texture(charge: number, booster: boolean): Texture {
    const cell = this.grid.cell;
    const c = Math.max(0, Math.min(OVERLOAD_FULL, charge));
    // The cell size is in the key: a lab bank of another size is laid out without the cache being dropped.
    return this.bake(`${cell}:${c}:${booster ? 1 : 0}:${this.showMarks ? 1 : 0}`, cell, (g) => {
      const r = cell * 0.37;
      // The sheet's arcs count the charge as the code-drawn ring does; the mark setting adds the digit on a plate.
      if (!this.sprite(g, `${booster ? "booster" : "charge"}-${c}`, 0, 0, cell * (booster ? 0.915 : 0.84))) {
        drawCapacitor(g, r, c, booster, this.showMarks);
        return;
      }
      if (!this.showMarks) return;
      const armed = c >= OVERLOAD_FULL - 1;
      const core = r * 0.5;
      g.circle(0, 0, core).fill({ color: armed ? CHARGE_COLOR[c]! : INK.bg });
      g.circle(0, 0, core).stroke({ width: Math.max(1, r * 0.06), color: INK.white, alpha: 0.6 });
      drawDigit(g, Math.min(OVERLOAD_FULL - 1, c), core * 0.6, armed ? INK.black : INK.white);
    });
  }

  /** Put exactly these capacitors on the bank, each on its cell, with nothing in motion. */
  private snap(cells: readonly OverloadCell[]): void {
    const g = this.grid;
    while (this.views.length > cells.length) this.views.pop()!.s.destroy();
    cells.forEach((c, i) => {
      let v = this.views[i];
      if (!v) {
        const s = new Sprite();
        s.anchor.set(0.5);
        this.capLayer.addChild(s);
        v = { s, id: c.id, charge: c.charge, booster: c.booster, live: true };
        this.views[i] = v;
      }
      v.id = c.id;
      v.charge = c.charge;
      v.booster = c.booster;
      v.live = true;
      v.s.texture = this.texture(c.charge, c.booster);
      v.s.position.set(g.x(i), g.y(i));
      v.s.scale.set(1);
      v.s.alpha = 1;
      v.s.visible = true;
    });
    this.touchView();
  }

  /** A state that only carries the clock forward, or a logged wait: the bank and its events are the ones already playing. */
  protected override keepsPlaying(state: OverloadState, prev: OverloadState | null): boolean {
    return prev !== null && state.cells === prev.cells && state.eventSeq === prev.eventSeq;
  }

  protected onState(state: OverloadState, prev: OverloadState | null): void {
    const g = this.grid;
    if (g.cols !== state.config.width || g.rows !== state.config.height) {
      // A different bank (a lab config): lay it out afresh.
      this.relayout();
      return;
    }
    if (!prev || state.tick !== prev.tick) this.tickAt = this.time;
    // Only the clock moved: the lamps are drawn from the state every frame.
    if (state.cells === this.bank) return;
    const events = (state.lastMove?.events ?? []).filter((e) => e.seq > this.shownSeq);
    // The move is played when it is the next one after what is drawn; anything else (a new round, a jump in a review) is shown as it stands.
    const follows = prev !== null && events.length > 0 && events[0]!.seq === this.shownSeq + 1 && this.views.length === prev.cells.length && prev.cells.every((c, i) => this.views[i]!.id === c.id);
    this.bank = state.cells;
    this.shownSeq = state.eventSeq;
    if (!follows) {
      this.heldBack = 0;
      this.litShown = -1;
      this.labelHold = 0;
      this.sparks = [];
      this.snap(state.cells);
      return;
    }
    this.play(state, events);
  }

  /**
   * Run `fn` in `ms`. It is told whether it ran on time: a new state flushes what is still playing,
   * and a flushed step must still leave the board right but makes no sound and no effect.
   */
  private later(ms: number, fn: (live: boolean) => void): void {
    const due = this.time + ms / this.tweens.rate;
    this.tweens.after(ms, () => fn(this.time >= due - 20));
  }

  private setCharge(cell: number, charge: number): void {
    const v = this.views[cell];
    if (!v) return;
    v.charge = charge;
    v.s.texture = this.texture(charge, v.booster);
  }

  /** Play the events of one move: the tap's charge landing, then the chain it set off, wave by wave. */
  private play(state: OverloadState, events: readonly OverloadEvent[]): void {
    const g = this.grid;
    let t = 0;
    for (const e of events) {
      if (e.type === "tap") {
        const v = this.views[e.cell];
        if (!v) continue;
        // The charge lands at once: the tap is the player's own.
        this.setCharge(e.cell, e.charge);
        this.fx.ring(g.x(e.cell), g.y(e.cell), CHARGE_COLOR[Math.min(OVERLOAD_FULL, e.charge)]!, g.cell * 0.3, g.cell * 0.56, 260, 3);
        if (e.burst) {
          v.s.scale.set(1.14);
          t = 90;
        } else {
          sfx.power((e.charge - 1) / 2);
          v.s.scale.set(1.24);
          this.tweens.to(v.s, { scale: 1 }, 180, { ease: ease.outBack });
          t = 180;
        }
      } else t = this.playChain(state, e, t);
    }
    // Whatever the tweens did, the bank ends as the engine holds it.
    this.tweens.after(t + 10, () => {
      this.heldBack = 0;
      this.snap(state.cells);
    });
  }

  /** Schedule a chain from `t0`: each wave's bursts, the charge they pass, the count climbing, then the score and the fresh capacitors. Returns when it ends. */
  private playChain(state: OverloadState, e: ChainEvent, t0: number): number {
    const g = this.grid;
    const cfg = state.config;
    const L = this.opts.labels;
    const n = e.waves.length;
    const step = n <= 8 ? WAVE_MS : Math.max(110, Math.round(1500 / n));
    this.heldBack = e.refund;
    this.quietLamps = true;
    const before = this.views.map((v) => v.charge);
    const spent = new Set<number>();
    let count = 0;
    let sumX = 0;
    let sumY = 0;

    e.waves.forEach((w, k) => {
      const at = t0 + k * step;
      const from = k === 0 ? before : e.waves[k - 1]!.charges;
      for (const c of w.bursts) {
        spent.add(c);
        sumX += g.x(c);
        sumY += g.y(c);
      }
      count += w.bursts.length;
      const total = count;
      // The live capacitors this wave passed charge to, read off the engine's own numbers.
      const gained: number[] = [];
      for (let i = 0; i < w.charges.length; i++) if (!spent.has(i) && w.charges[i]! > (from[i] ?? 0)) gained.push(i);
      const arrive = at + step * 0.62;

      this.later(at, (live) => {
        for (const c of w.bursts) {
          const v = this.views[c];
          if (v) v.live = false;
        }
        this.setLabel(L.chain(total, overloadChainValue(cfg, total)), INK.gold);
        this.labelHold = this.time + (n - k) * step + LABEL_HOLD_MS;
        if (!live) return;
        for (const c of w.bursts) {
          const boosted = w.boosted.includes(c);
          const x = g.x(c);
          const y = g.y(c);
          this.fx.burst(x, y, boosted ? INK.brass : CHARGE_COLOR[3], boosted ? 10 : 6, 0.2, 3.2);
          this.fx.ring(x, y, boosted ? INK.brass : SPARK, g.cell * 0.3, g.cell * (boosted ? 1.3 : 0.82), 300, boosted ? 4 : 3);
          if (this.reduced) continue;
          for (const to of gained) {
            // A spark flies to each neighbour that took charge from this burst.
            const dc = Math.abs((to % g.cols) - (c % g.cols));
            const dr = Math.abs(Math.floor(to / g.cols) - Math.floor(c / g.cols));
            if (dc + dr === 1) this.sparks.push({ x0: x, y0: y, x1: g.x(to), y1: g.y(to), age: 0, ms: step * 0.62, double: boosted });
          }
        }
        // Each wave pops a step higher than the last.
        sfx.pop(Math.min(9, k));
        if (k === 0 || w.boosted.length > 0) sfx.zap();
      });
      for (const c of w.bursts) {
        const v = this.views[c];
        if (!v) continue;
        this.tweens.to(v.s, { scale: 1.55, alpha: 0 }, 170, {
          delay: at,
          ease: ease.outCubic,
          done: () => {
            v.s.visible = false;
          },
        });
      }
      // The charge arrives: the neighbours' rings fill, and one that is full now swells before it goes.
      this.later(arrive, () => {
        for (const i of gained) {
          const v = this.views[i];
          if (!v) continue;
          this.setCharge(i, w.charges[i]!);
          if (w.charges[i]! >= OVERLOAD_FULL) v.s.scale.set(1.14);
          else {
            v.s.scale.set(1.16);
            this.tweens.to(v.s, { scale: 1 }, 110, { ease: ease.outCubic });
          }
        }
      });
    });

    const tEnd = t0 + n * step + 60;
    const cx = sumX / Math.max(1, e.size);
    const cy = sumY / Math.max(1, e.size);
    this.later(tEnd, (live) => {
      this.heldBack = 0;
      this.quietLamps = e.refund > 0;
      if (!live) return;
      const big = e.size >= BIG;
      const huge = e.size >= HUGE;
      const long = e.size >= cfg.streakMin;
      this.fx.popup(cx, cy - g.cell * 0.1, `+${e.points}`, INK.gold, Math.max(15, g.cell * (huge ? 0.74 : big ? 0.6 : long ? 0.46 : 0.36)));
      const top = e.streak === cfg.streakPercent.length && cfg.streakPercent.length > 1;
      if (huge) {
        this.fx.say(L.hugeChain, INK.gold);
        this.fx.flash(SPARK, 0.22, 320);
        this.fx.shake(12, 400);
        sfx.charge();
      } else if (big) {
        this.fx.say(L.bigChain, INK.gold);
        this.fx.flash(SPARK, 0.14, 260);
        this.fx.shake(7, 280);
        sfx.thud();
        sfx.multi(3);
      } else if (top) {
        this.fx.say(L.streakMax, LAMP);
        sfx.streak(e.streak);
      } else if (long && (e.streak === 3 || e.streak === 6)) {
        this.fx.say(L.streak(e.streak, e.streakPercent), LAMP);
        sfx.streak(e.streak);
      } else if (long) sfx.good();
      if (e.brokeStreak) {
        this.fx.popup(g.ox + g.width * 0.72, g.oy - g.cell * STRIP * 0.2, L.streakLost, INK.danger, Math.max(13, g.cell * 0.3));
        sfx.streakLost();
      }
      if (e.refund > 0) {
        this.fx.popup(g.ox + g.cell * 1.3, g.oy + g.cell * 0.1, L.refund(e.refund), INK.good, Math.max(14, g.cell * 0.36));
        sfx.slag();
      }
    });

    // Fresh capacitors drop into the spent wells.
    const tFresh = tEnd + 140;
    const gap = Math.min(28, 220 / Math.max(1, e.fresh.length));
    e.fresh.forEach((f, i) => {
      const v = this.views[f.cell];
      if (!v) return;
      const at = tFresh + i * gap;
      this.later(at, () => {
        v.id = f.id;
        v.charge = f.charge;
        v.booster = f.booster;
        v.live = true;
        v.s.texture = this.texture(f.charge, f.booster);
        v.s.visible = true;
        v.s.alpha = 0;
        v.s.scale.set(0.4);
      });
      this.tweens.to(v.s, { scale: 1, alpha: 1 }, 200, { delay: at + 1, ease: ease.outBack });
    });
    this.later(tFresh, (live) => {
      if (live) sfx.whoosh();
    });
    return tFresh + e.fresh.length * gap + 210;
  }

  protected view(): string {
    return this.views.map((v) => (v.live && v.s.visible ? overloadCellChar(v.charge, v.booster) : ".")).join("");
  }

  protected override update(dt: number): void {
    this.drawLamps();
    this.drawGlow();
    this.drawSparks(dt);
    const state = this.state;
    // The strip's text falls back to the streak once a chain's count has had its moment.
    if (state && !this.busy && this.time >= this.labelHold) {
      const streak = state.combo > 0 ? this.opts.labels.streak(state.combo, overloadStreakPercentAt(state.config, state.combo)) : "";
      this.setLabel(streak, INK.dim);
    }
  }

  // ---- the strip

  private setLabel(text: string, color: number): void {
    if (!this.label || (text === this.labelText && color === this.labelColor)) return;
    this.labelText = text;
    this.labelColor = color;
    this.label.text = text;
    this.label.style.fill = color;
  }

  /** The taps held, as lamps: a lit one is a filled disc, the one coming back fills like a dial, the rest are empty sockets. */
  private drawLamps(): void {
    const l = this.lamps;
    l.clear();
    const state = this.state;
    if (!state) return;
    const g = this.grid;
    const cfg = state.config;
    const cap = cfg.tapCap;
    const lit = Math.max(0, Math.min(cap, state.taps - this.heldBack));
    if (this.litShown >= 0 && lit > this.litShown) {
      for (let i = this.litShown; i < lit; i++) this.lampLitAt[i] = this.time;
      // A tap came back on the clock: a soft knock. One a chain gave back has its own chime.
      if (this.interactive && !this.quietLamps) sfx.swapQuiet();
    }
    this.litShown = lit;
    this.quietLamps = false;
    const gap = Math.min(g.cell * 0.5, (g.width * 0.56) / cap);
    const r = Math.min(g.cell * 0.19, gap * 0.4);
    const y = g.oy - g.cell * STRIP * 0.56;
    const x0 = g.ox + r + Math.max(2, g.cell * 0.06);
    const refused = this.time - this.refusedAt < 360;
    // How far along the next tap is, eased between the engine's ticks while the round runs.
    const sub = this.interactive ? Math.min(1, (this.time - this.tickAt) / cfg.tickMs) : 0;
    const filling = this.heldBack === 0 && state.taps < cap ? Math.min(1, (overloadRegenProgress(state) + sub) / cfg.tapRegenTicks) : 0;
    for (let i = 0; i < cap; i++) {
      const x = x0 + i * gap + (refused && !this.reduced ? Math.sin(this.time / 22 + i) * r * 0.25 : 0);
      l.circle(x, y, r).fill({ color: INK.well });
      if (i < lit) {
        const fresh = Math.max(0, 1 - (this.time - (this.lampLitAt[i] ?? -10_000)) / 420);
        if (fresh > 0) l.circle(x, y, r * (1.3 + fresh * 0.9)).fill({ color: LAMP, alpha: 0.3 * fresh });
        l.circle(x, y, r * 0.78).fill({ color: mix(LAMP, INK.white, 0.25 + fresh * 0.5) });
        l.circle(x - r * 0.2, y - r * 0.24, r * 0.26).fill({ color: INK.white, alpha: 0.6 });
      } else if (i === lit && filling > 0) {
        const a0 = -Math.PI / 2;
        l.moveTo(x, y)
          .arc(x, y, r * 0.78, a0, a0 + Math.PI * 2 * filling)
          .closePath()
          .fill({ color: LAMP, alpha: 0.5 });
      }
      l.circle(x, y, r).stroke({ width: Math.max(1.5, r * 0.2), color: refused ? INK.danger : i < lit ? mix(LAMP, INK.black, 0.25) : INK.edge });
    }
  }

  /** A capacitor at three is armed: a soft halo breathes under it. */
  private drawGlow(): void {
    const g = this.grid;
    this.glow.clear();
    for (let i = 0; i < this.views.length; i++) {
      const v = this.views[i]!;
      if (!v.live || !v.s.visible || v.charge < OVERLOAD_FULL - 1) continue;
      const a = this.reduced ? 0.14 : 0.11 + 0.07 * Math.sin(this.time / 230 + i * 1.7);
      this.glow.circle(g.x(i), g.y(i), g.cell * 0.47).fill({ color: CHARGE_COLOR[3], alpha: a });
    }
  }

  private drawSparks(dt: number): void {
    const s = this.sparkLayer;
    s.clear();
    if (this.sparks.length === 0) return;
    const size = Math.max(2, this.grid.cell * 0.065);
    const keep: Spark[] = [];
    for (const p of this.sparks) {
      p.age += dt * this.tweens.rate;
      const k = Math.min(1, p.age / p.ms);
      if (k < 1) keep.push(p);
      const e = 1 - (1 - k) ** 2;
      const tail = Math.max(0, e - 0.28);
      const x = p.x0 + (p.x1 - p.x0) * e;
      const y = p.y0 + (p.y1 - p.y0) * e;
      s.moveTo(p.x0 + (p.x1 - p.x0) * tail, p.y0 + (p.y1 - p.y0) * tail)
        .lineTo(x, y)
        .stroke({ width: size * (p.double ? 1.5 : 0.9), color: p.double ? INK.brass : SPARK, alpha: 0.55, cap: "round" });
      s.circle(x, y, size * (p.double ? 1.5 : 1)).fill({ color: INK.white });
    }
    this.sparks = keep;
  }

  // ---- input

  /** Spend a tap on `cell`, if the engine would take it; say so when it would not. */
  private tap(cell: number): void {
    const state = this.state;
    if (!state || state.finished) return;
    const shown = this.hint.current;
    const follow = shown?.prime === true && shown.cell === cell;
    this.hint.restart();
    if (overloadTapIllegalReason(state, cell, state.tick) !== null || !this.cb.onTap(cell)) {
      this.refuse();
      return;
    }
    // A hinted charge is half the advice: the tap it sets up is marked soon after.
    if (follow) this.hint.restart(HINT_FOLLOW_MS);
  }

  private refuse(): void {
    const g = this.grid;
    sfx.bump();
    // The only tap a running round refuses is one the hand cannot pay for.
    if (this.time - this.refusedAt > 700) {
      this.fx.popup(g.ox + g.cell * 1.3, g.oy + g.cell * 0.1, this.opts.labels.noTaps, INK.danger, Math.max(13, g.cell * 0.32));
    }
    this.refusedAt = this.time;
  }

  protected override pointerDown(x: number, y: number): void {
    const at = this.grid.at(x, y);
    if (!at) return;
    this.cursor.index = at.index;
    this.cursor.shown = false;
    this.cursor.draw(this.app.canvas);
    this.tap(at.index);
  }

  /** Arrows or WASD move the cursor; space or enter taps the capacitor under it. */
  override keyboard(key: string): boolean {
    if (!this.interactive || !this.state) return false;
    if (this.cursor.move(key)) {
      this.hint.restart();
      this.cursor.draw(this.app.canvas);
      return true;
    }
    if (key === " " || key === "Enter") {
      this.cursor.shown = true;
      this.cursor.draw(this.app.canvas);
      this.tap(this.cursor.index);
      return true;
    }
    return false;
  }
}

/**
 * A capacitor of radius `r` centred on (0, 0): a round case, a ring cut in three with one part lit
 * for each charge, and a core that shows a bolt at three (or the charge as a digit, with marks on).
 * A booster has a second ring and four lugs pointing at its neighbours, so it reads by shape.
 */
function drawCapacitor(g: Graphics, r: number, charge: number, booster: boolean, marks: boolean): void {
  const color = CHARGE_COLOR[Math.min(OVERLOAD_FULL, charge)]!;
  const armed = charge >= OVERLOAD_FULL - 1;
  if (booster) {
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      g.poly([dx * r * 1.3, dy * r * 1.3, dx * r * 0.98 - dy * r * 0.24, dy * r * 0.98 + dx * r * 0.24, dx * r * 0.98 + dy * r * 0.24, dy * r * 0.98 - dx * r * 0.24]).fill({ color: INK.brass });
    }
    g.circle(0, 0, r * 1.1).stroke({ width: Math.max(1.5, r * 0.09), color: INK.brass });
  }
  g.circle(0, r * 0.09, r).fill({ color: INK.black, alpha: 0.35 });
  g.circle(0, 0, r).fill({ color: CASE });
  g.circle(0, 0, r).stroke({ width: Math.max(1.2, r * 0.09), color: booster ? mix(INK.brass, INK.black, 0.2) : RIM });
  const rr = r * 0.7;
  for (let i = 0; i < 3; i++) {
    const a0 = -Math.PI / 2 + (i * Math.PI * 2) / 3 + 0.24;
    const a1 = a0 + (Math.PI * 2) / 3 - 0.48;
    g.moveTo(Math.cos(a0) * rr, Math.sin(a0) * rr)
      .arc(0, 0, rr, a0, a1)
      .stroke({ width: r * 0.2, color: i < charge ? color : UNLIT, cap: "round" });
  }
  // With marks on the core is a plate for the digit; without, it grows a dot for each charge and shows a bolt at three.
  const core = r * (marks ? 0.48 : 0.42);
  g.circle(0, 0, core).fill({ color: armed ? color : mix(CASE, INK.black, 0.4) });
  if (marks) drawDigit(g, Math.min(OVERLOAD_FULL - 1, charge), core * 0.6, armed ? INK.black : INK.white);
  else if (armed) drawBolt(g, core * 0.78, mix(color, INK.black, 0.8));
  else if (charge > 0) g.circle(0, 0, core * 0.3 * charge).fill({ color, alpha: 0.85 });
}

/** A lightning bolt in a box of half-height `s`. */
function drawBolt(g: Graphics, s: number, color: number): void {
  g.poly([0.2 * s, -s, -0.58 * s, 0.14 * s, -0.04 * s, 0.14 * s, -0.2 * s, s, 0.58 * s, -0.16 * s, 0.04 * s, -0.16 * s]).fill({ color });
}

/** The seven segments each digit lights: top, top right, bottom right, bottom, bottom left, top left, middle. */
const SEGMENTS: readonly string[] = ["abcdef", "bc", "abged", "abgcd"];

/** A digit of 0 to 3 in seven segments, half-height `s`: the charge as a mark that needs no color and no count. */
function drawDigit(g: Graphics, digit: number, s: number, color: number): void {
  const w = s * 0.56;
  const th = Math.max(1.5, s * 0.3);
  if (digit === 1) {
    // A one stands in the middle, not on the right-hand segments.
    g.roundRect(-th / 2, -s - th / 2, th, s * 2 + th, th / 2).fill({ color });
    return;
  }
  const lit = SEGMENTS[digit] ?? "";
  const h = (y: number): void => {
    g.roundRect(-w, y - th / 2, w * 2, th, th / 2).fill({ color });
  };
  const v = (x: number, y0: number): void => {
    g.roundRect(x - th / 2, y0, th, s, th / 2).fill({ color });
  };
  if (lit.includes("a")) h(-s);
  if (lit.includes("g")) h(0);
  if (lit.includes("d")) h(s);
  if (lit.includes("f")) v(-w, -s);
  if (lit.includes("b")) v(w, -s);
  if (lit.includes("e")) v(-w, 0);
  if (lit.includes("c")) v(w, 0);
}
