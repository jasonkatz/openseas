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
import { FONT, INK, drawPanel, drawPips, drawWell, mix } from "../kit/art.js";
import { Grid, KitBoard } from "../kit/board.js";
import { ease } from "../kit/tween.js";

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
  showMarks: boolean;
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
/** A rod's color by grade, cool to warm. The hot grade is drawn its own way, whatever its number. */
const GRADE_COLORS = [0x58c4f6, 0x7bd88f, 0xf5d021, 0xff9f43, 0xb48cff, 0xf78fb3, 0xf2f0e6, 0x9fb4d8];
const HOT = 0xff5a3c;
const HOT_CORE = 0xfff0b8;
const PORT = 0x5fe3a1;
const BLOCKED = 0xf5b942;
const SLIDE_MS = 120;
const HINT_AFTER_MS = 5000;
/** Which segments of a seven-segment digit are lit: top, top-right, bottom-right, bottom, bottom-left, top-left, middle. */
const SEGMENTS = ["1111110", "0110000", "1101101", "1111001", "0110011", "1011011", "1011111", "1110000", "1111111", "1111011"];

const portKey = (p: ReactorPort): string => `${p.side}${p.lane}`;

/** Draws the reactor core and turns a swipe into a move. Scores nothing: every number it shows is the engine's. */
export class ReactorRenderer extends KitBoard<ReactorState> {
  private readonly grid = new Grid(4, 4);
  private readonly bg = new Graphics();
  private readonly laneLayer = new Graphics();
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
  /** The ports drawn, and when each first appeared, for its opening flourish. */
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
    super(host, "reactor", cb.onFrame, opts.showMarks);
    this.hints = opts.hints;
  }

  override setHints(on: boolean): void {
    this.hints = on;
  }

  protected build(): void {
    const style = { fontFamily: FONT, fontSize: 12, fontWeight: "700" as const, fill: INK.dim, letterSpacing: 1.5 };
    this.nextText = new Text({ text: this.opts.labels.next, style });
    this.hotText = new Text({ text: this.opts.labels.hot, style });
    this.pipeText = new Text({ text: this.opts.labels.pipelineIdle, style });
    this.nextText.anchor.set(0, 0.5);
    this.hotText.anchor.set(1, 0.5);
    this.pipeText.anchor.set(0, 0.5);
    this.nextRod.anchor.set(0.5);
    this.rodLayer.mask = this.rodMask;
    this.rodLayer.sortableChildren = true;
    this.world.addChild(this.rodMask, this.bg, this.laneLayer, this.rodLayer, this.portLayer, this.hintLayer, this.hud, this.nextRod, this.nextText, this.hotText, this.pipeText);
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
    drawPanel(b, g.ox - pad, g.oy - this.strip - pad * 0.4, g.width + pad * 2, g.height + this.strip + this.bar + pad * 1.4, Math.max(10, g.cell * 0.18));
    // The core's wall: a brass frame the ports are cut into.
    b.roundRect(g.ox - this.rim * 0.5, g.oy - this.rim * 0.5, g.width + this.rim, g.height + this.rim, g.cell * 0.14).fill({ color: INK.bg });
    b.roundRect(g.ox - this.rim * 0.5, g.oy - this.rim * 0.5, g.width + this.rim, g.height + this.rim, g.cell * 0.14).stroke({ width: Math.max(2, this.rim * 0.42), color: INK.brass, alpha: 0.55 });
    for (let i = 0; i < g.cols * g.rows; i++) drawWell(b, g.x(i) - g.cell / 2, g.y(i) - g.cell / 2, g.cell);
    this.rodMask.clear().rect(g.ox - this.rim * 1.4, g.oy - this.rim * 1.4, g.width + this.rim * 2.8, g.height + this.rim * 2.8).fill({ color: 0xffffff });
    const font = Math.max(10, Math.round(g.cell * 0.17));
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

  private colorOf(grade: number): number {
    return GRADE_COLORS[(grade - 1) % GRADE_COLORS.length]!;
  }

  private texture(grade: number, hot: boolean): Texture {
    const cell = this.grid.cell;
    return this.bake(`rod:${grade}:${hot ? 1 : 0}:${this.showMarks ? 1 : 0}`, cell, (g) => {
      // A hot rod is one toothed disc whatever its grade; a casing past the sheet's seven is drawn in code.
      if (hot) this.sprite(g, "hot", 0, 0, cell * 0.9) || drawHotRod(g, cell);
      else this.sprite(g, `grade-${grade}`, 0, 0, cell * 0.9) || drawRod(g, cell, grade, this.colorOf(grade));
      // The mark setting adds the grade as a numeral, so no rod is told by color or count alone.
      if (this.showMarks) drawDigit(g, grade % 10, cell * 0.27, -cell * 0.27, cell * 0.2, hot ? 0x3a0d05 : 0x0a1424);
    });
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

  private setPorts(ports: readonly ReactorPort[], flourish: boolean): void {
    const keys = new Set(ports.map(portKey));
    for (const key of [...this.portBorn.keys()]) if (!keys.has(key)) this.portBorn.delete(key);
    for (const p of ports) {
      const key = portKey(p);
      if (this.portBorn.has(key)) continue;
      this.portBorn.set(key, flourish ? this.time : -10_000);
      if (flourish) {
        const at = this.portPoint(p, 0.5);
        this.fx.ring(at.x, at.y, PORT, this.grid.cell * 0.1, this.grid.cell * 0.55, 420, 3);
      }
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
    const labels = this.opts.labels;
    const [dx, dy] = STEP[r.dir]!;
    if (r.fusions.length === 0 && r.discharges.length === 0) sfx.swapQuiet();

    for (const sl of r.slides) {
      const v = this.rods.get(sl.id);
      if (!v) continue;
      const x = g.x(sl.to);
      const y = g.y(sl.to);
      if (sl.out) {
        // To the wall, then out through the port.
        this.rods.delete(sl.id);
        v.s.zIndex = 2;
        this.tweens.to(v.s, { x, y }, SLIDE_MS, { ease: ease.outCubic });
        this.tweens.to(v.s, { x: x + dx * g.cell * 0.9, y: y + dy * g.cell * 0.9, scale: 0.55, alpha: 0 }, 170, { delay: SLIDE_MS, ease: ease.inCubic, done: () => v.s.destroy() });
      } else if (sl.into !== null) {
        this.rods.delete(sl.id);
        this.tweens.to(v.s, { x, y }, SLIDE_MS, { ease: ease.outCubic, done: () => v.s.destroy() });
      } else {
        v.cell = sl.to;
        v.s.zIndex = 1;
        this.tweens.to(v.s, { x, y }, SLIDE_MS, { ease: ease.outCubic });
      }
    }

    let t = SLIDE_MS;
    if (r.fusions.length > 0) {
      this.tweens.after(t, () => {
        let top = 0;
        for (const f of r.fusions) {
          const v = this.rods.get(f.id);
          if (!v) continue;
          v.grade = f.grade;
          v.s.texture = this.texture(f.grade, f.hot);
          v.s.scale.set(1.26);
          this.tweens.to(v.s, { scale: 1 }, 190, { ease: ease.outBack });
          const x = g.x(f.cell);
          const y = g.y(f.cell);
          this.fx.burst(x, y, f.hot ? HOT : this.colorOf(f.grade), f.hot ? 14 : 6, f.hot ? 0.26 : 0.16, 3);
          this.fx.popup(x, y - g.cell * 0.3, `+${f.points}`, f.hot ? HOT_CORE : INK.text, Math.max(13, g.cell * 0.2));
          if (f.hot) {
            this.fx.ring(x, y, HOT, g.cell * 0.3, g.cell * 0.95, 460, 4);
            this.fx.shake(3, 160);
          }
          top = Math.max(top, f.grade);
        }
        sfx.pop(Math.min(9, top * 2 - 2));
        if (r.fusions.some((f) => f.hot)) {
          sfx.power(1);
          if (r.discharges.length === 0 && !r.scram) this.fx.say(labels.hotRod, HOT_CORE, Math.max(18, g.cell * 0.3));
        }
      });
    }

    if (r.discharges.length > 0) {
      const n = r.discharges.length;
      r.discharges.forEach((d, i) => {
        this.tweens.after(t + 40 + i * 90, () => {
          const x = g.x(d.cell);
          const y = g.y(d.cell);
          const out = this.portPoint(d.port, 1.6);
          this.fx.beam([x, y, out.x, out.y], HOT, Math.max(4, g.cell * 0.09), 300);
          this.fx.burst(out.x, out.y, HOT_CORE, 16, 0.3, 4);
          this.fx.ring(out.x, out.y, HOT, g.cell * 0.15, g.cell * 0.8, 420, 4);
          this.fx.shake(5 + i * 2, 200);
          sfx.zap();
          sfx.clear(Math.min(6, d.pipeline), 5);
          if (n === 1) this.fx.popup(x, y, `+${d.points}`, INK.gold, Math.max(18, g.cell * 0.36));
        });
      });
      const after = t + 40 + (n - 1) * 90 + 60;
      this.tweens.after(after, () => {
        const last = r.discharges[n - 1]!;
        if (n >= 2) {
          this.fx.flash(HOT, 0.2, 320);
          this.fx.shake(11, 320);
          this.fx.say(labels.salvo(n), HOT_CORE);
          this.fx.popup(g.ox + g.width / 2, g.oy + g.height / 2, `+${r.dischargeTotal}`, INK.gold, Math.max(24, g.cell * 0.5));
          sfx.streak(n * 4);
        } else if (last.pipeline >= 2) this.fx.say(labels.run(last.pipeline), INK.gold, Math.max(18, g.cell * 0.3));
        // The used port shuts and its replacement opens.
        this.setPorts(state.ports, true);
        if (r.opened.length > 0) sfx.tick(false);
      });
      t = after + 60;
    } else t += 20;

    if (r.entered) {
      const e = r.entered;
      this.tweens.after(t, () => {
        const v = this.spawn(e.id, e.grade, e.cell);
        v.s.position.set(g.x(e.cell) - dx * g.cell * 0.8, g.y(e.cell) - dy * g.cell * 0.8);
        v.s.alpha = 0;
        this.tweens.to(v.s, { x: g.x(e.cell), y: g.y(e.cell), alpha: 1 }, 130, { ease: ease.outCubic });
        this.drawHud(state);
      });
      t += 130;
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
        this.fx.flash(INK.danger, 0.34, 520);
        this.fx.shake(16, 480);
        this.fx.say(scram.cause === "critical" ? labels.critical(scram.penalty) : labels.jammed(scram.penalty), INK.danger);
        for (const [id, v] of this.rods) {
          this.fx.burst(v.s.x, v.s.y, reactorIsHot(state.config, v.grade) ? HOT : this.colorOf(v.grade), 6, 0.26, 3);
          this.rods.delete(id);
          this.tweens.to(v.s, { scale: 0.3, alpha: 0 }, 240, { ease: ease.inCubic, done: () => v.s.destroy() });
        }
      });
      t += 340;
      this.tweens.after(t, () => {
        for (const f of scram.fresh) {
          const v = this.spawn(f.id, f.grade, f.cell);
          v.s.scale.set(0.2);
          this.tweens.to(v.s, { scale: 1 }, 220, { ease: ease.outBack });
        }
        sfx.swap();
      });
      t += 220;
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

    // Heat: one lamp a hot rod the core can hold; the last is the one that scrams it.
    const hot = reactorHotCount(cfg, state.cells);
    const step = g.cell * 0.2;
    const r = g.cell * 0.07;
    for (let i = 0; i < cfg.criticalHot; i++) {
      const x = g.ox + g.width - (cfg.criticalHot - i - 0.5) * step;
      const last = i === cfg.criticalHot - 1;
      const lit = i < hot;
      if (last) {
        // The critical lamp is a diamond, so it reads apart from the others without its color.
        h.poly([x, stripY - r * 1.5, x + r * 1.5, stripY, x, stripY + r * 1.5, x - r * 1.5, stripY]).fill({ color: lit ? INK.danger : INK.well });
        h.poly([x, stripY - r * 1.5, x + r * 1.5, stripY, x, stripY + r * 1.5, x - r * 1.5, stripY]).stroke({ width: 1.5, color: INK.danger, alpha: 0.9 });
      } else {
        h.circle(x, stripY, r * 1.15).fill({ color: lit ? HOT : INK.well });
        h.circle(x, stripY, r * 1.15).stroke({ width: 1.5, color: lit ? HOT_CORE : INK.edge, alpha: 0.9 });
      }
    }
    this.hotText?.position.set(g.ox + g.width - this.lampSpan(), stripY);
    if (this.hotText) this.hotText.style.fill = hot >= cfg.criticalHot - 1 ? INK.danger : INK.dim;

    // Pipeline: a segment a swipe left before the run is lost, and what the next discharge is worth.
    const left = reactorPipelineLeft(state);
    const running = left > 0;
    if (this.pipeText) {
      this.pipeText.text = running ? this.opts.labels.pipeline(reactorPipelinePercentAt(cfg, state.combo + 1)) : this.opts.labels.pipelineIdle;
      this.pipeText.style.fill = running ? INK.gold : INK.dim;
    }
    const barY = g.oy + g.height + this.rim + this.bar * 0.72;
    const segs = Math.min(cfg.pipelineSwipes, 24);
    const gap = Math.max(2, g.cell * 0.03);
    const w = (g.width - gap * (segs - 1)) / segs;
    const shown = Math.ceil((left * segs) / cfg.pipelineSwipes);
    for (let i = 0; i < segs; i++) {
      const lit = i < shown;
      h.roundRect(g.ox + i * (w + gap), barY - this.bar * 0.1, w, this.bar * 0.2, this.bar * 0.1).fill({ color: lit ? (shown <= 2 ? INK.danger : INK.gold) : INK.well, alpha: lit ? 1 : 0.9 });
    }
  }

  /** A point on a port's gate: `out` rims beyond the wall, measured from the wall's edge. */
  private portPoint(p: ReactorPort, out: number): { x: number; y: number } {
    const g = this.grid;
    const cell = this.state ? reactorPortCell(this.state.config, p) : 0;
    const [dx, dy] = STEP[p.side]!;
    return { x: g.x(cell) + dx * (g.cell / 2 + this.rim * out), y: g.y(cell) + dy * (g.cell / 2 + this.rim * out) };
  }

  /** The ports and their lanes, every frame: a port a hot rod can reach pulses, one that is blocked says so. */
  private drawPorts(): void {
    const g = this.grid;
    const state = this.state;
    const l = this.laneLayer;
    const p = this.portLayer;
    l.clear();
    p.clear();
    if (!state) return;
    const pulse = 0.5 + 0.5 * Math.sin(this.time / 170);
    for (const port of this.ports) {
      const status = reactorPortStatus(state, port);
      const [dx, dy] = STEP[port.side]!;
      const across = port.side === 0 || port.side === 2;
      const color = status === "blocked" ? BLOCKED : PORT;
      const age = Math.min(1, (this.time - (this.portBorn.get(portKey(port)) ?? -10_000)) / 260);
      const grow = age < 1 ? 0.3 + 0.7 * ease.outBack(age) : 1;

      // The lane the port serves: a faint band a hot rod must be in.
      const first = reactorPortCell(state.config, port);
      const bx = across ? g.x(first) - g.cell / 2 : g.ox;
      const by = across ? g.oy : g.y(first) - g.cell / 2;
      l.rect(bx, by, across ? g.cell : g.width, across ? g.height : g.cell).fill({ color, alpha: status === "ready" ? 0.1 + 0.08 * pulse : status === "blocked" ? 0.08 : 0.045 });

      // The gate: a slot through the wall.
      const c = this.portPoint(port, 0.1);
      const long = g.cell * 0.66 * grow;
      const thick = this.rim * 1.5;
      const w = across ? long : thick;
      const h = across ? thick : long;
      if (status === "ready") p.roundRect(c.x - w / 2 - 4, c.y - h / 2 - 4, w + 8, h + 8, thick * 0.5).fill({ color, alpha: 0.18 + 0.22 * pulse });
      p.roundRect(c.x - w / 2, c.y - h / 2, w, h, thick * 0.4).fill({ color: mix(color, INK.black, status === "ready" ? 0.1 : 0.55) });
      p.roundRect(c.x - w / 2, c.y - h / 2, w, h, thick * 0.4).stroke({ width: 2, color, alpha: 0.95 });
      // What the gate says without its color: chevrons out when it is ready (one a rod waiting), a bar across when it is blocked.
      const mark = mix(color, INK.white, 0.55);
      if (status === "ready") {
        const load = Math.min(3, reactorPortLoad(state, port));
        for (let i = 0; i < load; i++) {
          const o = (i - (load - 1) / 2) * g.cell * 0.17;
          const mx = c.x + (across ? o : 0) + dx * pulse * 2;
          const my = c.y + (across ? 0 : o) + dy * pulse * 2;
          const a = thick * 0.34;
          p.moveTo(mx - dy * a - dx * a * 0.6, my + dx * a - dy * a * 0.6)
            .lineTo(mx + dx * a * 0.7, my + dy * a * 0.7)
            .lineTo(mx + dy * a - dx * a * 0.6, my - dx * a - dy * a * 0.6)
            .stroke({ width: 2.4, color: INK.bg, alpha: 0.95, cap: "round", join: "round" });
        }
      } else if (status === "blocked") {
        const a = long * 0.28;
        p.moveTo(c.x - (across ? a : 0), c.y - (across ? 0 : a))
          .lineTo(c.x + (across ? a : 0), c.y + (across ? 0 : a))
          .stroke({ width: 3, color: mark, alpha: 0.95, cap: "round" });
      } else {
        p.circle(c.x, c.y, Math.max(1.6, thick * 0.16)).fill({ color: mark, alpha: 0.9 });
      }
    }
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
      const phase = (this.time / 520 + i / 3) % 1;
      const o = (phase - 0.5) * g.cell * 1.5;
      const x = cx + dx * o;
      const y = cy + dy * o;
      this.hintLayer
        .moveTo(x - dy * a - dx * a * 0.6, y + dx * a - dy * a * 0.6)
        .lineTo(x + dx * a * 0.6, y + dy * a * 0.6)
        .lineTo(x + dy * a - dx * a * 0.6, y - dx * a - dy * a * 0.6)
        .stroke({ width: Math.max(4, g.cell * 0.08), color: INK.white, alpha: 0.55 * Math.sin(phase * Math.PI), cap: "round", join: "round" });
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
    this.tweens.to(this.rodLayer, { x: dx * lean, y: dy * lean }, 70, { ease: ease.outQuad });
    this.tweens.to(this.rodLayer, { x: 0, y: 0 }, 130, { delay: 70, ease: ease.outBack });
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

/** A fuel rod below the hot grade: a rounded casing with one bar a grade, so the count reads without the color. */
function drawRod(g: Graphics, cell: number, grade: number, color: number): void {
  const half = cell * 0.41;
  const r = cell * 0.16;
  g.roundRect(-half, -half + cell * 0.035, half * 2, half * 2, r).fill({ color: INK.black, alpha: 0.35 });
  g.roundRect(-half, -half, half * 2, half * 2, r).fill({ color });
  g.roundRect(-half, -half, half * 2, half * 2, r).stroke({ width: Math.max(1.5, cell * 0.035), color: mix(color, INK.black, 0.5) });
  g.roundRect(-half * 0.82, -half * 0.86, half * 1.64, half * 0.5, r * 0.6).fill({ color: mix(color, INK.white, 0.6), alpha: 0.35 });
  const ink = mix(color, INK.black, 0.72);
  if (grade <= 4) {
    const w = cell * 0.1;
    const h = cell * 0.4;
    const gap = cell * 0.075;
    const span = grade * w + (grade - 1) * gap;
    for (let i = 0; i < grade; i++) g.roundRect(-span / 2 + i * (w + gap), -h / 2 + cell * 0.03, w, h, w / 2).fill({ color: ink });
  } else drawPips(g, Math.min(8, grade), 0, cell * 0.03, cell * 0.36, ink, 1);
}

/** A hot rod: a toothed disc with a white-hot heart. Its outline is nothing like a casing's, so it reads as hot with no color at all. */
function drawHotRod(g: Graphics, cell: number): void {
  const outer = cell * 0.45;
  const inner = cell * 0.36;
  const teeth = 10;
  const star = (cy: number): number[] => {
    const pts: number[] = [];
    for (let i = 0; i < teeth * 2; i++) {
      const rr = i % 2 === 0 ? outer : inner;
      const a = -Math.PI / 2 + (i * Math.PI) / teeth;
      pts.push(rr * Math.cos(a), cy + rr * Math.sin(a));
    }
    return pts;
  };
  g.poly(star(cell * 0.035)).fill({ color: INK.black, alpha: 0.35 });
  g.poly(star(0)).fill({ color: HOT });
  g.poly(star(0)).stroke({ width: Math.max(1.5, cell * 0.035), color: mix(HOT, INK.black, 0.5), join: "round" });
  g.circle(0, 0, cell * 0.27).fill({ color: mix(HOT, HOT_CORE, 0.45) });
  g.circle(0, 0, cell * 0.17).fill({ color: HOT_CORE });
  g.circle(-cell * 0.05, -cell * 0.06, cell * 0.06).fill({ color: INK.white, alpha: 0.85 });
}

/** One seven-segment digit, `h` tall, centred on (x, y): the mark that names a grade outright. */
function drawDigit(g: Graphics, digit: number, x: number, y: number, h: number, color: number): void {
  const w = h * 0.56;
  const t = Math.max(1.6, h * 0.17);
  const lit = SEGMENTS[digit] ?? SEGMENTS[0]!;
  // A plate behind it, so the digit reads over any casing.
  g.roundRect(x - w / 2 - t, y - h / 2 - t, w + t * 2, h + t * 2, t).fill({ color: INK.white, alpha: 0.82 });
  const seg = (on: string | undefined, sx: number, sy: number, sw: number, sh: number): void => {
    if (on === "1") g.rect(x + sx, y + sy, sw, sh).fill({ color });
  };
  seg(lit[0], -w / 2, -h / 2, w, t);
  seg(lit[1], w / 2 - t, -h / 2, t, h / 2);
  seg(lit[2], w / 2 - t, 0, t, h / 2);
  seg(lit[3], -w / 2, h / 2 - t, w, t);
  seg(lit[4], -w / 2, 0, t, h / 2);
  seg(lit[5], -w / 2, -h / 2, t, h / 2);
  seg(lit[6], -w / 2, -t / 2, w, t);
}
