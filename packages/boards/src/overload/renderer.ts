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
import { MOTION } from "../look/tokens.js";
import { FONT_MONO, INK, drawDot, mix } from "../kit/art.js";
import { Grid, KitBoard } from "../kit/board.js";
import { overloadColor, overloadPaint } from "./pieces.js";

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
  /** Mark a tap worth making after a pause. Off for recorded rounds. */
  hints: boolean;
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

/** A charge on its way from a burst to a neighbour: one dot, there because the rule needs showing. */
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
/** Chains this long are called out, and are the beat. */
const BIG = 10;
const HUGE = 20;
/** The lamp of the tap coming back: amber, turned down. */
const FILLING = mix(INK.ground, INK.amber, 0.45);

/** The ring round the player's own tap and the keyboard's cell: 2 units wide, 2 units off the piece. */
const RING_R = 0.45;
const RING_W = 0.07;

/** Draws the capacitor bank and turns a tap into a move. Scores nothing: every number it shows is the engine's. */
export class OverloadRenderer extends KitBoard<OverloadState> {
  private readonly grid = new Grid(6, 7);
  private readonly bg = new Graphics();
  private readonly capLayer = new Container();
  private readonly sparkLayer = new Graphics();
  private readonly hintLayer = new Graphics();
  private readonly cursorLayer = new Graphics();
  private readonly lamps = new Graphics();
  private label: Text | null = null;
  private labelText = "";
  private labelColor: number = INK.cream;
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
  private refusedAt = -10_000;
  private tickAt = 0;
  private sparks: Spark[] = [];
  /** The keyboard's cell. Drawn once a key has been used. */
  private cursor = 0;
  private cursorShown = false;
  private idle = 0;
  private hint: OverloadHint | null = null;
  private hintFor: readonly OverloadCell[] | null = null;
  private hints: boolean;

  constructor(
    host: HTMLElement,
    private readonly cb: OverloadCallbacks,
    private readonly opts: OverloadRendererOptions,
  ) {
    super(host, "overload", cb.onFrame);
    this.hints = opts.hints;
  }

  setHints(on: boolean): void {
    this.hints = on;
  }

  protected build(): void {
    this.label = new Text({ text: "", style: { fontFamily: FONT_MONO, fontSize: 16, fontWeight: "700", fill: INK.cream }, resolution: 2 });
    this.label.anchor.set(1, 0.5);
    this.world.addChild(this.bg, this.capLayer, this.sparkLayer, this.hintLayer, this.cursorLayer, this.lamps, this.label);
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
    // Bare ground under the strip and the bank, one hairline round it, and a dot where a spent capacitor leaves a gap.
    this.bg.clear();
    this.paintGround(this.bg, g.ox - pad, g.oy - strip - pad, g.width + pad * 2, g.height + strip + pad * 2);
    for (let i = 0; i < g.cols * g.rows; i++) drawDot(this.bg, g.x(i), g.y(i), g.cell);
    if (this.label) {
      this.label.style.fontSize = Math.max(12, Math.round(g.cell * 0.34));
      this.label.position.set(g.ox + g.width - pad * 0.5, g.oy - strip * 0.56);
    }
    this.cursor = Math.min(this.cursor, g.cols * g.rows - 1);
    this.publishGeom(g.ox, g.oy, g.cell);
    this.sparks = [];
    this.sparkLayer.clear();
    this.hint = null;
    this.hintLayer.clear();
    this.heldBack = 0;
    this.litShown = -1;
    this.labelHold = 0;
    if (this.state) {
      this.bank = this.state.cells;
      this.shownSeq = this.state.eventSeq;
      this.snap(this.state.cells);
    }
    this.drawLamps();
    this.drawCursor();
  }

