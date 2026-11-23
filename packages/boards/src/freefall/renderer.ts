import { Container, Graphics, Sprite, Text } from "pixi.js";
import {
  freefallBayValues,
  freefallDropIllegalReason,
  freefallDropValue,
  freefallHint,
  freefallViewString,
  type FreefallDrop,
  type FreefallRocker,
  type FreefallState,
} from "@openseas/engine";
import { sfx } from "../audio.js";
import { FONT_MONO, INK } from "../kit/art.js";
import { MOTION, ink } from "../look/tokens.js";
import { Grid, KitBoard } from "../kit/board.js";
import { FREEFALL_ARM, FREEFALL_BERTH, FREEFALL_CRADLE, FREEFALL_POD } from "./pieces.js";

export interface FreefallCallbacks {
  /** The player dropped a pod down `lane`. */
  onDrop(lane: number): void;
  /** First settled frame after a new state. */
  onFrame(): void;
}

export interface FreefallLabels {
  /** What a drop down the lane in hand is worth at once, and the largest cluster it lands. */
  preview(points: number, cluster: number): string;
  /** The drop in hand brings nothing down. */
  previewRest: string;
  cluster(count: number): string;
  cascade(count: number): string;
  rivalScores(points: number): string;
  legWon(leg: number): string;
  legLost(leg: number): string;
  legOver(leg: number): string;
}

export interface FreefallRendererOptions {
  /** Pulse a drop worth making after a pause. Off for recorded rounds. */
  hints: boolean;
  labels: FreefallLabels;
}

interface RockerView {
  cradle: Sprite;
  arm: Sprite;
}

interface PodView {
  s: Sprite;
  count: Text | null;
}

/** The strip over the shaft, in cells: the preview line, then the lane the next pod hangs over. */
const STRIP = 1.4;
const HINT_AFTER_MS = 6000;
/** How long a pod takes to fall one row: a drop of six rows plays out in about half a second. */
const STEP = 55;
/** A pod is drawn at this share of a cell, falling or at rest. */
const POD = 0.62;
/** A cluster this big is the puzzle's compound move: called out and given the beat. */
const BIG_CLUSTER = 3;
/** Pods brought down by one drop, called out from this many. */
const CASCADE = 4;
const RING_W = 0.07;
/** The rival's colour: its pod's ring and its points. */
const RIVAL = ink("rose");

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** Draws the shaft and turns a tap, a hover or a key into a drop. Scores nothing: every number it shows is the engine's. */
export class FreefallRenderer extends KitBoard<FreefallState> {
  private readonly grid = new Grid(8, 7);
  private readonly bg = new Graphics();
  private readonly hintLayer = new Graphics();
  private readonly rockerLayer = new Container();
  private readonly berthLayer = new Container();
  private readonly podLayer = new Container();
  private readonly cursorLayer = new Graphics();
  private label: Text | null = null;
  private readonly rockers: RockerView[] = [];
  private readonly berthValues: Text[] = [];
  private readonly pods = new Map<number, PodView>();
  /** The shaft as drawn: each rocker's side and the pod at rest in it. `view` reads it. */
  private drawn: Array<Mutable<FreefallRocker>> = [];
  private cursor = 0;
  private cursorShown = false;
  private idle = 0;
  private hint: number | null = null;
  private hintFor: FreefallState | null = null;
  private hints: boolean;

  constructor(
    host: HTMLElement,
    private readonly cb: FreefallCallbacks,
    private readonly opts: FreefallRendererOptions,
  ) {
    super(host, "freefall", cb.onFrame);
    this.hints = opts.hints;
  }

  setHints(on: boolean): void {
    this.hints = on;
  }

  protected build(): void {
    this.label = new Text({ text: "", style: { fontFamily: FONT_MONO, fontSize: 16, fontWeight: "700", fill: INK.cream }, resolution: 2 });
    this.label.anchor.set(0.5);
    this.world.addChild(this.bg, this.hintLayer, this.berthLayer, this.rockerLayer, this.podLayer, this.cursorLayer, this.label);
  }

