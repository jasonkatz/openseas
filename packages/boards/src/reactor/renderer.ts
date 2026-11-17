import { Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import {
  reactorCanSwipe,
  reactorHint,
  reactorHotCount,
  reactorIsHot,
  reactorPipelineLeft,
  reactorPipelinePercentAt,
  reactorPortCell,
  reactorPortLoad,
  reactorPortStatus,
  type ReactorDir,
  type ReactorMoveReport,
  type ReactorPort,
  type ReactorState,
} from "@openseas/engine";
import { sfx } from "../audio.js";
import { MOTION } from "../look/tokens.js";
import { FONT, FONT_MONO, INK, drawDot } from "../kit/art.js";
import { Grid, KitBoard } from "../kit/board.js";
import { ease } from "../kit/tween.js";
import { reactorRodColor, reactorRodPaint } from "./pieces.js";

export interface ReactorCallbacks {
  /** The player swiped. Returns false when the round refused it: nothing would have moved. */
  onSwipe(dir: ReactorDir): boolean;
  /** First settled frame after a new state. */
  onFrame(): void;
}

export interface ReactorLabels {
  next: string;
  hot: string;
  /** The pipeline bar while a run is going: what the next discharge will be multiplied by. */
  pipeline(percent: number): string;
  pipelineIdle: string;
  pipelineLost: string;
  /** A discharge that continued a run. */
  run(count: number): string;
  salvo(count: number): string;
  hotRod: string;
  critical(penalty: number): string;
  jammed(penalty: number): string;
}

export interface ReactorRendererOptions {
  /** Point at a swipe that would discharge a rod, after a pause. Off for recorded rounds. */
  hints: boolean;
  labels: ReactorLabels;
}

interface RodView {
  s: Sprite;
  grade: number;
  cell: number;
}

/** The unit step of each direction: up, right, down, left. */
const STEP: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];
const HINT_AFTER_MS = 5000;
/** The rods of a salvo are heard this far apart. */
const SALVO_GAP_MS = 90;

const portKey = (p: ReactorPort): string => `${p.side}${p.lane}`;

/** Draws the reactor core and turns a swipe into a move. Scores nothing: every number it shows is the engine's. */
export class ReactorRenderer extends KitBoard<ReactorState> {
  private readonly grid = new Grid(4, 4);
  private readonly bg = new Graphics();
  private readonly rodLayer = new Container();
  private readonly rodMask = new Graphics();
  private readonly portLayer = new Graphics();
  private readonly hintLayer = new Graphics();
  private readonly hud = new Graphics();
  private readonly nextRod = new Sprite();
  private nextText: Text | null = null;
  private hotText: Text | null = null;
  private pipeText: Text | null = null;
  private readonly rods = new Map<number, RodView>();
  /** The ports drawn, and when each first appeared: a new port's gap opens in the wall. */
  private ports: ReactorPort[] = [];
  private readonly portBorn = new Map<string, number>();
  private drag: { x: number; y: number; fired: boolean } | null = null;
  private idle = 0;
  private hints: boolean;
  private rim = 8;
  private strip = 30;
  private bar = 22;

  constructor(
    host: HTMLElement,
    private readonly cb: ReactorCallbacks,
    private readonly opts: ReactorRendererOptions,
  ) {
    super(host, "reactor", cb.onFrame);
    this.hints = opts.hints;
  }

  setHints(on: boolean): void {
    this.hints = on;
  }

  protected build(): void {
    const style = { fontFamily: FONT, fontSize: 13, fill: INK.dim };
    this.nextText = new Text({ text: this.opts.labels.next, style, resolution: 2 });
    this.hotText = new Text({ text: this.opts.labels.hot, style, resolution: 2 });
    // The pipeline's line carries a number, so it is set in the mono face.
    this.pipeText = new Text({ text: this.opts.labels.pipelineIdle, style: { ...style, fontFamily: FONT_MONO, fontWeight: "700" }, resolution: 2 });
    this.nextText.anchor.set(0, 0.5);
    this.hotText.anchor.set(1, 0.5);
    this.pipeText.anchor.set(0, 0.5);
    this.nextRod.anchor.set(0.5);
    this.rodLayer.mask = this.rodMask;
    this.rodLayer.sortableChildren = true;
    this.world.addChild(this.rodMask, this.bg, this.rodLayer, this.portLayer, this.hintLayer, this.hud, this.nextRod, this.nextText, this.hotText, this.pipeText);
  }

