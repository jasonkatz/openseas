import { Application, Container, Graphics, Text, type FederatedPointerEvent } from "pixi.js";
import {
  navigationColorOf,
  navigationLandingSlot,
  navigationOctantOf,
  navigationRingOf,
  navigationShapeOf,
  navigationSlotOf,
  type Completion,
  type NavigationState,
} from "@openseas/engine";
import type { NavigationContent } from "@openseas/content";
import { paintStar, type StarShapeName } from "./stars.js";

export interface NavigationCallbacks {
  onRotate(ring: number, dir: -1 | 1): void;
  onDrop(): void;
  /** First frame drawn after a new state arrived. */
  onFrame(): void;
  onLanded(): void;
  onBooch(): void;
  onCharted(c: Completion): void;
  onNudge(): void;
}

export interface NavigationRendererOptions {
  showMarks: boolean;
  showMarkers: boolean;
  chartedLabel: string;
  boochLabel: string;
  chainLabel(chain: number): string;
  efficientLabel: string;
  /** Label over the next-star badge the chart draws when the canvas is taller than the chart. */
  nextLabel: string;
}

interface StarView {
  g: Graphics;
  kind: number;
  ring: number;
  octant: number;
  /** Position inside the ring container. */
  x: number;
  y: number;
  tx: number;
  ty: number;
  dying: number | null;
  flash: number;
}

interface Popup {
  t: Text;
  life: number;
  max: number;
  y0: number;
}

interface Pending {
  at: number;
  run(): void;
}

const COLORS = {
  sky: 0x070e1a,
  skyEdge: 0x16294a,
  ring: 0x24395f,
  ringLine: 0x5b7bb3,
  brass: 0xd4a548,
  brassLight: 0xf5d58a,
  danger: 0xf0604d,
  select: 0xf2f0e6,
};
const SPIN_MS = 170;
const LAND_MS = 240;
const DIE_MS = 260;

export class NavigationRenderer {
  readonly app = new Application();
  private readonly chart = new Container();
  private readonly sky = new Graphics();
  private readonly markerLayer = new Graphics();
  private readonly highlight = new Graphics();
  private readonly ringLayers: Container[] = [];
  private readonly ringSpin: number[] = [];
  private readonly path = new Graphics();
  private readonly fallingLayer = new Graphics();
  private readonly nextBadge = new Graphics();
  private readonly nextText = new Text({ text: "", style: { fontFamily: "Atkinson Hyperlegible, sans-serif", fontSize: 11, fontWeight: "700", fill: 0xc9bb9a, letterSpacing: 2 } });
  private readonly fxLayer = new Container();
  private readonly stars = new Map<number, StarView>();
  private readonly popups: Popup[] = [];
  private readonly pending: Pending[] = [];
  private readonly colorHex: number[] = [];
  private readonly colorMark: string[] = [];
  private readonly shapeName: StarShapeName[] = [];
  private readonly reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  private showMarks: boolean;
  private showMarkers: boolean;
  private rings: number;
  private octants: number;
  private cx = 0;
  private cy = 0;
  private R = 100;
  private time = 0;
  private state: NavigationState | null = null;
  private shownMarkers: NavigationState["markers"] = [];
  private shownCurrent: NavigationState["current"] | null = null;
  private interactive = false;
  private framePending = false;
  private viewStale = true;
  private destroyed = false;
  private selectedRing = 1;
  private keyboardUsed = false;
  private shake = 0;
  private drag: { ring: number | null; zone: "ring" | "center" | "falling" | null; angle: number; acc: number; moved: boolean; x: number } | null = null;

  constructor(
    private readonly host: HTMLElement,
    content: NavigationContent,
    private readonly cb: NavigationCallbacks,
    private readonly opts: NavigationRendererOptions,
  ) {
    this.showMarks = opts.showMarks;
    this.showMarkers = opts.showMarkers;
    this.rings = content.config.rings;
    this.octants = content.config.octants;
    for (const c of content.colors) {
      this.colorHex.push(parseInt(c.color.slice(1), 16));
      this.colorMark.push(c.mark);
    }
    for (const s of content.shapes) this.shapeName.push(s.shape);
    this.selectedRing = Math.min(1, this.rings - 1);
  }