  protected layout(width: number, height: number): void {
    const g = this.grid;
    if (this.state) {
      g.cols = this.state.config.width;
      g.rows = this.state.config.rows + 1;
    }
    g.fit(width, height, { top: STRIP, margin: 8 });
    const pad = Math.max(4, g.cell * 0.12);
    const strip = g.cell * STRIP;
    // Bare ground under the strip and the shaft. The one hairline is the edge that matters: the
    // line over the berths, where a pod's fall ends and its points are paid.
    this.bg.clear();
    this.paintGround(this.bg, g.ox - pad, g.oy - strip - pad, g.width + pad * 2, g.height + strip + pad * 2, false);
    const foot = g.oy + (g.rows - 1) * g.cell;
    this.bg
      .moveTo(g.ox, foot)
      .lineTo(g.ox + g.width, foot)
      .stroke({ width: 1, color: INK.line });
    if (this.label) {
      this.label.style.fontSize = Math.max(12, Math.round(g.cell * 0.34));
      this.label.position.set(g.ox + g.width / 2, g.oy - strip + g.cell * 0.32);
    }
    this.cursor = Math.min(this.cursor, g.cols - 1);
    this.publishGeom(g.ox, g.oy, g.cell);
    this.buildBerths();
    if (this.state) this.snap(this.state);
    this.drawCursor();
  }

  /** The row a pod hangs in before it drops: the lower part of the strip. */
  private hangY(): number {
    return this.grid.oy - this.grid.cell * 0.55;
  }

  /** Where a pod rests in a cradle: in the cup, a little above the row's middle. */
  private restY(row: number): number {
    return this.grid.cy(row) - this.grid.cell * 0.1;
  }

  private buildBerths(): void {
    const g = this.grid;
    for (const t of this.berthValues) t.destroy();
    this.berthValues.length = 0;
    this.berthLayer.removeChildren().forEach((c) => c.destroy());
    const row = g.rows - 1;
    for (let l = 0; l < g.cols; l++) {
      const s = new Sprite(this.piece(FREEFALL_BERTH.id, g.cell, FREEFALL_BERTH.color, FREEFALL_BERTH.paint));
      s.anchor.set(0.5);
      s.position.set(g.cx(l), g.cy(row));
      this.berthLayer.addChild(s);
      const v = new Text({ text: "", style: { fontFamily: FONT_MONO, fontSize: Math.max(11, Math.round(g.cell * 0.32)), fontWeight: "700", fill: INK.cream }, resolution: 2 });
      v.anchor.set(0.5);
      v.position.set(g.cx(l), g.cy(row) + g.cell * 0.12);
      this.berthLayer.addChild(v);
      this.berthValues.push(v);
    }
  }

  /** Write each berth's value for leg `leg`, the engine's numbers. */
  private showBerths(leg: number): void {
    if (!this.state) return;
    const values = freefallBayValues(this.state.config, leg);
    values.forEach((v, l) => {
      const t = this.berthValues[l];
      if (t) t.text = String(v);
    });
  }

  /** Lay a rocker's two halves where its sides are: the cup over its cradle lane, the lever over its arm lane, each turned towards the hub between them. */
  private placeRocker(i: number, r: FreefallRocker): void {
    const g = this.grid;
    let v = this.rockers[i];
    if (!v) {
      const cradle = new Sprite();
      const arm = new Sprite();
      cradle.anchor.set(0.5);
      arm.anchor.set(0.5);
      this.rockerLayer.addChild(cradle, arm);
      v = { cradle, arm };
      this.rockers[i] = v;
    }
    v.cradle.texture = this.piece(FREEFALL_CRADLE.id, g.cell, FREEFALL_CRADLE.color, FREEFALL_CRADLE.paint);
    v.arm.texture = this.piece(FREEFALL_ARM.id, g.cell, FREEFALL_ARM.color, FREEFALL_ARM.paint);
    const cl = r.lane + r.cradle;
    const al = r.lane + 1 - r.cradle;
    v.cradle.position.set(g.cx(cl), g.cy(r.row));
    v.arm.position.set(g.cx(al), g.cy(r.row));
    // Drawn with the cup's stub to the right and the lever's hub to the left: mirrored when the cradle is the right-hand lane.
    const flip = r.cradle === 1 ? -1 : 1;
    v.cradle.scale.set(flip, 1);
    v.arm.scale.set(flip, 1);
  }

  private podSprite(id: number): PodView {
    let v = this.pods.get(id);
    if (v) return v;
    const s = new Sprite(this.piece(FREEFALL_POD.id, this.grid.cell, FREEFALL_POD.color, FREEFALL_POD.paint));
    s.anchor.set(0.5);
    s.scale.set(POD);
    this.podLayer.addChild(s);
    v = { s, count: null };
    this.pods.set(id, v);
    return v;
  }