  protected layout(width: number, height: number): void {
    const g = this.grid;
    if (this.state) g.cols = g.rows = this.state.config.size;
    g.fit(width, height, { top: 0.72, bottom: 0.5, margin: Math.max(18, Math.min(width, height) * 0.06), maxCell: 132 });
    this.rim = Math.max(7, g.cell * 0.16);
    this.strip = g.cell * 0.72;
    this.bar = g.cell * 0.5;
    const pad = this.rim + Math.max(4, g.cell * 0.06);
    const b = this.bg;
    b.clear();
    // Bare ground under the strip, the core and the bar. The one hairline is the core's wall, which
    // the ports are gaps in, so it is drawn with them and not here.
    this.paintGround(b, g.ox - pad, g.oy - this.strip - pad * 0.4, g.width + pad * 2, g.height + this.strip + this.bar + pad * 1.4, false);
    // An empty cell is where a rod can go: a small dot.
    for (let i = 0; i < g.cols * g.rows; i++) drawDot(b, g.x(i), g.y(i), g.cell);
    // Rods are clipped at the wall: one that leaves goes out through it, one that enters comes in through it.
    const wall = this.rim * 0.5;
    this.rodMask.clear().rect(g.ox - wall, g.oy - wall, g.width + wall * 2, g.height + wall * 2).fill({ color: INK.cream });
    const font = Math.max(11, Math.round(g.cell * 0.19));
    const stripY = g.oy - this.rim - this.strip * 0.5;
    for (const t of [this.nextText, this.hotText, this.pipeText]) if (t) t.style.fontSize = font;
    this.nextText?.position.set(g.ox, stripY);
    this.hotText?.position.set(g.ox + g.width - this.lampSpan(), stripY);
    this.pipeText?.position.set(g.ox, g.oy + g.height + this.rim + this.bar * 0.3);
    this.publishGeom(g.ox, g.oy, g.cell);
    this.drag = null;
    if (this.state) this.snap(this.state);
  }

  // ---- art

  /** A rod's picture: its numeral says the grade, its outline says cool or hot. */
  private texture(grade: number, hot: boolean): Texture {
    return this.piece(`${hot ? "hot" : "rod"}:${grade}`, this.grid.cell, reactorRodColor(grade, hot), reactorRodPaint(grade, hot));
  }

  private textureFor(grade: number): Texture {
    return this.texture(grade, this.state ? reactorIsHot(this.state.config, grade) : false);
  }

  // ---- showing a state

  /** Put exactly these rods and ports on the board, with nothing in motion. */
  private snap(state: ReactorState): void {
    const g = this.grid;
    const seen = new Set<number>();
    state.cells.forEach((rod, cell) => {
      if (!rod) return;
      seen.add(rod.id);
      let v = this.rods.get(rod.id);
      if (!v) v = this.spawn(rod.id, rod.grade, cell);
      v.cell = cell;
      v.grade = rod.grade;
      v.s.texture = this.textureFor(rod.grade);
      v.s.position.set(g.x(cell), g.y(cell));
      v.s.scale.set(1);
      v.s.alpha = 1;
      v.s.zIndex = 0;
    });
    for (const [id, v] of this.rods) {
      if (seen.has(id)) continue;
      v.s.destroy();
      this.rods.delete(id);
    }
    this.rodLayer.position.set(0, 0);
    this.setPorts(state.ports, false);
    this.drawHud(state);
    this.touchView();
  }

  private spawn(id: number, grade: number, cell: number): RodView {
    const s = new Sprite(this.textureFor(grade));
    s.anchor.set(0.5);
    s.position.set(this.grid.x(cell), this.grid.y(cell));
    this.rodLayer.addChild(s);
    const v: RodView = { s, grade, cell };
    this.rods.set(id, v);
    return v;
  }

  private setPorts(ports: readonly ReactorPort[], opening: boolean): void {
    const keys = new Set(ports.map(portKey));
    for (const key of [...this.portBorn.keys()]) if (!keys.has(key)) this.portBorn.delete(key);
    for (const p of ports) {
      const key = portKey(p);
      if (this.portBorn.has(key)) continue;
      this.portBorn.set(key, opening ? this.time : -10_000);
    }
    this.ports = ports.slice();
    this.touchView();
  }

