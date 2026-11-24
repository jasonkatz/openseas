import { Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import {
  forgingHint,
  forgingMarkChar,
  forgingStrikeIllegalReason,
  forgingTargets,
  forgingUpcoming,
  type ForgingMark,
  type ForgingSpot,
  type ForgingState,
  type ForgingStrike,
} from "@openseas/engine";
import { sfx } from "../audio.js";
import { MOTION } from "../look/tokens.js";
import { FONT_MONO, INK, drawDot } from "../kit/art.js";
import { Grid, KitBoard } from "../kit/board.js";
import { forgingColor, forgingFit, forgingPaint } from "./pieces.js";

export interface ForgingCallbacks {
  /** The player struck the spot at `cell`. */
  onStrike(cell: number): void;
  /** First settled frame after a new state. */
  onFrame(): void;
}

export interface ForgingLabels {
  next: string;
  chain(count: number, points: number): string;
  /** The chain running, between strikes. */
  chainRunning(count: number): string;
  count: string;
  span: string;
  weave(count: number): string;
  setLost: string;
  stall(points: number): string;
  free: string;
  spark: string;
  done: string;
}

export interface ForgingRendererOptions {
  /** Ring a strike worth making after a pause. Off for recorded rounds. */
  hints: boolean;
  labels: ForgingLabels;
}

interface SpotView {
  s: Sprite;
  heat: number;
  mark: ForgingMark;
}

/** The strip over the plate, in cells: the marks coming next, and the chain running. */
const STRIP = 0.95;
const HINT_AFTER_MS = 6000;
/** The ring round a lit spot, the press and the hint: 2 units off the tile. */
const RING_R = 0.47;
const RING_W = 0.06;
/** A spot the press cannot reach is drawn this faint while it has somewhere to go. */
const UNLIT = 0.38;
/** How long a strike takes to play, before the plate is shown as the engine holds it. */
const PLAY_MS = 420;

/** Draws the plate and turns a tap or a key into a strike. Scores nothing: every number it shows is the engine's. */
export class ForgingRenderer extends KitBoard<ForgingState> {
  private readonly grid = new Grid(6, 6);
  private readonly bg = new Graphics();
  private readonly dots = new Graphics();
  private readonly rings = new Graphics();
  private readonly spotLayer = new Container();
  private readonly previewLayer = new Container();
  private readonly hintLayer = new Graphics();
  private readonly cursorLayer = new Graphics();
  private label: Text | null = null;
  private nextLabel: Text | null = null;
  private views: SpotView[] = [];
  private previews: Sprite[] = [];
  /** The mark last struck, at the strip's right end: it is what says where the press lands next. */
  private readonly lead = new Sprite();
  private readonly leadFrame = new Graphics();
  /** While a strike plays, the rings wait: they are drawn for the plate as it will be. */
  private ringsHeld = false;
  private refused: { cell: number; at: number } | null = null;
  /** The keyboard's spot. Drawn once a key has been used. */
  private cursor = 0;
  private cursorShown = false;
  private idle = 0;
  private hint: number | null = null;
  private hintFor: ForgingState | null = null;
  private hints: boolean;

  constructor(
    host: HTMLElement,
    private readonly cb: ForgingCallbacks,
    private readonly opts: ForgingRendererOptions,
  ) {
    super(host, "forging", cb.onFrame);
    this.hints = opts.hints;
  }

  setHints(on: boolean): void {
    this.hints = on;
  }

  protected build(): void {
    const style = { fontFamily: FONT_MONO, fontSize: 16, fontWeight: "700" as const, fill: INK.cream };
    this.label = new Text({ text: "", style, resolution: 2 });
    this.label.anchor.set(1, 0.5);
    this.nextLabel = new Text({ text: this.opts.labels.next, style: { ...style, fill: INK.dim }, resolution: 2 });
    this.nextLabel.anchor.set(0, 0.5);
    this.lead.anchor.set(0.5);
    this.world.addChild(this.bg, this.dots, this.rings, this.spotLayer, this.hintLayer, this.cursorLayer, this.previewLayer, this.leadFrame, this.lead, this.nextLabel, this.label);
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
    this.paintGround(this.bg, g.ox - pad, g.oy - strip - pad, g.width + pad * 2, g.height + strip + pad * 2);
    const fontSize = Math.max(12, Math.round(g.cell * 0.3));
    const leadSize = Math.round(g.cell * 0.62);
    this.lead.position.set(g.ox + g.width - leadSize * 0.5 - pad * 0.5, g.oy - strip * 0.56);
    if (this.label) {
      this.label.style.fontSize = fontSize;
      this.label.position.set(g.ox + g.width - leadSize - pad * 1.5, g.oy - strip * 0.56);
    }
    if (this.nextLabel) {
      this.nextLabel.style.fontSize = fontSize;
      this.nextLabel.position.set(g.ox + pad * 0.5, g.oy - strip * 0.56);
    }
    this.cursor = Math.min(this.cursor, g.cols * g.rows - 1);
    this.publishGeom(g.ox, g.oy, g.cell);
    this.hint = null;
    this.hintLayer.clear();
    this.ringsHeld = false;
    for (const v of this.views) v.s.destroy();
    this.views = [];
    if (this.state) this.snap(this.state);
    this.drawCursor();
  }

  /** A spot's picture: its mark is the cut-out, its size and colour its heat. */
  private texture(heat: number, mark: ForgingMark, size = this.grid.cell): Texture {
    const blows = this.state?.config.blows ?? 3;
    return this.piece(`${mark}:${heat}`, size, forgingColor(heat, mark), forgingPaint(mark), forgingFit(heat, blows));
  }

  /** Show the plate exactly as `state` holds it, with nothing in motion, and what the press can reach lit. */
  private snap(state: ForgingState): void {
    const g = this.grid;
    const cells = state.cells;
    while (this.views.length > cells.length) this.views.pop()!.s.destroy();
    cells.forEach((c, i) => {
      let v = this.views[i];
      if (!v) {
        const s = new Sprite();
        s.anchor.set(0.5);
        this.spotLayer.addChild(s);
        v = { s, heat: c.heat, mark: c.mark };
        this.views[i] = v;
      }
      this.show(v, c);
      v.s.position.set(g.x(i), g.y(i));
      v.s.scale.set(1);
    });
    this.ringsHeld = false;
    this.drawPlate(state);
    this.drawPreview(state);
    this.drawLead(state);
    this.touchView();
  }

  /** The mark the press is moving by, framed in amber, the player's own: the spots it reaches are the lit ones. */
  private drawLead(state: ForgingState): void {
    const g = this.grid;
    const size = Math.round(g.cell * 0.62);
    this.leadFrame.clear();
    const mark = state.finished ? null : state.lead;
    this.lead.visible = mark !== null;
    if (mark === null) return;
    this.lead.texture = this.texture(state.config.blows, mark, size);
    const r = size * 0.56;
    this.leadFrame.roundRect(this.lead.x - r, this.lead.y - r, r * 2, r * 2, r * 0.3).stroke({ width: Math.max(1.5, g.cell * RING_W * 0.7), color: INK.amber });
  }

  private show(v: SpotView, c: ForgingSpot): void {
    v.heat = c.heat;
    v.mark = c.mark;
    v.s.visible = c.heat > 0;
    if (c.heat > 0) v.s.texture = this.texture(c.heat, c.mark);
  }

  /**
   * The dots of set spots, and what the press can reach: each spot it can land on ringed in cream
   * and the rest drawn faint, the press itself ringed in amber, the player's own. Before the first
   * strike and after a stall every live spot is open, and nothing is ringed.
   */
  private drawPlate(state: ForgingState): void {
    const g = this.grid;
    this.dots.clear();
    this.rings.clear();
    state.cells.forEach((c, i) => {
      if (c.heat === 0) drawDot(this.dots, g.x(i), g.y(i), g.cell);
    });
    if (this.ringsHeld) return;
    const open = state.lead !== null && !state.finished;
    const lit = new Set(forgingTargets(state));
    this.views.forEach((v, i) => {
      v.s.alpha = !open || lit.has(i) ? 1 : UNLIT;
    });
    const w = Math.max(2, g.cell * RING_W);
    if (open) for (const i of lit) this.rings.circle(g.x(i), g.y(i), g.cell * RING_R).stroke({ width: w * 0.75, color: INK.cream, alpha: 0.75 });
    if (state.at !== null && !state.finished) {
      // The press sits where it last struck. Square, so it never reads as a lit spot's ring.
      const r = g.cell * RING_R;
      this.rings.roundRect(g.x(state.at) - r, g.y(state.at) - r, r * 2, r * 2, r * 0.3).stroke({ width: w, color: INK.amber });
    }
  }

  /** The marks the deal gives next, in order, in the strip: the first is what the next live strike turns up. */
  private drawPreview(state: ForgingState): void {
    const g = this.grid;
    const n = state.config.preview;
    const marks = n > 0 && !state.finished ? forgingUpcoming(state, n) : [];
    while (this.previews.length > marks.length) this.previews.pop()!.destroy();
    const size = Math.round(g.cell * 0.62);
    const x0 = g.ox + (this.nextLabel ? this.nextLabel.width : 0) + g.cell * 0.55;
    const y = g.oy - g.cell * STRIP * 0.56;
    marks.forEach((m, i) => {
      let s = this.previews[i];
      if (!s) {
        s = new Sprite();
        s.anchor.set(0.5);
        this.previewLayer.addChild(s);
        this.previews[i] = s;
      }
      s.texture = this.texture(this.state?.config.blows ?? 3, m, size);
      s.position.set(x0 + i * size * 1.05, y);
      // Further ahead is fainter: the first is the one that comes next.
      s.alpha = 1 - i * 0.18;
    });
    if (this.nextLabel) this.nextLabel.visible = marks.length > 0;
  }

  protected onState(state: ForgingState, prev: ForgingState | null): void {
    this.hint = null;
    this.hintLayer.clear();
    this.idle = 0;
    const g = this.grid;
    if (g.cols !== state.config.width || g.rows !== state.config.height) {
      // A different plate (a lab config): lay it out afresh.
      g.cols = state.config.width;
      g.rows = state.config.height;
      this.layout(this.app.screen.width, this.app.screen.height);
      return;
    }
    const r = state.lastMove;
    const follows = r !== null && prev !== null && prev.moveCount === state.moveCount - 1 && this.views.length === state.cells.length && this.views[r.cell]?.heat === r.heat + 1;
    if (!follows) {
      this.snap(state);
      return;
    }
    this.play(state, r);
  }

  /** Play a strike out: the press lands, the spot cools a step and turns up its new mark, then what it scored. */
  private play(state: ForgingState, r: ForgingStrike): void {
    const g = this.grid;
    const L = this.opts.labels;
    const v = this.views[r.cell]!;
    const x = g.x(r.cell);
    const y = g.y(r.cell);
    // The rings wait for the plate as it will be; the struck spot is ringed in amber, the press's.
    this.ringsHeld = true;
    this.rings.clear();
    for (const o of this.views) o.s.alpha = 1;
    this.fx.ring(x, y, INK.amber, g.cell * 0.3, g.cell * 0.52, 280, Math.max(2, g.cell * RING_W));
    this.drawLead({ ...state, lead: r.mark, finished: false });
    sfx.pop(Math.max(0, state.config.blows - r.heat - 1) * 2);
    if (r.heat === 0) {
      v.heat = 0;
      this.tweens.remove(v.s, { done: () => (v.s.visible = false) });
    } else {
      // The press squashes the tile; it comes back a step smaller with its new mark.
      v.s.scale.set(0.8);
      this.tweens.after(60, () => this.show(v, { heat: r.heat, mark: r.next ?? v.mark }));
      this.tweens.move(v.s, { scale: 1 }, { delay: 60 });
    }
    const gained = r.points + r.stallPoints;
    this.tweens.after(90, () => this.fx.popup(x, y - g.cell * 0.25, `+${gained}`, INK.cream, Math.max(14, g.cell * (r.set ? 0.46 : 0.34))));
    if (r.chain >= 2) this.tweens.after(90, () => this.setLabel(L.chain(r.chain, r.chainPoints), INK.cream));

    // One callout a strike, the rarest first; the beat for a weave and for the plate set.
    this.tweens.after(180, () => {
      if (r.done) {
        this.fx.say(L.done);
        this.beat(1);
      } else if (r.set && r.set.weave >= 2) {
        this.fx.say(L.weave(r.set.weave));
        this.beat(Math.min(1, 0.3 + r.set.weave * 0.15));
      } else if (r.set) {
        this.fx.say(r.set.family === "count" ? L.count : L.span);
        sfx.good();
      } else if (r.stalled) {
        this.fx.say(L.stall(r.stallPoints), INK.danger);
        sfx.bad();
      } else if (r.sparked) {
        this.fx.say(L.spark);
        sfx.zap();
      } else if (r.broke) {
        this.fx.popup(g.ox + g.width * 0.72, g.oy - g.cell * STRIP * 0.2, L.setLost, INK.dim, Math.max(13, g.cell * 0.3));
        sfx.streakLost();
      } else if (r.chain >= 3) sfx.streak(r.chain);
    });
    // Whatever the tweens did, the plate ends as the engine holds it.
    this.tweens.after(PLAY_MS, () => this.snap(state));
  }

  protected view(): string {
    return this.views.map((v) => (v.heat > 0 ? `${v.heat}${forgingMarkChar(v.mark)}` : "..")).join("");
  }

  protected override update(dt: number): void {
    const state = this.state;
    if (state && !this.busy) {
      // The strip says what the press is doing: free after a stall, else the chain running.
      if (state.finished) this.setLabel("", INK.dim);
      else if (state.at !== null && state.lead === null) this.setLabel(this.opts.labels.free, INK.amber);
      else if (state.chain >= 2) this.setLabel(this.opts.labels.chainRunning(state.chain), INK.dim);
      else this.setLabel("", INK.dim);
    }
    this.drawRefused();
    if (!this.interactive || !this.hints || !state || state.finished || this.busy) {
      if (!this.interactive || !this.hints) this.idle = 0;
      if (this.hint !== null) {
        this.hint = null;
        this.hintLayer.clear();
      }
      return;
    }
    this.idle += dt;
    if (this.idle < HINT_AFTER_MS) return;
    if (this.hintFor !== state) {
      this.hintFor = state;
      this.hint = forgingHint(state);
    }
    this.hintLayer.clear();
    if (this.hint === null) return;
    const g = this.grid;
    // A hint is a thicker cream ring that breathes: the board's advice, never the player's mark.
    const pulse = this.reduced ? 0.9 : 0.55 + 0.4 * Math.sin(this.time / 240);
    this.hintLayer.circle(g.x(this.hint), g.y(this.hint), g.cell * RING_R).stroke({ width: Math.max(3, g.cell * RING_W * 1.8), color: INK.cream, alpha: pulse });
  }

  private setLabel(text: string, color: number): void {
    if (!this.label) return;
    if (this.label.text !== text) this.label.text = text;
    this.label.style.fill = color;
  }

  /** A strike the press cannot make: the spot is ringed in danger for a moment. */
  private drawRefused(): void {
    const r = this.refused;
    if (!r) return;
    const age = this.time - r.at;
    this.cursorLayer.clear();
    this.drawCursorShape();
    if (age > 360) {
      this.refused = null;
      return;
    }
    const g = this.grid;
    this.cursorLayer.circle(g.x(r.cell), g.y(r.cell), g.cell * RING_R).stroke({ width: Math.max(2, g.cell * RING_W), color: INK.danger, alpha: 1 - age / 360 });
  }

  // ---- input

  private strike(cell: number): void {
    const state = this.state;
    if (!state || state.finished || this.busy) return;
    this.idle = 0;
    if (forgingStrikeIllegalReason(state, cell) !== null) {
      sfx.bump();
      this.refused = { cell, at: this.time };
      return;
    }
    this.cb.onStrike(cell);
  }

  protected override pointerDown(x: number, y: number): void {
    const at = this.grid.at(x, y);
    if (!at) return;
    this.cursor = at.index;
    this.cursorShown = false;
    this.drawCursor();
    this.strike(at.index);
  }

  private drawCursor(): void {
    this.cursorLayer.clear();
    this.drawCursorShape();
  }

  private drawCursorShape(): void {
    const g = this.grid;
    this.app.canvas.setAttribute("data-cursor", `${this.cursor % g.cols},${Math.floor(this.cursor / g.cols)}`);
    if (!this.cursorShown) return;
    // The keyboard's spot is the player's: amber corners round the cell.
    const h = g.cell * 0.5;
    const k = g.cell * 0.16;
    const x = g.x(this.cursor);
    const y = g.y(this.cursor);
    const w = Math.max(2, g.cell * RING_W);
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      this.cursorLayer
        .moveTo(x + sx * h, y + sy * (h - k))
        .lineTo(x + sx * h, y + sy * h)
        .lineTo(x + sx * (h - k), y + sy * h)
        .stroke({ width: w, color: INK.amber, cap: "round", join: "round" });
    }
  }

  /** Arrows or WASD move the cursor; space or enter strikes the spot under it. */
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
      this.strike(this.cursor);
      return true;
    }
    return false;
  }
}