  /** A cluster carries its count on its pod, in mono: drawn as part of the piece. */
  private setCount(v: PodView, n: number): void {
    if (n <= 1) {
      if (v.count) v.count.visible = false;
      return;
    }
    if (!v.count) {
      v.count = new Text({ text: "", style: { fontFamily: FONT_MONO, fontSize: Math.round(this.grid.cell * 0.42), fontWeight: "700", fill: INK.ground }, resolution: 2 });
      v.count.anchor.set(0.5);
      v.count.position.set(0, this.grid.cell * 0.14);
      v.s.addChild(v.count);
    }
    v.count.text = String(n);
    v.count.visible = true;
  }

  private dropPod(id: number): void {
    const v = this.pods.get(id);
    if (!v) return;
    this.pods.delete(id);
    v.s.destroy({ children: true });
  }

  /** Put exactly the engine's shaft on the board, with nothing in motion. */
  private snap(state: FreefallState): void {
    const g = this.grid;
    while (this.rockers.length > state.rockers.length) {
      const v = this.rockers.pop()!;
      v.cradle.destroy();
      v.arm.destroy();
    }
    this.drawn = state.rockers.map((r) => ({ ...r }));
    state.rockers.forEach((r, i) => this.placeRocker(i, r));
    const resting = new Set<number>();
    for (const r of state.rockers) {
      if (r.pod === 0) continue;
      resting.add(r.pod);
      const v = this.podSprite(r.pod);
      v.s.texture = this.piece(FREEFALL_POD.id, g.cell, FREEFALL_POD.color, FREEFALL_POD.paint);
      v.s.position.set(g.cx(r.lane + r.cradle), this.restY(r.row));
      v.s.scale.set(POD);
      v.s.alpha = 1;
      this.setCount(v, 1);
    }
    for (const id of [...this.pods.keys()]) if (!resting.has(id)) this.dropPod(id);
    this.showBerths(state.leg);
    this.touchView();
  }

  protected onState(state: FreefallState, prev: FreefallState | null): void {
    this.hint = null;
    this.hintLayer.clear();
    this.idle = 0;
    const g = this.grid;
    if (g.cols !== state.config.width || g.rows !== state.config.rows + 1) {
      g.cols = state.config.width;
      g.rows = state.config.rows + 1;
      this.layout(this.app.screen.width, this.app.screen.height);
      return;
    }
    const r = state.lastMove;
    const known = r !== null && prev !== null && prev.nextId === r.drops[0]?.id && freefallViewString(prev.config, prev.rockers) === freefallViewString(prev.config, this.drawn);
    if (!r || !known || !prev) {
      this.snap(state);
      this.refreshPreview();
      return;
    }
    let t = 0;
    for (const d of r.drops) t = this.playDrop(d, t, state);
    // One word on the leg, when a drop closed it: whose it was, then the new berths.
    const ended = r.drops.find((d) => d.legEnded);
    if (ended) {
      const L = this.opts.labels;
      const leg = ended.leg + 1;
      const won = state.legsWon > prev.legsWon;
      this.tweens.after(t, () => {
        if (!state.config.rival) this.fx.say(L.legOver(leg), INK.dim);
        else if (won) {
          this.fx.say(L.legWon(leg));
          sfx.good();
        } else {
          this.fx.say(L.legLost(leg), INK.dim);
          sfx.bad();
        }
      });
    }
    // Whatever the tweens did, the shaft ends as the engine holds it.
    this.tweens.after(t, () => {
      this.snap(state);
      this.refreshPreview();
    });
  }