  protected onState(state: ReactorState, prev: ReactorState | null): void {
    this.idle = 0;
    this.hintLayer.clear();
    const g = this.grid;
    if (g.cols !== state.config.size) {
      // A different core (a lab config): lay it out afresh.
      g.cols = g.rows = state.config.size;
      this.layout(this.app.screen.width, this.app.screen.height);
      return;
    }
    const report = state.lastMove;
    const known = report !== null && prev !== null && report.slides.length === this.rods.size && report.slides.every((sl) => this.rods.get(sl.id)?.cell === sl.from);
    if (!report || !known) {
      this.snap(state);
      return;
    }
    this.play(state, report);
  }

  /** Play a swipe out: the slide, the fusions, the discharges, the rod that enters, then a scram if there was one. */
  private play(state: ReactorState, r: ReactorMoveReport): void {
    const g = this.grid;
    const cfg = state.config;
    const labels = this.opts.labels;
    const [dx, dy] = STEP[r.dir]!;
    if (r.fusions.length === 0 && r.discharges.length === 0) sfx.swapQuiet();

    for (const sl of r.slides) {
      const v = this.rods.get(sl.id);
      if (!v) continue;
      const x = g.x(sl.to);
      const y = g.y(sl.to);
      if (sl.out) {
        // To the wall, then out through the port, shrinking away as it goes.
        this.rods.delete(sl.id);
        v.s.zIndex = 2;
        this.tweens.move(v.s, { x, y });
        this.tweens.to(v.s, { x: x + dx * g.cell * 0.9, y: y + dy * g.cell * 0.9, scale: 0 }, MOTION.clear, { delay: MOTION.move, ease: ease.outCubic, done: () => v.s.destroy() });
      } else if (sl.into !== null) {
        this.rods.delete(sl.id);
        this.tweens.move(v.s, { x, y }, { done: () => v.s.destroy() });
      } else {
        v.cell = sl.to;
        v.s.zIndex = 1;
        this.tweens.move(v.s, { x, y });
      }
    }

    let t: number = MOTION.move;
    if (r.fusions.length > 0) {
      this.tweens.after(t, () => {
        let top = 0;
        for (const f of r.fusions) {
          const v = this.rods.get(f.id);
          if (!v) continue;
          // The fused rod takes its new grade and settles: a little small, then its own size.
          v.grade = f.grade;
          v.s.texture = this.texture(f.grade, f.hot);
          v.s.scale.set(0.88);
          this.tweens.move(v.s, { scale: 1 });
          this.fx.popup(g.x(f.cell), g.y(f.cell) - g.cell * 0.3, `+${f.points}`, INK.cream, Math.max(13, g.cell * 0.2));
          top = Math.max(top, f.grade);
        }
        sfx.pop(Math.min(9, top * 2 - 2));
        if (r.fusions.some((f) => f.hot)) {
          sfx.power(1);
          if (r.discharges.length === 0 && !r.scram) this.fx.say(labels.hotRod, INK.cream, Math.max(18, g.cell * 0.3));
        }
      });
    }

    if (r.discharges.length > 0) {
      const n = r.discharges.length;
      r.discharges.forEach((d, i) => {
        this.tweens.after(t + 40 + i * SALVO_GAP_MS, () => {
          sfx.zap();
          sfx.clear(Math.min(6, d.pipeline), 5);
          if (n === 1) this.fx.popup(g.x(d.cell), g.y(d.cell), `+${d.points}`, INK.cream, Math.max(18, g.cell * 0.36));
        });
      });
      const after = t + 40 + (n - 1) * SALVO_GAP_MS + 60;
      this.tweens.after(after, () => {
        const last = r.discharges[n - 1]!;
        const top = cfg.pipelinePercent.length;
        if (n >= 2) {
          // The salvo is the puzzle's compound move: the beat, stronger for a third rod.
          this.fx.say(labels.salvo(n));
          this.fx.popup(g.ox + g.width / 2, g.oy + g.height / 2, `+${r.dischargeTotal}`, INK.cream, Math.max(24, g.cell * 0.5));
          this.beat(Math.min(1, 0.6 + (n - 2) * 0.2));
          sfx.streak(n * 4);
        } else if (last.pipeline >= 2) {
          this.fx.say(labels.run(last.pipeline), INK.cream, Math.max(18, g.cell * 0.3));
          // The one other thing the beat is for: a pipeline brought to its top.
          if (top > 1 && last.pipeline === top) this.beat(0.4);
        }
        // The used port shuts and its replacement opens.
        this.setPorts(state.ports, true);
        if (r.opened.length > 0) sfx.tick(false);
      });
      t = after + 60;
    } else t += 20;

    if (r.entered) {
      const e = r.entered;
      this.tweens.after(t, () => {
        // The new rod comes in through the wall the rods slid away from.
        const v = this.spawn(e.id, e.grade, e.cell);
        v.s.position.set(g.x(e.cell) - dx * g.cell * 0.8, g.y(e.cell) - dy * g.cell * 0.8);
        this.tweens.move(v.s, { x: g.x(e.cell), y: g.y(e.cell) });
        this.drawHud(state);
      });
      t += MOTION.move + 10;
    }

    if (r.lapsed) {
      this.tweens.after(t - 100, () => {
        sfx.streakLost();
        this.fx.popup(g.ox + g.width * 0.5, g.oy + g.height + this.rim, labels.pipelineLost, INK.dim, Math.max(13, g.cell * 0.2));
      });
    }

    if (r.scram) {
      const scram = r.scram;
      this.tweens.after(t + 40, () => {
        sfx.charge();
        sfx.bad();
        // A scram is bad news, said in danger: every rod shrinks away.
        this.fx.say(scram.cause === "critical" ? labels.critical(scram.penalty) : labels.jammed(scram.penalty), INK.danger);
        for (const [id, v] of this.rods) {
          this.rods.delete(id);
          this.tweens.remove(v.s, { done: () => v.s.destroy() });
        }
      });
      t += 40 + MOTION.clear + 40;
      this.tweens.after(t, () => {
        for (const f of scram.fresh) {
          const v = this.spawn(f.id, f.grade, f.cell);
          v.s.scale.set(0);
          this.tweens.move(v.s, { scale: 1 });
        }
        sfx.swap();
      });
      t += MOTION.move;
    }

    // Whatever the tweens did, the core ends as the engine holds it.
    this.tweens.after(t + 20, () => this.snap(state));
  }