  /** A capacitor's picture: its outline says plain or booster, its holes count the charge. */
  private texture(charge: number, booster: boolean): Texture {
    const c = Math.max(0, Math.min(OVERLOAD_FULL, charge));
    return this.piece(`${booster ? "booster" : "cap"}:${c}`, this.grid.cell, overloadColor(c), overloadPaint(c, booster));
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
      g.cols = state.config.width;
      g.rows = state.config.height;
      this.layout(this.app.screen.width, this.app.screen.height);
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
    this.hint = null;
    this.hintLayer.clear();
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
        // The charge lands at once, and the tap is ringed in amber: it is the player's own.
        this.setCharge(e.cell, e.charge);
        this.fx.ring(g.x(e.cell), g.y(e.cell), INK.amber, g.cell * RING_R, g.cell * RING_R, 260, Math.max(2, g.cell * RING_W));
        if (e.burst) t = 90;
        else {
          sfx.power((e.charge - 1) / 2);
          v.s.scale.set(0.88);
          this.tweens.move(v.s, { scale: 1 });
          t = MOTION.move;
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
        this.setLabel(L.chain(total, overloadChainValue(cfg, total)), INK.cream);
        this.labelHold = this.time + (n - k) * step + LABEL_HOLD_MS;
        if (!live) return;
        for (const c of w.bursts) {
          const boosted = w.boosted.includes(c);
          const x = g.x(c);
          const y = g.y(c);
          if (this.reduced) continue;
          for (const to of gained) {
            // The charge is seen to pass: one dot to each neighbour that took it from this burst.
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
        // A burst capacitor shrinks to nothing.
        this.tweens.remove(v.s, {
          delay: at,
          done: () => {
            v.s.visible = false;
          },
        });
      }
      // The charge arrives: each neighbour gains a hole, and one that is full now turns cream before it goes.
      this.later(arrive, () => {
        for (const i of gained) this.setCharge(i, w.charges[i]!);
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
      this.fx.popup(cx, cy - g.cell * 0.1, `+${e.points}`, INK.cream, Math.max(15, g.cell * (huge ? 0.74 : big ? 0.6 : long ? 0.46 : 0.36)));
      const top = e.streak === cfg.streakPercent.length && cfg.streakPercent.length > 1;
      // The beat is for a long chain, stronger for a longer one, and for a streak brought to its top.
      if (huge) {
        this.fx.say(L.hugeChain);
        this.beat(1);
      } else if (big) {
        this.fx.say(L.bigChain);
        this.beat(0.5 + Math.min(0.4, (e.size - BIG) * 0.04));
      } else if (top) {
        this.fx.say(L.streakMax);
        this.beat(0.4);
      } else if (long && (e.streak === 3 || e.streak === 6)) {
        this.fx.say(L.streak(e.streak, e.streakPercent));
        sfx.streak(e.streak);
      } else if (long) sfx.good();
      if (e.brokeStreak) {
        this.fx.popup(g.ox + g.width * 0.72, g.oy - g.cell * STRIP * 0.2, L.streakLost, INK.danger, Math.max(13, g.cell * 0.3));
        sfx.streakLost();
      }
      if (e.refund > 0) {
        // A tap given back is the player's own: amber, like the lamps it lights.
        this.fx.popup(g.ox + g.cell * 1.3, g.oy + g.cell * 0.1, L.refund(e.refund), INK.amber, Math.max(14, g.cell * 0.36));
        sfx.slag();
      }
    });

    // Fresh capacitors grow into the gaps.
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
        v.s.alpha = 1;
        v.s.scale.set(0);
      });
      this.tweens.move(v.s, { scale: 1 }, { delay: at + 1 });
    });
    this.later(tFresh, (live) => {
      if (live) sfx.whoosh();
    });
    return tFresh + e.fresh.length * gap + MOTION.move + 10;
  }

  protected view(): string {
    return this.views.map((v) => (v.live && v.s.visible ? overloadCellChar(v.charge, v.booster) : ".")).join("");
  }

  protected override update(dt: number): void {
    this.drawLamps();
    this.drawSparks(dt);
    const state = this.state;
    // The strip's text falls back to the streak once a chain's count has had its moment.
    if (state && !this.busy && this.time >= this.labelHold) {
      const streak = state.combo > 0 ? this.opts.labels.streak(state.combo, overloadStreakPercentAt(state.config, state.combo)) : "";
      this.setLabel(streak, INK.dim);
    }
    // A tap worth making is marked after a pause, in rounds that allow hints.
    if (!this.interactive || !this.hints || !state || state.finished || this.busy || state.taps < 1) {
      if (!this.interactive || !this.hints) this.idle = 0;
      if (this.hint) {
        this.hint = null;
        this.hintLayer.clear();
      }
      return;
    }
    this.idle += dt;
    if (this.idle < HINT_AFTER_MS) return;
    if (this.hintFor !== state.cells || !this.hint) {
      this.hintFor = state.cells;
      this.hint = overloadHint(state);
    }
    this.hintLayer.clear();
    if (!this.hint) return;
    const g = this.grid;
    const x = g.x(this.hint.cell);
    const y = g.y(this.hint.cell);
    // A hint is cream, never amber: it is the board's advice, not the player's own mark.
    const pulse = this.reduced ? 0.8 : 0.55 + 0.4 * Math.sin(this.time / 240);
    this.hintLayer.circle(x, y, g.cell * RING_R).stroke({ width: Math.max(2, g.cell * RING_W), color: INK.cream, alpha: pulse });
    if (this.hint.prime) {
      // A plus: this tap charges, the next one sets the chain off.
      const a = g.cell * 0.17;
      const w = Math.max(3, g.cell * 0.075);
      const px = x + g.cell * 0.3;
      const py = y - g.cell * 0.3;
      this.hintLayer.circle(px, py, a * 1.35).fill({ color: INK.ground });
      this.hintLayer.roundRect(px - a, py - w / 2, a * 2, w, w / 2).fill({ color: INK.cream });
      this.hintLayer.roundRect(px - w / 2, py - a, w, a * 2, w / 2).fill({ color: INK.cream });
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

  /**
   * The taps held, as lamps. A light is a dot: a lit one is amber, because the taps are the player's
   * own; the one coming back fills like a dial in a duller amber; the rest are empty sockets.
   */
  private drawLamps(): void {
    const l = this.lamps;
    l.clear();
    const state = this.state;
    if (!state) return;
    const g = this.grid;
    const cfg = state.config;
    const cap = cfg.tapCap;
    const lit = Math.max(0, Math.min(cap, state.taps - this.heldBack));
    // A tap came back on the clock: a soft knock. One a chain gave back has its own chime.
    if (this.litShown >= 0 && lit > this.litShown && this.interactive && !this.quietLamps) sfx.swapQuiet();
    this.litShown = lit;
    this.quietLamps = false;
    const gap = Math.min(g.cell * 0.5, (g.width * 0.56) / cap);
    const r = Math.min(g.cell * 0.19, gap * 0.4);
    const y = g.oy - g.cell * STRIP * 0.56;
    const x0 = g.ox + r + Math.max(2, g.cell * 0.06);
    // A tap the hand could not pay for: the sockets show danger for a moment.
    const refused = this.time - this.refusedAt < 360;
    // How far along the next tap is, eased between the engine's ticks while the round runs.
    const sub = this.interactive ? Math.min(1, (this.time - this.tickAt) / cfg.tickMs) : 0;
    const filling = this.heldBack === 0 && state.taps < cap ? Math.min(1, (overloadRegenProgress(state) + sub) / cfg.tapRegenTicks) : 0;
    for (let i = 0; i < cap; i++) {
      const x = x0 + i * gap;
      if (i < lit) l.circle(x, y, r * 0.78).fill({ color: INK.amber });
      else if (i === lit && filling > 0) {
        const a0 = -Math.PI / 2;
        l.moveTo(x, y)
          .arc(x, y, r * 0.78, a0, a0 + Math.PI * 2 * filling)
          .closePath()
          .fill({ color: FILLING });
      }
      l.circle(x, y, r).stroke({ width: Math.max(1.5, r * 0.2), color: refused ? INK.danger : INK.line });
    }
  }

  private drawSparks(dt: number): void {
    const s = this.sparkLayer;
    s.clear();
    if (this.sparks.length === 0) return;
    const size = Math.max(2.5, this.grid.cell * 0.07);
    const keep: Spark[] = [];
    for (const p of this.sparks) {
      p.age += dt * this.tweens.rate;
      const k = Math.min(1, p.age / p.ms);
      if (k < 1) keep.push(p);
      const e = 1 - (1 - k) ** 2;
      // A booster passes two charges: its dot is the bigger one.
      s.circle(p.x0 + (p.x1 - p.x0) * e, p.y0 + (p.y1 - p.y0) * e, size * (p.double ? 1.5 : 1)).fill({ color: INK.cream });
    }
    this.sparks = keep;
  }

  // ---- input

  /** Spend a tap on `cell`, if the engine would take it; say so when it would not. */
  private tap(cell: number): void {
    const state = this.state;
    if (!state || state.finished) return;
    const follow = this.hint?.prime === true && this.hint.cell === cell;
    this.idle = 0;
    if (overloadTapIllegalReason(state, cell, state.tick) !== null || !this.cb.onTap(cell)) {
      this.refuse();
      return;
    }
    // A hinted charge is half the advice: the tap it sets up is marked soon after.
    if (follow) this.idle = HINT_AFTER_MS - HINT_FOLLOW_MS;
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
    this.cursor = at.index;
    this.cursorShown = false;
    this.drawCursor();
    this.tap(at.index);
  }

  private drawCursor(): void {
    const g = this.grid;
    this.cursorLayer.clear();
    this.app.canvas.setAttribute("data-cursor", `${this.cursor % g.cols},${Math.floor(this.cursor / g.cols)}`);
    if (!this.cursorShown) return;
    // The keyboard's cell is the player's selection: an amber ring round the piece.
    this.cursorLayer.circle(g.x(this.cursor), g.y(this.cursor), g.cell * RING_R).stroke({ width: Math.max(2, g.cell * RING_W), color: INK.amber });
  }

  /** Arrows or WASD move the cursor; space or enter taps the capacitor under it. */
  override keyboard(key: string): boolean {
    if (!this.interactive || !this.state) return false;
    const g = this.grid;
    const k = key.length === 1 ? key.toLowerCase() : key;
    const steps: Record<string, readonly [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      a: [-1, 0],
      d: [1, 0],
      w: [0, -1],
      s: [0, 1],
    };
    const step = steps[k];
    if (step) {
      const col = Math.max(0, Math.min(g.cols - 1, (this.cursor % g.cols) + step[0]));
      const row = Math.max(0, Math.min(g.rows - 1, Math.floor(this.cursor / g.cols) + step[1]));
      this.cursor = row * g.cols + col;
      this.cursorShown = true;
      this.idle = 0;
      this.drawCursor();
      return true;
    }
    if (k === " " || k === "Enter") {
      this.cursorShown = true;
      this.drawCursor();
      this.tap(this.cursor);
      return true;
    }
    return false;
  }
}