  /** Play one drop out, from `t0`: the pod hangs over its lane, falls a row at a time, and what reaches the foot is paid. Returns when it ends. */
  private playDrop(d: FreefallDrop, t0: number, state: FreefallState): number {
    const g = this.grid;
    const L = this.opts.labels;
    let t = t0;
    const rival = d.side === 1;
    // The rival's pod appears over its lane with a breath, so the player sees where it went.
    const pod = this.podSprite(d.id);
    pod.s.visible = false;
    this.tweens.after(t, () => {
      pod.s.visible = true;
      pod.s.position.set(g.cx(d.lane), this.hangY());
      if (rival) {
        this.fx.ring(g.cx(d.lane), this.hangY(), RIVAL, g.cell * 0.2, g.cell * 0.45, 200, Math.max(2, g.cell * RING_W));
        sfx.whoosh();
      }
    });
    if (rival) t += 140;
    for (const step of d.steps) {
      const at = t;
      for (const stack of step.arriving) {
        stack.ids.forEach((id, k) => {
          const v = this.podSprite(id);
          this.tweens.to(v.s, { x: g.cx(stack.lane), y: g.cy(step.row) }, STEP, { delay: at });
          this.tweens.after(at, () => {
            v.s.visible = true;
            v.s.alpha = k === 0 ? 1 : 0;
            this.setCount(v, k === 0 ? stack.ids.length : 1);
          });
        });
      }
      const ev = at + STEP;
      this.tweens.after(ev, () => {
        for (const f of step.flipped) {
          const r = this.drawn[f.rocker];
          if (!r) continue;
          if (f.times % 2 === 1) r.cradle = (1 - r.cradle) as 0 | 1;
          this.placeRocker(f.rocker, r);
        }
        if (step.flipped.length > 0) sfx.thud();
        for (const x of step.tossed) {
          const r = this.drawn[x.rocker];
          if (r) r.pod = 0;
          const v = this.pods.get(x.id);
          if (v) {
            v.s.alpha = 1;
            v.s.position.set(g.cx(x.lane), this.restY(step.row));
            this.setCount(v, 1);
          }
        }
        for (const x of step.rested) {
          const r = this.drawn[x.rocker];
          if (!r) continue;
          r.pod = x.id;
          const v = this.pods.get(x.id);
          if (v) {
            v.s.alpha = 1;
            v.s.position.set(g.cx(r.lane + r.cradle), this.restY(r.row));
            this.setCount(v, 1);
          }
          sfx.pop(Math.min(8, step.row + 1));
        }
        this.touchView();
      });
      t = ev;
    }
    // The foot: each stack drops into its berth and is paid.
    const foot = g.rows - 1;
    let biggest = 0;
    let pods = 0;
    for (const land of d.landed) {
      biggest = Math.max(biggest, land.ids.length);
      pods += land.ids.length;
      for (const id of land.ids) {
        const v = this.podSprite(id);
        this.tweens.to(v.s, { x: g.cx(land.lane), y: g.cy(foot) }, STEP, { delay: t });
        this.tweens.remove(v.s, { delay: t + STEP, done: () => this.dropPod(id) });
      }
    }
    const paid = t + STEP;
    if (d.landed.length > 0) {
      const values = freefallBayValues(state.config, d.leg);
      const top = Math.max(1, ...values);
      this.tweens.after(paid, () => {
        for (const land of d.landed) {
          const color = rival ? RIVAL : INK.cream;
          this.fx.popup(g.cx(land.lane), g.cy(foot) - g.cell * 0.5, `+${land.points}`, color, Math.max(14, g.cell * (land.ids.length > 1 ? 0.5 : 0.4)));
        }
        // A berth sounds higher the more it pays.
        sfx.ping(Math.max(0, Math.round(8 - (8 * Math.max(...d.landed.map((l) => l.value))) / top)));
        if (biggest >= 2) sfx.multi(biggest);
      });
      // Nothing is snapped away before its pod has shrunk into the berth.
      t = paid + MOTION.clear;
    }
    // One callout a drop, and the beat for the compound move: a big cluster of the player's.
    this.tweens.after(t, () => {
      if (rival) {
        if (d.points > 0) this.fx.say(L.rivalScores(d.points), RIVAL);
        return;
      }
      if (biggest >= BIG_CLUSTER) {
        this.fx.say(L.cluster(biggest));
        this.beat(Math.min(1, 0.3 + biggest * 0.15));
      } else if (biggest === 2) this.fx.say(L.cluster(2));
      else if (pods >= CASCADE) this.fx.say(L.cascade(pods));
    });
    return t + (rival ? 0 : 80);
  }

  protected view(): string {
    if (!this.state) return "";
    return freefallViewString(this.state.config, this.drawn);
  }

  protected override update(dt: number): void {
    // A drop worth making pulses after a pause, in rounds that allow hints.
    if (!this.interactive || !this.hints || !this.state || this.state.finished || this.busy) {
      this.idle = 0;
      if (this.hint !== null) {
        this.hint = null;
        this.hintLayer.clear();
      }
      return;
    }
    this.idle += dt;
    if (this.idle < HINT_AFTER_MS) return;
    if (this.hintFor !== this.state) {
      this.hintFor = this.state;
      this.hint = freefallHint(this.state);
    }
    this.hintLayer.clear();
    if (this.hint === null) return;
    // A hint is cream, never amber: it is the board's advice, not the player's own lane.
    const pulse = this.reduced ? 0.8 : 0.55 + 0.4 * Math.sin(this.time / 240);
    this.frameLane(this.hintLayer, this.hint, INK.cream, pulse);
  }