  protected view(): string {
    const g = this.grid;
    const chars = new Array<string>(g.cols * g.rows).fill(".");
    for (const v of this.rods.values()) {
      const at = g.at(v.s.x, v.s.y);
      if (at) chars[at.index] = String(v.grade);
    }
    return `${chars.join("")}|${this.ports.map(portKey).sort().join(",")}`;
  }

  // ---- the strip, the bar, the ports

  /** How wide the heat lamps are, so the label sits to their left. */
  private lampSpan(): number {
    const count = this.state?.config.criticalHot ?? 4;
    return count * this.grid.cell * 0.2 + this.grid.cell * 0.08;
  }

  /** The strip over the core (the next rod, the heat lamps) and the bar under it (the pipeline). */
  private drawHud(state: ReactorState): void {
    const g = this.grid;
    const cfg = state.config;
    const h = this.hud;
    h.clear();
    const stripY = g.oy - this.rim - this.strip * 0.5;

    // Next rod: beside its label.
    this.nextRod.texture = this.textureFor(state.next);
    this.nextRod.scale.set(0.52);
    this.nextRod.position.set(g.ox + (this.nextText?.width ?? 0) + g.cell * 0.38, stripY);

    // Heat: one lamp a hot rod the core can hold; the last is the one that scrams it. A light is a
    // dot: a ring when it is out, danger when it is lit, since heat is what goes wrong here.
    const hot = reactorHotCount(cfg, state.cells);
    const step = g.cell * 0.2;
    const r = g.cell * 0.07;
    const ring = Math.max(1.5, r * 0.3);
    for (let i = 0; i < cfg.criticalHot; i++) {
      const x = g.ox + g.width - (cfg.criticalHot - i - 0.5) * step;
      const last = i === cfg.criticalHot - 1;
      const lit = i < hot;
      // The critical lamp is a diamond, so it reads apart from the others without its colour.
      if (last) h.poly([x, stripY - r * 1.5, x + r * 1.5, stripY, x, stripY + r * 1.5, x - r * 1.5, stripY]);
      else h.circle(x, stripY, r * 1.15);
      if (lit) h.fill({ color: INK.danger });
      else h.stroke({ width: ring, color: INK.line, join: "round" });
    }
    this.hotText?.position.set(g.ox + g.width - this.lampSpan(), stripY);
    if (this.hotText) this.hotText.style.fill = hot >= cfg.criticalHot - 1 ? INK.danger : INK.dim;

    // Pipeline: a segment a swipe left before the run is lost, and what the next discharge is worth.
    const left = reactorPipelineLeft(state);
    const running = left > 0;
    if (this.pipeText) {
      this.pipeText.text = running ? this.opts.labels.pipeline(reactorPipelinePercentAt(cfg, state.combo + 1)) : this.opts.labels.pipelineIdle;
      this.pipeText.style.fill = running ? INK.cream : INK.dim;
    }
    const barY = g.oy + g.height + this.rim + this.bar * 0.72;
    const segs = Math.min(cfg.pipelineSwipes, 24);
    const gap = Math.max(2, g.cell * 0.03);
    const w = (g.width - gap * (segs - 1)) / segs;
    const shown = Math.ceil((left * segs) / cfg.pipelineSwipes);
    for (let i = 0; i < segs; i++) {
      const lit = i < shown;
      h.roundRect(g.ox + i * (w + gap), barY - this.bar * 0.1, w, this.bar * 0.2, this.bar * 0.1).fill({ color: lit ? (shown <= 2 ? INK.danger : INK.cream) : INK.line });
    }
  }