  async init(): Promise<void> {
    await this.app.init({
      resizeTo: this.host,
      backgroundAlpha: 0,
      antialias: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
      autoDensity: true,
      preference: "webgl",
    });
    if (this.destroyed) {
      this.app.destroy(true);
      return;
    }
    this.app.canvas.style.touchAction = "none";
    this.app.canvas.setAttribute("data-testid", "navigation-canvas");
    this.host.appendChild(this.app.canvas);
    this.chart.addChild(this.sky, this.highlight, this.markerLayer);
    for (let r = 0; r < this.rings; r++) {
      const c = new Container();
      this.ringLayers.push(c);
      this.ringSpin.push(0);
      this.chart.addChild(c);
    }
    this.chart.addChild(this.path, this.fallingLayer, this.fxLayer);
    this.nextText.anchor.set(0.5, 1);
    this.nextText.text = this.opts.nextLabel.toUpperCase();
    this.app.stage.addChild(this.chart, this.nextBadge, this.nextText);
    this.app.stage.eventMode = "static";
    this.app.stage.hitArea = this.app.screen;
    this.app.stage.on("pointerdown", (e) => this.pointerDown(e));
    this.app.stage.on("pointermove", (e) => this.pointerMove(e));
    this.app.stage.on("pointerup", (e) => this.pointerUp(e));
    this.app.stage.on("pointerupoutside", () => this.pointerCancel());
    this.app.renderer.on("resize", () => this.layout());
    this.app.ticker.add((ticker) => this.tick(Math.min(50, ticker.deltaMS)));
    this.layout();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.app.renderer) this.app.destroy(true, { children: true });
  }

  setInteractive(on: boolean): void {
    this.interactive = on;
    if (!on) this.drag = null;
    this.drawFalling();
    this.drawHighlight();
  }

  setShowMarks(on: boolean): void {
    if (this.showMarks === on) return;
    this.showMarks = on;
    this.repaintStars();
    this.drawMarkers();
    this.drawFalling();
  }

  setShowMarkers(on: boolean): void {
    if (this.showMarkers === on) return;
    this.showMarkers = on;
    this.drawMarkers();
  }

  /** A new engine state. Plays the last move back; anything still animating fast-forwards. */
  setState(state: NavigationState): void {
    if (!this.app.renderer) return;
    const prev = this.state;
    this.state = state;
    this.framePending = true;
    this.viewStale = true;
    const report = state.lastMove;
    this.flushPending();
    if (!prev || !report || report.move.type === "end") {
      this.shownMarkers = state.markers;
      this.shownCurrent = state.current;
      this.place(state, true);
      this.drawMarkers();
      this.drawFalling();
      return;
    }
    let delay = 0;
    if (report.move.type === "rotate") {
      const dir = report.move.dir;
      const ring = report.move.ring;
      this.ringSpin[ring] = (this.ringSpin[ring] ?? 0) - dir * ((Math.PI * 2) / this.octants);
      this.ringLayers[ring]!.rotation = this.ringSpin[ring]!;
    }
    if (report.landed) {
      const slot = report.landed.slot;
      const ring = navigationRingOf(state.config, slot);
      const octant = navigationOctantOf(state.config, slot);
      const v = this.spawnStar(report.landed.id, state.slots[slot]!.kind, ring, octant);
      // Start where the falling star hovers: outside the rim at the octant's angle.
      const a = this.angleOf(octant);
      v.x = Math.cos(a) * this.R * 0.93;
      v.y = Math.sin(a) * this.R * 0.93;
      v.g.position.set(v.x, v.y);
      this.cb.onLanded();
      delay = this.reduced ? 60 : LAND_MS;
    }
    if (report.booch) {
      for (const id of report.booch.ids) {
        const v = this.stars.get(id);
        if (v) v.dying = 0;
      }
      this.shake = 1;
      this.cb.onBooch();
      this.callout(this.opts.boochLabel, COLORS.danger);
      this.popup(this.cx * 0 + Math.cos(this.angleOf(report.booch.octant)) * this.R * 0.5, Math.sin(this.angleOf(report.booch.octant)) * this.R * 0.5, `-${report.booch.penalty}`, COLORS.danger);
    }
    // Stars not in the new state and not already dying (swept by a completion) go after the landing shows.
    for (const c of report.completions) {
      const completion = c;
      this.pending.push({
        at: this.time + delay,
        run: () => {
          for (const id of completion.ids) {
            const v = this.stars.get(id);
            if (v) {
              v.flash = 1;
              v.dying = 0;
            }
          }
          this.cb.onCharted(completion);
          this.callout(this.opts.chartedLabel + (completion.chain >= 2 ? ` ${this.opts.chainLabel(completion.chain)}` : ""), COLORS.brassLight);
          this.popup(0, -this.R * 0.08, `+${completion.points}`, COLORS.brass);
          if (completion.efficient) this.popup(0, this.R * 0.12, this.opts.efficientLabel, COLORS.select);
        },
      });
      delay += this.reduced ? 80 : 320;
    }
    this.pending.push({
      at: this.time + delay,
      run: () => {
        this.shownMarkers = state.markers;
        this.drawMarkers();
        this.place(state, false);
      },
    });
    // The next falling star appears once the landing has played.
    this.pending.push({
      at: this.time + (report.landed ? (this.reduced ? 60 : LAND_MS) : 0),
      run: () => {
        this.shownCurrent = state.current;
        this.drawFalling();
      },
    });
    this.place(state, false, true);
  }

  private flushPending(): void {
    while (this.pending.length) this.pending.shift()!.run();
    for (const v of this.stars.values()) {
      v.x = v.tx;
      v.y = v.ty;
      v.g.position.set(v.x, v.y);
      if (v.dying !== null) this.kill(v);
    }
    for (let r = 0; r < this.rings; r++) {
      this.ringSpin[r] = 0;
      this.ringLayers[r]!.rotation = 0;
    }
  }

  /** Make the star views match `state.slots`. With `keepGone`, stars absent from the state are left for a pending step. */
  private place(state: NavigationState, snap: boolean, keepGone = false): void {
    const seen = new Set<number>();
    for (let slot = 0; slot < state.slots.length; slot++) {
      const s = state.slots[slot];
      if (!s) continue;
      seen.add(s.id);
      const ring = navigationRingOf(state.config, slot);
      const octant = navigationOctantOf(state.config, slot);
      let v = this.stars.get(s.id);
      if (!v) v = this.spawnStar(s.id, s.kind, ring, octant);
      if (v.ring !== ring) {
        this.ringLayers[v.ring]!.removeChild(v.g);
        this.ringLayers[ring]!.addChild(v.g);
        v.ring = ring;
      }
      v.octant = octant;
      const a = this.angleOf(octant);
      const rad = this.ringRadius(ring);
      v.tx = Math.cos(a) * rad;
      v.ty = Math.sin(a) * rad;
      if (snap) {
        v.x = v.tx;
        v.y = v.ty;
        v.g.position.set(v.x, v.y);
      }
    }
    if (!keepGone) for (const [id, v] of this.stars) if (!seen.has(id) && v.dying === null) v.dying = 0;
  }

  private spawnStar(id: number, kind: number, ring: number, octant: number): StarView {
    const g = new Graphics();
    const a = this.angleOf(octant);
    const rad = this.ringRadius(ring);
    const v: StarView = { g, kind, ring, octant, x: Math.cos(a) * rad, y: Math.sin(a) * rad, tx: Math.cos(a) * rad, ty: Math.sin(a) * rad, dying: null, flash: 0 };
    g.position.set(v.x, v.y);
    this.paintStarView(v);
    this.ringLayers[ring]!.addChild(g);
    this.stars.set(id, v);
    return v;
  }

  private paintStarView(v: StarView): void {
    const cfg = this.state?.config;
    const colors = cfg?.colors ?? this.colorHex.length;
    const shape = Math.floor(v.kind / colors);
    const color = v.kind % colors;
    v.g.clear();
    paintStar(v.g, 0, 0, this.starSize(), {
      shape: this.shapeName[shape] ?? "star",
      color: this.colorHex[color] ?? 0xffffff,
      hollow: false,
      mark: this.showMarks ? (this.colorMark[color] ?? null) : null,
    });
  }

  private repaintStars(): void {
    for (const v of this.stars.values()) this.paintStarView(v);
  }

  private kill(v: StarView): void {
    for (const [id, s] of this.stars) if (s === v) this.stars.delete(id);
    v.g.destroy();
  }

  // ---- geometry

  private angleOf(octant: number): number {
    return -Math.PI / 2 + ((octant + 0.5) * Math.PI * 2) / this.octants;
  }
  private bandWidth(): number {
    return (this.R * 0.8 - this.R * 0.18) / this.rings;
  }
  private ringRadius(ring: number): number {
    return this.R * 0.18 + (ring + 0.5) * this.bandWidth();
  }
  private starSize(): number {
    return Math.min(this.bandWidth() * 0.36, ((this.ringRadius(0) * Math.PI * 2) / this.octants) * 0.34);
  }

  private layout(): void {
    if (!this.app.renderer) return;
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    this.cx = w / 2;
    this.cy = h / 2;
    this.R = Math.max(40, Math.min(w, h) / 2 - 6);
    this.chart.position.set(this.cx, this.cy);
    this.drawSky();
    this.drawMarkers();
    this.drawHighlight();
    for (const v of this.stars.values()) {
      const a = this.angleOf(v.octant);
      const rad = this.ringRadius(v.ring);
      v.tx = v.x = Math.cos(a) * rad;
      v.ty = v.y = Math.sin(a) * rad;
      v.g.position.set(v.x, v.y);
    }
    this.repaintStars();
    this.drawFalling();
  }

  private drawSky(): void {
    const g = this.sky;
    const R = this.R;
    g.clear();
    g.circle(0, 0, R).fill({ color: COLORS.sky });
    g.circle(0, 0, R).stroke({ width: 3, color: COLORS.brass, alpha: 0.8 });
    // Faint background stars.
    let seed = 7;
    const rnd = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 70; i++) {
      const a = rnd() * Math.PI * 2;
      const d = Math.sqrt(rnd()) * R * 0.98;
      g.circle(Math.cos(a) * d, Math.sin(a) * d, 0.6 + rnd() * 1.1).fill({ color: 0xffffff, alpha: 0.12 + rnd() * 0.25 });
    }
    // Ring bands.
    const inner = R * 0.18;
    const bw = this.bandWidth();
    for (let r = 0; r < this.rings; r++) {
      const r0 = inner + r * bw;
      const r1 = r0 + bw;
      g.circle(0, 0, r1).fill({ color: r % 2 === 0 ? COLORS.ring : COLORS.skyEdge, alpha: 0.35 });
      g.circle(0, 0, r0).fill({ color: COLORS.sky, alpha: 1 });
      g.circle(0, 0, r1).stroke({ width: 1.2, color: COLORS.ringLine, alpha: 0.6 });
    }
    g.circle(0, 0, inner).stroke({ width: 1.2, color: COLORS.ringLine, alpha: 0.6 });
    // Octant spokes, from the hole to the rim.
    for (let o = 0; o < this.octants; o++) {
      const a = -Math.PI / 2 + (o * Math.PI * 2) / this.octants;
      g.moveTo(Math.cos(a) * inner, Math.sin(a) * inner).lineTo(Math.cos(a) * R * 0.8, Math.sin(a) * R * 0.8);
    }
    g.stroke({ width: 1, color: COLORS.ringLine, alpha: 0.35 });
    // A compass rose in the hole.
    g.circle(0, 0, inner * 0.55).fill({ color: COLORS.skyEdge, alpha: 0.9 });
    g.circle(0, 0, inner * 0.55).stroke({ width: 1.5, color: COLORS.brass, alpha: 0.7 });
    for (let i = 0; i < 4; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 2;
      g.poly([Math.cos(a) * inner * 0.5, Math.sin(a) * inner * 0.5, Math.cos(a + 0.5) * inner * 0.12, Math.sin(a + 0.5) * inner * 0.12, Math.cos(a - 0.5) * inner * 0.12, Math.sin(a - 0.5) * inner * 0.12]).fill({ color: COLORS.brass, alpha: 0.8 });
    }
  }

  private drawMarkers(): void {
    const g = this.markerLayer;
    g.clear();
    if (!this.showMarkers || !this.state) return;
    const cfg = this.state.config;
    for (const m of this.shownMarkers) {
      const a = this.angleOf(m.octant);
      const rad = this.ringRadius(m.ring);
      const color = navigationColorOf(cfg, m.kind);
      paintStar(g, Math.cos(a) * rad, Math.sin(a) * rad, this.starSize() * 1.18, {
        shape: this.shapeName[navigationShapeOf(cfg, m.kind)] ?? "star",
        color: this.colorHex[color] ?? 0xffffff,
        hollow: true,
        mark: this.showMarks ? (this.colorMark[color] ?? null) : null,
      });
    }
  }

  private drawHighlight(): void {
    const g = this.highlight;
    g.clear();
    if (!this.keyboardUsed || !this.interactive) return;
    const r0 = this.R * 0.18 + this.selectedRing * this.bandWidth();
    g.circle(0, 0, r0 + this.bandWidth()).stroke({ width: 2.5, color: COLORS.select, alpha: 0.7 });
    g.circle(0, 0, r0).stroke({ width: 2.5, color: COLORS.select, alpha: 0.7 });
  }

  /** The falling star at the rim, with a dotted path to its landing slot, or a warning when the octant is full. */
  private drawFalling(): void {
    const g = this.fallingLayer;
    const p = this.path;
    g.clear();
    p.clear();
    const state = this.state;
    const cur = this.shownCurrent;
    this.drawNextBadge();
    if (!state || !cur || !this.interactive || state.finished) return;
    const cfg = state.config;
    const a = this.angleOf(cur.octant);
    const rim = this.R * 0.93;
    const color = navigationColorOf(cfg, cur.kind);
    // Where it would land, judged on the state as shown (markers may still be catching up, slots are current).
    const landing = navigationLandingSlot({ ...state, current: cur });
    const end = landing === null ? this.R * 0.18 : this.ringRadius(navigationRingOf(cfg, landing));
    const dots = 7;
    for (let i = 1; i <= dots; i++) {
      const d = rim - ((rim - end) * i) / (dots + 1);
      p.circle(Math.cos(a) * d, Math.sin(a) * d, Math.max(1.2, this.starSize() * 0.12)).fill({ color: landing === null ? COLORS.danger : 0xffffff, alpha: 0.45 });
    }
    if (landing === null) {
      const d = this.ringRadius(this.rings - 1);
      const s = this.starSize() * 0.6;
      const x = Math.cos(a) * d;
      const y = Math.sin(a) * d;
      p.moveTo(x - s, y - s).lineTo(x + s, y + s).moveTo(x + s, y - s).lineTo(x - s, y + s).stroke({ width: 3, color: COLORS.danger, alpha: 0.8 });
    } else {
      const d = this.ringRadius(navigationRingOf(cfg, landing));
      g.circle(Math.cos(a) * d, Math.sin(a) * d, this.starSize() * 1.1).stroke({ width: 1.5, color: 0xffffff, alpha: 0.35 });
    }
    paintStar(g, Math.cos(a) * rim, Math.sin(a) * rim, this.starSize() * 1.05, {
      shape: this.shapeName[navigationShapeOf(cfg, cur.kind)] ?? "star",
      color: this.colorHex[color] ?? 0xffffff,
      hollow: false,
      mark: this.showMarks ? (this.colorMark[color] ?? null) : null,
    });
  }

  /** On tall canvases the space above the chart shows the star after this one. */
  private drawNextBadge(): void {
    const g = this.nextBadge;
    g.clear();
    this.nextText.visible = false;
    const state = this.state;
    const top = this.cy - this.R;
    const size = this.starSize();
    if (!state || top < size * 4 || !this.interactive || state.finished) return;
    const cfg = state.config;
    const x = this.cx;
    const y = top * 0.55;
    const color = navigationColorOf(cfg, state.next.kind);
    g.roundRect(x - size * 2.2, y - size * 1.5, size * 4.4, size * 3, size * 0.6).fill({ color: COLORS.skyEdge, alpha: 0.7 });
    g.roundRect(x - size * 2.2, y - size * 1.5, size * 4.4, size * 3, size * 0.6).stroke({ width: 1, color: COLORS.brass, alpha: 0.5 });
    paintStar(g, x, y, size * 0.95, {
      shape: this.shapeName[navigationShapeOf(cfg, state.next.kind)] ?? "star",
      color: this.colorHex[color] ?? 0xffffff,
      hollow: false,
      mark: this.showMarks ? (this.colorMark[color] ?? null) : null,
    });
    this.nextText.visible = true;
    this.nextText.style.fontSize = Math.max(10, size * 0.55);
    this.nextText.position.set(x, y - size * 1.7);
  }

  private popup(x: number, y: number, text: string, color: number): void {
    const t = new Text({
      text,
      style: { fontFamily: "Fraunces, Georgia, serif", fontSize: Math.max(12, this.R * 0.09), fontWeight: "700", fill: color, stroke: { color: 0x000000, width: 3 } },
    });
    t.anchor.set(0.5);
    t.position.set(x, y);
    this.fxLayer.addChild(t);
    this.popups.push({ t, life: 0, max: this.reduced ? 300 : 800, y0: y });
  }

  private callout(text: string, color: number): void {
    const t = new Text({
      text,
      style: { fontFamily: "Fraunces, Georgia, serif", fontSize: Math.max(16, this.R * 0.13), fontWeight: "900", fill: color, stroke: { color: 0x000000, width: 4 }, letterSpacing: 1, align: "center" },
    });
    t.anchor.set(0.5);
    t.position.set(0, -this.R * 0.3);
    this.fxLayer.addChild(t);
    this.popups.push({ t, life: 0, max: this.reduced ? 400 : 1000, y0: t.y });
  }

  // ---- per frame

  private tick(dt: number): void {
    this.time += dt;
    while (this.pending.length && this.pending[0]!.at <= this.time) this.pending.shift()!.run();
    let busy = this.pending.length > 0;
    const k = this.reduced ? 1 : Math.min(1, dt / SPIN_MS);
    for (let r = 0; r < this.rings; r++) {
      const spin = this.ringSpin[r]!;
      if (spin === 0) continue;
      const next = Math.abs(spin) < 0.002 ? 0 : spin * (1 - k) ** 1.6;
      this.ringSpin[r] = next;
      this.ringLayers[r]!.rotation = next;
      if (next !== 0) busy = true;
    }
    const speed = this.reduced ? 1 : Math.min(1, dt / LAND_MS) * 1.6;
    for (const v of [...this.stars.values()]) {
      if (v.dying !== null) {
        v.dying += dt;
        const q = Math.min(1, v.dying / DIE_MS);
        v.g.alpha = 1 - q;
        v.g.scale.set(v.flash ? 1 + q * 0.9 : 1 - q * 0.4);
        if (q >= 1) this.kill(v);
        else busy = true;
        continue;
      }
      if (v.x !== v.tx || v.y !== v.ty) {
        v.x += (v.tx - v.x) * speed;
        v.y += (v.ty - v.y) * speed;
        if (Math.abs(v.tx - v.x) < 0.4 && Math.abs(v.ty - v.y) < 0.4) {
          v.x = v.tx;
          v.y = v.ty;
        } else busy = true;
        v.g.position.set(v.x, v.y);
      }
    }
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i]!;
      p.life += dt;
      const q = p.life / p.max;
      p.t.y = p.y0 - q * this.R * 0.1;
      p.t.alpha = q < 0.7 ? 1 : 1 - (q - 0.7) / 0.3;
      if (q >= 1) {
        p.t.destroy();
        this.popups.splice(i, 1);
      }
    }
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt / 350);
      const s = this.shake * this.R * 0.03;
      this.chart.position.set(this.cx + Math.sin(this.time * 0.09) * s, this.cy + Math.cos(this.time * 0.07) * s);
    }
    if (this.framePending && !busy) {
      this.framePending = false;
      this.cb.onFrame();
    }
    if (this.viewStale && !busy) this.publishView();
  }

  /** Mirrors what the chart shows, for the smoke test: the kind in every slot once settled. */
  private publishView(): void {
    this.viewStale = false;
    const kinds = new Array<number>(this.rings * this.octants).fill(-1);
    for (const v of this.stars.values()) {
      if (v.dying !== null) continue;
      kinds[v.ring * this.octants + v.octant] = v.kind;
    }
    this.app.canvas.setAttribute("data-view", kinds.join(","));
  }

  // ---- input

  private zoneAt(x: number, y: number): { zone: "ring" | "center" | "falling" | null; ring: number | null; angle: number } {
    const dx = x - this.cx;
    const dy = y - this.cy;
    const d = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    const inner = this.R * 0.18;
    const outer = this.R * 0.8;
    if (d < inner) return { zone: "center", ring: null, angle };
    if (d <= outer) return { zone: "ring", ring: Math.min(this.rings - 1, Math.floor((d - inner) / this.bandWidth())), angle };
    if (d <= this.R * 1.08) return { zone: "falling", ring: null, angle };
    return { zone: null, ring: null, angle };
  }

  private pointerDown(e: FederatedPointerEvent): void {
    if (!this.interactive) return;
    const z = this.zoneAt(e.global.x, e.global.y);
    this.drag = { ring: z.ring, zone: z.zone, angle: z.angle, acc: 0, moved: false, x: e.global.x };
  }

  private pointerMove(e: FederatedPointerEvent): void {
    const d = this.drag;
    if (!d || d.zone !== "ring" || d.ring === null) return;
    const z = this.zoneAt(e.global.x, e.global.y);
    let delta = z.angle - d.angle;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    d.angle = z.angle;
    d.acc += delta;
    const step = (Math.PI * 2) / this.octants;
    while (Math.abs(d.acc) >= step * 0.55) {
      const dir: -1 | 1 = d.acc > 0 ? 1 : -1;
      d.acc -= dir * step;
      d.moved = true;
      this.rotate(d.ring, dir);
    }
  }

  private pointerUp(e: FederatedPointerEvent): void {
    const d = this.drag;
    this.drag = null;
    if (!d || !this.interactive) return;
    if (d.zone === "center" || d.zone === "falling") {
      this.drop();
      return;
    }
    if (d.zone === "ring" && d.ring !== null && !d.moved) this.rotate(d.ring, e.global.x >= this.cx ? 1 : -1);
  }

  private pointerCancel(): void {
    this.drag = null;
  }

  private rotate(ring: number, dir: -1 | 1): void {
    if (!this.interactive) return;
    this.selectedRing = ring;
    this.drawHighlight();
    this.cb.onNudge();
    this.cb.onRotate(ring, dir);
  }

  private drop(): void {
    if (!this.interactive) return;
    this.cb.onDrop();
  }

  /** Keyboard: up/down pick a ring (up is outward), left/right turn it, enter or space drops. */
  keyboard(key: string): boolean {
    if (!this.interactive) return false;
    switch (key) {
      case "ArrowUp":
        this.keyboardUsed = true;
        this.selectedRing = Math.min(this.rings - 1, this.selectedRing + 1);
        this.drawHighlight();
        return true;
      case "ArrowDown":
        this.keyboardUsed = true;
        this.selectedRing = Math.max(0, this.selectedRing - 1);
        this.drawHighlight();
        return true;
      case "ArrowLeft":
        this.keyboardUsed = true;
        this.rotate(this.selectedRing, -1);
        return true;
      case "ArrowRight":
        this.keyboardUsed = true;
        this.rotate(this.selectedRing, 1);
        return true;
      case " ":
      case "Enter":
        this.drop();
        return true;
      default:
        return false;
    }
  }
}

/** Slot helper re-exported for the page's progress meter. */
export { navigationSlotOf };