  /** A rounded frame down the whole of a lane, strip to foot. */
  private frameLane(l: Graphics, lane: number, color: number, alpha = 1): void {
    const g = this.grid;
    const pad = g.cell * 0.06;
    l.roundRect(g.ox + lane * g.cell + pad, this.hangY() - g.cell * 0.45, g.cell - pad * 2, g.height + g.cell * 0.9, g.cell * 0.22).stroke({ width: Math.max(2, g.cell * RING_W), color, alpha });
  }

  // ---- the drop

  private tryDrop(lane: number): void {
    const state = this.state;
    if (!state || state.finished) return;
    if (this.busy) this.tweens.flush();
    this.idle = 0;
    if (freefallDropIllegalReason(state, lane) !== null) {
      sfx.bump();
      return;
    }
    this.cb.onDrop(lane);
  }

  /** The strip says what a drop down the lane in hand is worth, once a key or a hover has picked one. */
  private refreshPreview(): void {
    const state = this.state;
    if (!state || !this.cursorShown || state.finished) {
      this.setLabel("");
      return;
    }
    const L = this.opts.labels;
    const v = freefallDropValue(state, this.cursor);
    if (v.points === 0) this.setLabel(L.previewRest, INK.dim);
    else this.setLabel(L.preview(v.points, v.cluster), INK.cream);
  }

  private setLabel(text: string, color: number = INK.cream): void {
    if (!this.label) return;
    this.label.text = text;
    this.label.style.fill = color;
  }

  private laneAt(x: number, y: number): number | null {
    const g = this.grid;
    if (y < g.oy - g.cell * STRIP || y > g.oy + g.height) return null;
    const lane = Math.floor((x - g.ox) / g.cell);
    return lane >= 0 && lane < g.cols ? lane : null;
  }

  // ---- pointer: a tap anywhere down a lane drops a pod down it; a hover shows what it is worth

  protected override pointerMove(x: number, y: number): void {
    if (!this.interactive || !this.state || this.state.finished) return;
    const lane = this.laneAt(x, y);
    if (lane === null || (lane === this.cursor && this.cursorShown)) return;
    this.cursor = lane;
    this.cursorShown = true;
    this.drawCursor();
    this.refreshPreview();
  }

  protected override pointerUp(x: number, y: number): void {
    if (!this.interactive || !this.state || this.state.finished) return;
    const lane = this.laneAt(x, y);
    if (lane === null) return;
    this.cursor = lane;
    this.drawCursor();
    this.tryDrop(lane);
  }

  // ---- keyboard

  private drawCursor(): void {
    const g = this.grid;
    this.cursorLayer.clear();
    this.app.canvas.setAttribute("data-cursor", String(this.cursor));
    if (!this.cursorShown) return;
    // The lane in hand is the player's: an amber chevron over it, pointing down the shaft.
    const x = g.cx(this.cursor);
    const y = this.hangY() + g.cell * 0.36;
    const w = g.cell * 0.18;
    this.cursorLayer
      .moveTo(x - w, y - w * 0.6)
      .lineTo(x, y + w * 0.4)
      .lineTo(x + w, y - w * 0.6)
      .stroke({ width: Math.max(2, g.cell * RING_W), color: INK.amber, cap: "round", join: "round" });
  }

  /** Left and right, or A and D, move the lane in hand. Space or enter drops. */
  override keyboard(key: string): boolean {
    if (!this.interactive || !this.state) return false;
    const g = this.grid;
    const k = key.length === 1 ? key.toLowerCase() : key;
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, a: -1, d: 1 };
    const step = steps[k];
    if (step !== undefined) {
      const lane = this.cursor + step;
      if (this.cursorShown && lane >= 0 && lane < g.cols) this.cursor = lane;
      else if (this.cursorShown) sfx.bump();
      this.cursorShown = true;
      this.idle = 0;
      this.drawCursor();
      this.refreshPreview();
      return true;
    }
    if (k === " " || k === "Enter") {
      this.cursorShown = true;
      this.drawCursor();
      this.tryDrop(this.cursor);
      return true;
    }
    return false;
  }
}