  /** Where a port's lane meets the wall. */
  private portPoint(p: ReactorPort): { x: number; y: number } {
    const g = this.grid;
    const cell = this.state ? reactorPortCell(this.state.config, p) : 0;
    const [dx, dy] = STEP[p.side]!;
    const out = g.cell / 2 + this.rim * 0.5;
    return { x: g.x(cell) + dx * out, y: g.y(cell) + dy * out };
  }

  /**
   * The core's wall and its ports, every frame. The wall is the board's one hairline and a port is
   * a gap in it at the end of its lane. Over the gap: chevrons pointing out, one a rod, when a swipe
   * that way would discharge now; a bar across when a hot rod is in the lane behind another rod.
   */
  private drawPorts(): void {
    const g = this.grid;
    const state = this.state;
    const p = this.portLayer;
    p.clear();
    const off = this.rim * 0.5;
    const x0 = g.ox - off - 0.5;
    const y0 = g.oy - off - 0.5;
    const x1 = g.ox + g.width + off + 0.5;
    const y1 = g.oy + g.height + off + 0.5;
    // The gaps in each wall (up, right, down, left), as stretches along it.
    const gaps: Array<Array<readonly [number, number]>> = [[], [], [], []];
    const thick = Math.max(2.5, g.cell * 0.05);
    const marks: Array<() => void> = [];
    for (const port of state ? this.ports : []) {
      const across = port.side === 0 || port.side === 2;
      const c = this.portPoint(port);
      const age = Math.min(1, ((this.time - (this.portBorn.get(portKey(port)) ?? -10_000)) * this.tweens.rate) / MOTION.move);
      const half = g.cell * 0.36 * ease.outCubic(age);
      const mid = across ? c.x : c.y;
      gaps[port.side]!.push([mid - half, mid + half]);
      if (age < 1 || !state) continue;
      const status = reactorPortStatus(state, port);
      const [dx, dy] = STEP[port.side]!;
      if (status === "ready") {
        const load = Math.min(3, reactorPortLoad(state, port));
        const a = Math.max(4, g.cell * 0.085);
        for (let i = 0; i < load; i++) {
          const o = (i - (load - 1) / 2) * g.cell * 0.2;
          const mx = c.x + (across ? o : 0);
          const my = c.y + (across ? 0 : o);
          marks.push(() =>
            p
              .moveTo(mx - dy * a - dx * a * 0.6, my + dx * a - dy * a * 0.6)
              .lineTo(mx + dx * a * 0.6, my + dy * a * 0.6)
              .lineTo(mx + dy * a - dx * a * 0.6, my - dx * a - dy * a * 0.6)
              .stroke({ width: thick, color: INK.cream, cap: "round", join: "round" }),
          );
        }
      } else if (status === "blocked") {
        const a = g.cell * 0.14;
        marks.push(() =>
          p
            .moveTo(c.x - (across ? a : 0), c.y - (across ? 0 : a))
            .lineTo(c.x + (across ? a : 0), c.y + (across ? 0 : a))
            .stroke({ width: thick, color: INK.dim, cap: "round" }),
        );
      }
    }
    const wall = (side: number, from: number, to: number, line: (a: number, b: number) => void): void => {
      let at = from;
      for (const [a, b] of gaps[side]!.slice().sort((m, n) => m[0] - n[0])) {
        if (a > at) line(at, a);
        at = Math.max(at, b);
      }
      if (to > at) line(at, to);
    };
    wall(0, x0, x1, (a, b) => p.moveTo(a, y0).lineTo(b, y0));
    wall(2, x0, x1, (a, b) => p.moveTo(a, y1).lineTo(b, y1));
    wall(3, y0, y1, (a, b) => p.moveTo(x0, a).lineTo(x0, b));
    wall(1, y0, y1, (a, b) => p.moveTo(x1, a).lineTo(x1, b));
    p.stroke({ width: 1, color: INK.line });
    for (const mark of marks) mark();
  }

  protected override update(dt: number): void {
    this.drawPorts();
    if (!this.interactive || !this.hints || !this.state || this.state.finished || this.busy) {
      this.idle = 0;
      this.hintLayer.clear();
      return;
    }
    this.idle += dt;
    this.hintLayer.clear();
    if (this.idle < HINT_AFTER_MS) return;
    const dir = reactorHint(this.state);
    if (dir === null) return;
    // Three chevrons across the middle of the core, marching the way to swipe.
    const g = this.grid;
    const [dx, dy] = STEP[dir]!;
    const cx = g.ox + g.width / 2;
    const cy = g.oy + g.height / 2;
    const a = g.cell * 0.34;
    for (let i = 0; i < 3; i++) {
      // A hint is cream, never amber: it is the board's advice. Reduced motion holds the chevrons still.
      const phase = this.reduced ? (i + 0.5) / 3 : (this.time / 520 + i / 3) % 1;
      const o = (phase - 0.5) * g.cell * 1.5;
      const x = cx + dx * o;
      const y = cy + dy * o;
      this.hintLayer
        .moveTo(x - dy * a - dx * a * 0.6, y + dx * a - dy * a * 0.6)
        .lineTo(x + dx * a * 0.6, y + dy * a * 0.6)
        .lineTo(x + dy * a - dx * a * 0.6, y - dx * a - dy * a * 0.6)
        .stroke({ width: Math.max(4, g.cell * 0.08), color: INK.cream, alpha: 0.55 * Math.sin(phase * Math.PI), cap: "round", join: "round" });
    }
  }

  // ---- input

  private trySwipe(dir: ReactorDir): void {
    const state = this.state;
    if (!state || state.finished) return;
    this.idle = 0;
    // The round decides, not this board's copy of it: two quick swipes can outrun a redraw.
    if (this.cb.onSwipe(dir)) return;
    // Nothing would move: the rods lean that way and settle back.
    sfx.bump();
    if (this.busy || reactorCanSwipe(state, dir)) return;
    const [dx, dy] = STEP[dir]!;
    const lean = Math.max(4, this.grid.cell * 0.07);
    this.tweens.to(this.rodLayer, { x: dx * lean, y: dy * lean }, 60, { ease: ease.outQuad });
    this.tweens.move(this.rodLayer, { x: 0, y: 0 }, { delay: 60 });
  }

  protected override pointerDown(x: number, y: number): void {
    this.drag = { x, y, fired: false };
  }

  /** A swipe is taken as soon as the finger has gone far enough one way: no need to lift. */
  protected override pointerMove(x: number, y: number): void {
    const d = this.drag;
    if (!d || d.fired || !this.interactive) return;
    const dx = x - d.x;
    const dy = y - d.y;
    const far = Math.max(16, this.grid.cell * 0.24);
    if (Math.abs(dx) < far && Math.abs(dy) < far) return;
    d.fired = true;
    this.trySwipe(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0);
  }

  protected override pointerUp(): void {
    this.drag = null;
  }

  protected override pointerCancel(): void {
    this.drag = null;
  }

  /** Arrows or WASD swipe the core. */
  override keyboard(key: string): boolean {
    if (!this.interactive || !this.state) return false;
    const k = key.length === 1 ? key.toLowerCase() : key;
    const dirs: Record<string, ReactorDir> = { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3, w: 0, d: 1, s: 2, a: 3 };
    const dir = dirs[k];
    if (dir === undefined) return false;
    this.trySwipe(dir);
    return true;
  }
}
