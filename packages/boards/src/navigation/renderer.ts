import { loadPuzzleSprites, spritesReady } from "../sprites/atlas.js";
import { Application, Container, Graphics, Text, type FederatedPointerEvent } from "pixi.js";
import {
  NAVIGATION_ENTRY_OCTANT,
  navigationColorOf,
  navigationHint,
  navigationLandingSlot,
  navigationOctantOf,
  navigationRingOf,
  navigationShapeOf,
  navigationSlotOf,
  type Completion,
  type Marker,
  type NavigationEvent,
  type NavigationHint,
  type NavigationState,
} from "@openseas/engine";
import type { NavigationContent } from "@openseas/content";
import { paintStar, type StarShapeName } from "./stars.js";

export interface NavigationCallbacks {
  /** The player turned a ring. False when the engine refused it. */
  onRotate(ring: number, dir: -1 | 1): boolean;
  onDrop(): void;
  /** First frame drawn after a new state arrived. */
  onFrame(): void;
  /** Events newer than anything shown before, in order, for sound. */
  onEvents(events: readonly NavigationEvent[]): void;
  onNudge(): void;
}

export interface NavigationRendererOptions {
  showMarks: boolean;
  showMarkers: boolean;
  /** Idle hints, for unrated practice only. */
  hints: boolean;
  tickMs: number;
  labels: {
    charted: string;
    lostHeading: string;
    run: string;
    chain(chain: number): string;
    efficient: string;
    next: string;
    /** Name of a ring for the turn buttons, outermost first. */
    ring(ring: number, rings: number): string;
    drop: string;
  };
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
  /** How it goes: charted stars swell and shine, swept ones shrink. */
  flash: boolean;
  /** ms left on the landing glow. */
  glow: number;
}

interface Popup {
  t: Text;
  life: number;
  max: number;
  y0: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  color: number;
  life: number;
  max: number;
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
  good: 0x6fdc8c,
  select: 0xf2f0e6,
  line: 0x9fb4e0,
};
const SPIN_MS = 170;
const LAND_MS = 220;
const DIE_MS = 300;
/** No input for this long in a hinted round and the chart points at a turn. */
const HINT_IDLE_MS = 1200;

/** What the chart shows, for the smoke test: the kind in every slot. Shared with the page's board host. */
export function navigationViewString(state: NavigationState): string {
  return state.slots.map((s) => s?.kind ?? -1).join(",");
}

export class NavigationRenderer {
  readonly app = new Application();
  private readonly chart = new Container();
  private readonly sky = new Graphics();
  private readonly linesLayer = new Graphics();
  private readonly markerLayer = new Graphics();
  private readonly pulseLayer = new Graphics();
  private readonly highlight = new Graphics();
  private readonly ringLayers: Container[] = [];
  private readonly ringSpin: number[] = [];
  private readonly path = new Graphics();
  private readonly fallingLayer = new Graphics();
  private readonly hintLayer = new Graphics();
  private readonly fxG = new Graphics();
  private readonly nextBadge = new Graphics();
  private readonly nextText = new Text({ text: "", style: { fontFamily: "Atkinson Hyperlegible, sans-serif", fontSize: 11, fontWeight: "700", fill: 0xc9bb9a, letterSpacing: 2 } });
  private readonly fxLayer = new Container();
  private readonly controlsG = new Graphics();
  private readonly controlsLayer = new Container();
  private readonly controlTexts: Text[] = [];
  /** Turn and drop buttons under the chart on tall screens; empty when there is no room. */
  private buttons: Array<{ x: number; y: number; w: number; h: number; ring: number | null; dir: -1 | 1 | 0; pressed: number }> = [];
  /** Height the controls take at the bottom of the canvas, 0 when hidden. */
  private controlsH = 0;
  private readonly stars = new Map<number, StarView>();
  private readonly popups: Popup[] = [];
  private readonly particles: Particle[] = [];
  private readonly pending: Pending[] = [];
  private readonly colorHex: number[] = [];
  private readonly colorMark: string[] = [];
  private readonly shapeName: StarShapeName[] = [];
  private readonly reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  private showMarks: boolean;
  private showMarkers: boolean;
  private hints: boolean;
  private rings: number;
  private octants: number;
  private cx = 0;
  private cy = 0;
  private R = 100;
  /** Room above the chart for the falling star to come out of. */
  private skyGap = 0;
  private time = 0;
  private state: NavigationState | null = null;
  private lastSeq = 0;
  /** When the shown tick last changed, for smoothing the fall between ticks. */
  private tickAt = 0;
  private shownMarkers: readonly Marker[] = [];
  private interactive = false;
  private framePending = false;
  private viewStale = true;
  private destroyed = false;
  private selectedRing = 1;
  private keyboardUsed = false;
  /** ms left showing which ring a button turned. */
  private ringFlash = 0;
  private shake = 0;
  /** ms left on the constellation-line flash, and the markers it lights. */
  private lineFlash = 0;
  private lineFlashMarkers: readonly Marker[] = [];
  private fallY: number | null = null;
  private lastInputAt = 0;
  private hint: NavigationHint | null = null;
  private hintFor: NavigationState | null = null;
  private drag: { ring: number | null; zone: "ring" | "center" | "sky" | null; angle: number; acc: number; moved: boolean; x: number } | null = null;

  constructor(
    private readonly host: HTMLElement,
    content: NavigationContent,
    private readonly cb: NavigationCallbacks,
    private readonly opts: NavigationRendererOptions,
  ) {
    this.showMarks = opts.showMarks;
    this.showMarkers = opts.showMarkers;
    this.hints = opts.hints;
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
    await loadPuzzleSprites("navigation");
    if (this.destroyed) return;
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
    this.app.canvas.dataset.spriteAtlas = spritesReady("navigation") ? "navigation" : "fallback";
    this.app.canvas.style.touchAction = "none";
    this.app.canvas.setAttribute("data-testid", "navigation-canvas");
    this.app.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    this.host.appendChild(this.app.canvas);
    this.chart.addChild(this.sky, this.linesLayer, this.highlight, this.markerLayer, this.pulseLayer);
    for (let r = 0; r < this.rings; r++) {
      const c = new Container();
      this.ringLayers.push(c);
      this.ringSpin.push(0);
      this.chart.addChild(c);
    }
    this.chart.addChild(this.path, this.hintLayer, this.fallingLayer, this.fxG, this.fxLayer);
    this.nextText.anchor.set(0.5, 1);
    this.nextText.text = this.opts.labels.next.toUpperCase();
    this.controlsLayer.addChild(this.controlsG);
    this.app.stage.addChild(this.chart, this.nextBadge, this.nextText, this.controlsLayer);
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
    this.lastInputAt = this.time;
    this.drawHighlight();
    this.drawNextBadge();
    this.drawControls();
  }

  setShowMarks(on: boolean): void {
    if (this.showMarks === on) return;
    this.showMarks = on;
    this.repaintStars();
    this.drawMarkers();
    this.drawNextBadge();
  }

  setShowMarkers(on: boolean): void {
    if (this.showMarkers === on) return;
    this.showMarkers = on;
    this.drawMarkers();
    this.drawLines();
  }

  setHints(on: boolean): void {
    this.hints = on;
    this.hint = null;
    this.hintFor = null;
    this.hintLayer.clear();
  }

  /** A new displayed state, usually one tick on. Plays back whatever happened since the last one. */
  setState(state: NavigationState): void {
    if (!this.app.renderer) return;
    const prev = this.state;
    const fresh = state.tick === 0 && state.eventSeq === 0 && state.logLength === 0;
    const reset = !prev || fresh || state.eventSeq < prev.eventSeq || state.nextId < prev.nextId;
    if (!prev || state.tick !== prev.tick) this.tickAt = this.time;
    this.state = state;
    this.framePending = true;
    this.viewStale = true;
    if (reset) {
      this.flushPending();
      for (const v of this.stars.values()) v.g.destroy();
      this.stars.clear();
      this.lastSeq = state.eventSeq;
      this.shownMarkers = state.markers;
      this.fallY = null;
      this.lineFlash = 0;
      this.hint = null;
      this.hintFor = null;
      this.place(state, true);
      this.drawMarkers();
      this.drawLines();
      this.drawNextBadge();
      return;
    }
    const events = (state.lastMove?.events ?? []).filter((e) => e.seq > this.lastSeq);
    if (events.length) {
      this.lastSeq = events[events.length - 1]!.seq;
      let delay = 0;
      for (const e of events) {
        switch (e.type) {
          case "land": {
            const ring = navigationRingOf(state.config, e.slot);
            const octant = navigationOctantOf(state.config, e.slot);
            const v = this.spawnStar(e.id, e.kind, ring, octant);
            // Start where the falling star was last drawn, on the entry spoke.
            v.x = 0;
            v.y = this.fallY ?? -this.R;
            v.g.position.set(v.x, v.y);
            v.glow = e.onMarker ? 900 : 350;
            if (e.onMarker) this.burst(0, -this.ringRadius(ring), this.colorHex[navigationColorOf(state.config, e.kind)] ?? 0xffffff, 8, 0.7);
            this.fallY = null;
            delay = Math.max(delay, this.reduced ? 60 : LAND_MS);
            break;
          }
          case "lost_heading": {
            for (const id of e.ids) {
              const v = this.stars.get(id);
              if (v) {
                v.dying = 0;
                v.flash = false;
              }
            }
            this.shake = 1;
            this.fallY = null;
            this.callout(this.opts.labels.lostHeading, COLORS.danger);
            this.popup(0, -this.ringRadius(this.rings - 1), `-${e.penalty}`, COLORS.danger);
            this.burst(0, -this.ringRadius(1), COLORS.danger, 14, 1.1);
            break;
          }
          case "charted": {
            const c = e.completion;
            this.pending.push({
              at: this.time + delay,
              run: () => this.playCharted(c),
            });
            delay += this.reduced ? 80 : 360;
            break;
          }
          case "run": {
            const run = e.run;
            this.pending.push({
              at: this.time + delay,
              run: () => {
                let sx = 0;
                let sy = 0;
                for (const id of run.ids) {
                  const v = this.stars.get(id);
                  if (!v) continue;
                  v.dying = 0;
                  v.flash = true;
                  sx += v.tx;
                  sy += v.ty;
                  this.burst(v.tx, v.ty, this.colorHex[run.kind % this.colorHex.length] ?? 0xffffff, 5, 0.5);
                }
                const n = Math.max(1, run.ids.length);
                this.popup(sx / n, sy / n, `${this.opts.labels.run} +${run.points}`, COLORS.good, 0.8);
              },
            });
            delay += this.reduced ? 40 : 160;
            break;
          }
        }
      }
      this.cb.onEvents(events);
      this.pending.push({
        at: this.time + delay,
        run: () => {
          this.shownMarkers = state.markers;
          this.drawMarkers();
          this.drawLines();
          this.place(state, false);
        },
      });
      this.place(state, false, true);
    } else {
      // Nothing happened: the rings may have turned, so stars glide to their slots.
      this.place(state, false, this.pending.length > 0);
      if (!this.pending.length) {
        this.shownMarkers = state.markers;
        this.drawLines();
      }
    }
    this.drawNextBadge();
  }

  private playCharted(c: Completion): void {
    const cfg = this.state?.config;
    for (const id of c.ids) {
      const v = this.stars.get(id);
      if (v) {
        v.flash = true;
        v.dying = 0;
        this.burst(v.tx, v.ty, COLORS.brassLight, 10, 1);
      }
    }
    this.lineFlash = this.reduced ? 300 : 900;
    this.lineFlashMarkers = c.markers;
    this.callout(this.opts.labels.charted + (c.chain >= 2 ? ` ${this.opts.labels.chain(c.chain)}` : ""), COLORS.brassLight);
    this.popup(0, -this.R * 0.08, `+${c.points}`, COLORS.brass);
    if (c.efficient) this.popup(0, this.R * 0.14, this.opts.labels.efficient, COLORS.select, 0.8);
    if (cfg && c.chain >= 3) this.shake = Math.max(this.shake, 0.4);
  }

  private flushPending(): void {
    while (this.pending.length) this.pending.shift()!.run();
    for (const v of [...this.stars.values()]) {
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
    if (!keepGone) {
      for (const [id, v] of this.stars) {
        if (!seen.has(id) && v.dying === null) {
          v.dying = 0;
          v.flash = false;
        }
      }
    }
  }

  private spawnStar(id: number, kind: number, ring: number, octant: number): StarView {
    const old = this.stars.get(id);
    if (old) return old;
    const g = new Graphics();
    const a = this.angleOf(octant);
    const rad = this.ringRadius(ring);
    const v: StarView = { g, kind, ring, octant, x: Math.cos(a) * rad, y: Math.sin(a) * rad, tx: Math.cos(a) * rad, ty: Math.sin(a) * rad, dying: null, flash: false, glow: 0 };
    g.position.set(v.x, v.y);
    this.paintStarView(v);
    this.ringLayers[ring]!.addChild(g);
    this.stars.set(id, v);
    return v;
  }

  private paintStarView(v: StarView): void {
    const colors = this.state?.config.colors ?? this.colorHex.length;
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

  /** Octant 0 is centered at the top, where stars enter. */
  private angleOf(octant: number): number {
    return -Math.PI / 2 + (octant * Math.PI * 2) / this.octants;
  }
  private innerRadius(): number {
    return this.R * 0.15;
  }
  private outerRadius(): number {
    return this.R * 0.94;
  }
  private bandWidth(): number {
    return (this.outerRadius() - this.innerRadius()) / this.rings;
  }
  private ringRadius(ring: number): number {
    return this.innerRadius() + (ring + 0.5) * this.bandWidth();
  }
  private starSize(): number {
    return Math.min(this.bandWidth() * 0.36, ((this.ringRadius(0) * Math.PI * 2) / this.octants) * 0.34);
  }
  /** Where the falling star starts, in chart space. */
  private skyY(): number {
    return -(this.R + Math.max(this.starSize() * 1.2, this.skyGap * 0.6));
  }

  private layout(): void {
    if (!this.app.renderer) return;
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const maxR = Math.max(40, Math.min(w, h) / 2 - 6);
    // On a tall screen the chart is as wide as the canvas, and the height left over goes to sky
    // above it and, when there is enough, a row of turn buttons per ring and a drop button below.
    const rowH = Math.max(44, Math.min(60, w * 0.13));
    const wantControls = rowH * (this.rings + 1) + 12;
    let controlsH = 0;
    if (h - wantControls - 12 >= 2 * maxR * 0.86 + maxR * 0.25) controlsH = wantControls;
    let R = Math.min(maxR, (h - controlsH - 12) / 2.25);
    if (h < w && h - 2 * R - 12 <= 0) R = Math.max(40, h / 2 - 6 - h * 0.08);
    this.controlsH = controlsH;
    this.R = R;
    const spare = h - controlsH - 2 * R - 12;
    this.skyGap = spare > 0 ? Math.min(spare, R * 0.45) : h < w ? h * 0.16 : 0;
    this.cx = w / 2;
    this.cy = 6 + this.skyGap + R + Math.max(0, spare - this.skyGap) / 2;
    this.chart.position.set(this.cx, this.cy);
    // Where the chart sits on the canvas, for tests that tap it.
    this.app.canvas.setAttribute("data-geom", `${Math.round(this.cx)},${Math.round(this.cy)},${Math.round(R)}`);
    this.layoutControls(w, h, rowH);
    this.drawSky();
    this.drawMarkers();
    this.drawLines();
    this.drawHighlight();
    for (const v of this.stars.values()) {
      const a = this.angleOf(v.octant);
      const rad = this.ringRadius(v.ring);
      v.tx = v.x = Math.cos(a) * rad;
      v.ty = v.y = Math.sin(a) * rad;
      v.g.position.set(v.x, v.y);
    }
    this.repaintStars();
    this.drawNextBadge();
  }

  /** One row per ring, outermost at the top like the chart, each with a turn button either side; a drop button last. */
  private layoutControls(w: number, h: number, rowH: number): void {
    this.buttons = [];
    for (const t of this.controlTexts) t.destroy();
    this.controlTexts.length = 0;
    this.controlsLayer.visible = this.controlsH > 0;
    if (this.controlsH === 0) {
      this.controlsG.clear();
      return;
    }
    const top = h - this.controlsH + 6;
    const pad = Math.max(10, w * 0.04);
    const btn = rowH - 8;
    const labelStyle = { fontFamily: "Atkinson Hyperlegible, sans-serif", fontSize: Math.max(12, rowH * 0.3), fontWeight: "700" as const, fill: 0xc9bb9a, letterSpacing: 1.5 };
    for (let i = 0; i < this.rings; i++) {
      const ring = this.rings - 1 - i;
      const y = top + i * rowH + rowH / 2;
      this.buttons.push({ x: pad, y: y - btn / 2, w: btn * 1.6, h: btn, ring, dir: -1, pressed: 0 });
      this.buttons.push({ x: w - pad - btn * 1.6, y: y - btn / 2, w: btn * 1.6, h: btn, ring, dir: 1, pressed: 0 });
      const t = new Text({ text: this.opts.labels.ring(ring, this.rings).toUpperCase(), style: labelStyle });
      t.anchor.set(0.5);
      t.position.set(w / 2, y);
      this.controlsLayer.addChild(t);
      this.controlTexts.push(t);
    }
    const dy = top + this.rings * rowH + rowH / 2;
    this.buttons.push({ x: pad, y: dy - btn / 2, w: w - pad * 2, h: btn, ring: null, dir: 0, pressed: 0 });
    const d = new Text({ text: this.opts.labels.drop.toUpperCase(), style: { ...labelStyle, fill: 0x0b1526 } });
    d.anchor.set(0.5);
    d.position.set(w / 2, dy);
    this.controlsLayer.addChild(d);
    this.controlTexts.push(d);
    this.drawControls();
  }

  private drawControls(): void {
    const g = this.controlsG;
    g.clear();
    if (this.controlsH === 0) return;
    for (const b of this.buttons) {
      const press = b.pressed > 0 ? b.pressed / 160 : 0;
      const r = b.h * 0.3;
      if (b.dir === 0) {
        g.roundRect(b.x, b.y, b.w, b.h, r).fill({ color: press ? COLORS.brassLight : COLORS.brass, alpha: this.interactive ? 0.95 : 0.4 });
        continue;
      }
      g.roundRect(b.x, b.y, b.w, b.h, r).fill({ color: COLORS.skyEdge, alpha: this.interactive ? 0.9 : 0.4 });
      g.roundRect(b.x, b.y, b.w, b.h, r).stroke({ width: 1.5, color: press ? COLORS.select : COLORS.brass, alpha: 0.5 + 0.5 * press });
      // A curved arrow: an arc with a head, bending the way the ring will turn.
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      const ar = b.h * 0.26;
      const sweep = b.dir === 1 ? [Math.PI * 1.15, Math.PI * 1.85] : [Math.PI * 1.85, Math.PI * 1.15];
      const sx = cx + Math.cos(sweep[0]!) * ar;
      const sy = cy + ar * 0.35 + Math.sin(sweep[0]!) * ar;
      g.moveTo(sx, sy)
        .arc(cx, cy + ar * 0.35, ar, sweep[0]!, sweep[1]!, b.dir === -1)
        .stroke({ width: Math.max(2.5, b.h * 0.08), color: press ? COLORS.select : COLORS.brassLight, alpha: 0.95, cap: "round" });
      const ex = cx + Math.cos(sweep[1]!) * ar;
      const ey = cy + ar * 0.35 + Math.sin(sweep[1]!) * ar;
      const hd = b.h * 0.14;
      const dirx = b.dir === 1 ? 1 : -1;
      g.poly([ex + dirx * hd * 0.2, ey + hd * 0.9, ex - dirx * hd * 1.1, ey - hd * 0.15, ex + dirx * hd * 0.7, ey - hd * 0.6]).fill({ color: press ? COLORS.select : COLORS.brassLight, alpha: 0.95 });
    }
  }

  private drawSky(): void {
    const g = this.sky;
    const R = this.R;
    g.clear();
    g.circle(0, 0, R).fill({ color: COLORS.sky });
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
    const inner = this.innerRadius();
    const bw = this.bandWidth();
    for (let r = 0; r < this.rings; r++) {
      const r0 = inner + r * bw;
      const r1 = r0 + bw;
      g.circle(0, 0, r1).fill({ color: r % 2 === 0 ? COLORS.ring : COLORS.skyEdge, alpha: 0.35 });
      g.circle(0, 0, r0).fill({ color: COLORS.sky, alpha: 1 });
      g.circle(0, 0, r1).stroke({ width: 1.2, color: COLORS.ringLine, alpha: 0.6 });
    }
    g.circle(0, 0, inner).stroke({ width: 1.2, color: COLORS.ringLine, alpha: 0.6 });
    // The entry lane: the top octant, a shade lighter, so the column stars fall into reads at a glance.
    const half = Math.PI / this.octants;
    const outer = this.outerRadius();
    const a0 = this.angleOf(0) - half;
    const a1 = this.angleOf(0) + half;
    g.moveTo(Math.cos(a0) * inner, Math.sin(a0) * inner).arc(0, 0, outer, a0, a1).lineTo(Math.cos(a1) * inner, Math.sin(a1) * inner).arc(0, 0, inner, a1, a0, true).fill({ color: COLORS.line, alpha: 0.09 });
    // Octant spokes, between octants, from the hole to the rim.
    for (let o = 0; o < this.octants; o++) {
      const a = this.angleOf(o) + half;
      g.moveTo(Math.cos(a) * inner, Math.sin(a) * inner).lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
    }
    g.stroke({ width: 1, color: COLORS.ringLine, alpha: 0.35 });
    // The entry: a brass notch in the rim at the top where stars come in.
    const notch = this.starSize() * 1.6;
    g.moveTo(-notch, -R - 1).lineTo(0, -R + notch * 0.8).lineTo(notch, -R - 1).stroke({ width: 2, color: COLORS.brass, alpha: 0.7 });
    g.circle(0, 0, R).stroke({ width: 3, color: COLORS.brass, alpha: 0.8 });
    // A compass rose in the hole.
    g.circle(0, 0, inner * 0.7).fill({ color: COLORS.skyEdge, alpha: 0.9 });
    g.circle(0, 0, inner * 0.7).stroke({ width: 1.5, color: COLORS.brass, alpha: 0.7 });
    for (let i = 0; i < 4; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 2;
      g.poly([Math.cos(a) * inner * 0.62, Math.sin(a) * inner * 0.62, Math.cos(a + 0.5) * inner * 0.15, Math.sin(a + 0.5) * inner * 0.15, Math.cos(a - 0.5) * inner * 0.15, Math.sin(a - 0.5) * inner * 0.15]).fill({ color: COLORS.brass, alpha: 0.8 });
    }
  }

  private markerPos(m: Marker): { x: number; y: number } {
    const a = this.angleOf(m.octant);
    const rad = this.ringRadius(m.ring);
    return { x: Math.cos(a) * rad, y: Math.sin(a) * rad };
  }

  private markerHeld(m: Marker): boolean {
    const s = this.state;
    if (!s) return false;
    return s.slots[navigationSlotOf(s.config, m.ring, m.octant)]?.kind === m.kind;
  }

  private drawMarkers(): void {
    const g = this.markerLayer;
    g.clear();
    if (!this.showMarkers || !this.state) return;
    const cfg = this.state.config;
    for (const m of this.shownMarkers) {
      const p = this.markerPos(m);
      const color = navigationColorOf(cfg, m.kind);
      paintStar(g, p.x, p.y, this.starSize() * 1.18, {
        shape: this.shapeName[navigationShapeOf(cfg, m.kind)] ?? "star",
        color: this.colorHex[color] ?? 0xffffff,
        hollow: true,
        mark: this.showMarks ? (this.colorMark[color] ?? null) : null,
      });
    }
  }

  /** The constellation's figure: faint lines joining its markers in order around the chart, bright where both ends hold. */
  private drawLines(): void {
    const g = this.linesLayer;
    g.clear();
    if (!this.showMarkers || !this.state || this.shownMarkers.length < 2) return;
    const ms = [...this.shownMarkers].sort((a, b) => a.octant - b.octant || a.ring - b.ring);
    for (let i = 0; i < ms.length - 1; i++) {
      const a = ms[i]!;
      const b = ms[i + 1]!;
      const pa = this.markerPos(a);
      const pb = this.markerPos(b);
      const lit = this.markerHeld(a) && this.markerHeld(b);
      g.moveTo(pa.x, pa.y).lineTo(pb.x, pb.y).stroke({ width: lit ? 2 : 1.2, color: lit ? COLORS.brassLight : COLORS.line, alpha: lit ? 0.75 : 0.28 });
    }
  }

  private drawHighlight(): void {
    const g = this.highlight;
    g.clear();
    if ((!this.keyboardUsed && this.ringFlash <= 0) || !this.interactive) return;
    const alpha = this.keyboardUsed ? 0.7 : 0.7 * Math.min(1, this.ringFlash / 300);
    const r0 = this.innerRadius() + this.selectedRing * this.bandWidth();
    g.circle(0, 0, r0 + this.bandWidth()).stroke({ width: 2.5, color: COLORS.select, alpha });
    g.circle(0, 0, r0).stroke({ width: 2.5, color: COLORS.select, alpha });
  }

  /** The star on its way down the entry spoke, the path ahead of it and the ring where it will rest. */
  private drawFalling(): void {
    const g = this.fallingLayer;
    const p = this.path;
    const pulse = this.pulseLayer;
    g.clear();
    p.clear();
    pulse.clear();
    const state = this.state;
    if (!state || !this.interactive || state.finished) {
      this.fallY = null;
      return;
    }
    const cfg = state.config;
    const f = state.falling;
    const span = Math.max(1, f.landTick - f.startTick);
    const frac = this.reduced ? 0 : Math.min(1, (this.time - this.tickAt) / this.opts.tickMs);
    const k = Math.max(0, Math.min(1, (state.tick + frac - f.startTick) / span));
    const landing = navigationLandingSlot(state);
    const blocked = landing === null;
    const endY = blocked ? -this.ringRadius(this.rings - 1) - this.bandWidth() * 0.5 : -this.ringRadius(navigationRingOf(cfg, landing));
    const startY = this.skyY();
    // Ease in, so the star drifts out of the sky and hurries toward the chart.
    const y = startY + (endY - startY) * (k * k * 0.6 + k * 0.4);
    this.fallY = y;
    const size = this.starSize();
    const color = navigationColorOf(cfg, f.kind);
    // Dotted path from the star to where it rests.
    const dots = 6;
    for (let i = 1; i <= dots; i++) {
      const d = y + ((endY - y) * i) / (dots + 1);
      p.circle(0, d, Math.max(1.2, size * 0.12)).fill({ color: blocked ? COLORS.danger : 0xffffff, alpha: 0.4 });
    }
    const onMarker = !blocked && state.markers.some((m) => navigationSlotOf(cfg, m.ring, m.octant) === landing && m.kind === f.kind);
    const beat = 0.5 + 0.5 * Math.sin(this.time * 0.012);
    if (blocked) {
      const d = this.ringRadius(this.rings - 1);
      const s = size * 0.6;
      p.moveTo(-s, -d - s).lineTo(s, -d + s).moveTo(s, -d - s).lineTo(-s, -d + s).stroke({ width: 3, color: COLORS.danger, alpha: 0.85, cap: "round" });
      // The whole outer band pulses red: the column is shut.
      p.circle(0, 0, this.innerRadius() + this.rings * this.bandWidth()).stroke({ width: 3, color: COLORS.danger, alpha: 0.25 + 0.35 * beat });
    } else {
      const d = this.ringRadius(navigationRingOf(cfg, landing));
      g.circle(0, -d, size * (1.15 + 0.1 * beat)).stroke({ width: onMarker ? 2.5 : 1.5, color: onMarker ? COLORS.brassLight : 0xffffff, alpha: onMarker ? 0.6 + 0.4 * beat : 0.35 });
    }
    // Markers wanting this kind beckon.
    if (this.showMarkers) {
      for (const m of state.markers) {
        if (m.kind !== f.kind || this.markerHeld(m)) continue;
        const mp = this.markerPos(m);
        pulse.circle(mp.x, mp.y, size * (1.5 + 0.25 * beat)).stroke({ width: 1.5, color: this.colorHex[color] ?? 0xffffff, alpha: 0.15 + 0.3 * beat });
      }
    }
    // A short trail behind the star.
    for (let i = 1; i <= 3; i++) {
      g.circle(0, y - i * size * 0.55, size * (0.5 - i * 0.12)).fill({ color: this.colorHex[color] ?? 0xffffff, alpha: 0.25 - i * 0.06 });
    }
    paintStar(g, 0, y, size * 1.05, {
      shape: this.shapeName[navigationShapeOf(cfg, f.kind)] ?? "star",
      color: this.colorHex[color] ?? 0xffffff,
      hollow: false,
      mark: this.showMarks ? (this.colorMark[color] ?? null) : null,
    });
  }

  /** In the sky beside the entry: the star after this one. */
  private drawNextBadge(): void {
    const g = this.nextBadge;
    g.clear();
    this.nextText.visible = false;
    const state = this.state;
    const size = this.starSize();
    if (!state || !this.interactive || state.finished) return;
    const cfg = state.config;
    const room = this.cy - this.R;
    const x = this.cx + this.R * 0.55;
    const y = room > size * 4 ? room * 0.5 : this.cy - this.R * 0.78;
    const color = navigationColorOf(cfg, state.next);
    g.roundRect(x - size * 2.2, y - size * 1.5, size * 4.4, size * 3, size * 0.6).fill({ color: COLORS.skyEdge, alpha: 0.75 });
    g.roundRect(x - size * 2.2, y - size * 1.5, size * 4.4, size * 3, size * 0.6).stroke({ width: 1, color: COLORS.brass, alpha: 0.5 });
    paintStar(g, x, y, size * 0.9, {
      shape: this.shapeName[navigationShapeOf(cfg, state.next)] ?? "star",
      color: this.colorHex[color] ?? 0xffffff,
      hollow: false,
      mark: this.showMarks ? (this.colorMark[color] ?? null) : null,
    });
    if (room > size * 4) {
      this.nextText.visible = true;
      this.nextText.style.fontSize = Math.max(10, size * 0.55);
      this.nextText.position.set(x, y - size * 1.7);
    }
  }

  /** After a quiet spell in a hinted round, chevrons on the ring to turn, pointing the way. */
  private drawHint(): void {
    const g = this.hintLayer;
    const state = this.state;
    if (!this.hints || !this.interactive || !state || state.finished || this.time - this.lastInputAt < HINT_IDLE_MS) {
      if (this.hint) g.clear();
      this.hint = null;
      return;
    }
    if (this.hintFor !== state) {
      this.hintFor = state;
      this.hint = navigationHint(state);
      g.clear();
    }
    const h = this.hint;
    g.clear();
    if (!h) return;
    const rad = this.ringRadius(h.ring);
    const size = this.starSize() * 0.6;
    const beat = 0.5 + 0.5 * Math.sin(this.time * 0.01);
    for (let i = 0; i < 4; i++) {
      const a = i * (Math.PI / 2) + Math.PI / 4;
      const x = Math.cos(a) * rad;
      const y = Math.sin(a) * rad;
      // Tangent in the direction of travel: clockwise on screen is +dir.
      const tx = -Math.sin(a) * h.dir;
      const ty = Math.cos(a) * h.dir;
      const nx = -ty;
      const ny = tx;
      g.moveTo(x - tx * size + nx * size * 0.7, y - ty * size + ny * size * 0.7)
        .lineTo(x + tx * size * 0.4, y + ty * size * 0.4)
        .lineTo(x - tx * size - nx * size * 0.7, y - ty * size - ny * size * 0.7)
        .stroke({ width: 3, color: COLORS.select, alpha: 0.35 + 0.5 * beat, cap: "round", join: "round" });
    }
  }

  private popup(x: number, y: number, text: string, color: number, scale = 1): void {
    const t = new Text({
      text,
      style: { fontFamily: "Fraunces, Georgia, serif", fontSize: Math.max(12, this.R * 0.09 * scale), fontWeight: "700", fill: color, stroke: { color: 0x000000, width: 3 } },
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

  private burst(x: number, y: number, color: number, n: number, power: number): void {
    if (this.reduced) return;
    const s = this.starSize();
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (0.03 + Math.random() * 0.07) * power * (s / 10);
      this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: s * (0.12 + Math.random() * 0.1), color, life: 0, max: 380 + Math.random() * 260 });
    }
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
    const speed = this.reduced ? 1 : Math.min(1, dt / LAND_MS) * 1.7;
    for (const v of [...this.stars.values()]) {
      if (v.dying !== null) {
        v.dying += dt;
        const q = Math.min(1, v.dying / DIE_MS);
        v.g.alpha = 1 - q;
        v.g.scale.set(v.flash ? 1 + q * 1.1 : 1 - q * 0.5);
        if (q >= 1) this.kill(v);
        else busy = true;
        continue;
      }
      if (v.glow > 0) {
        v.glow = Math.max(0, v.glow - dt);
        const q = v.glow / 900;
        v.g.scale.set(1 + 0.25 * q * (0.5 + 0.5 * Math.sin(this.time * 0.02)));
        if (v.glow === 0) v.g.scale.set(1);
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
    const fx = this.fxG;
    fx.clear();
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.life += dt;
      if (p.life >= p.max) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.985;
      p.vy *= 0.985;
      const q = 1 - p.life / p.max;
      fx.circle(p.x, p.y, p.r * q).fill({ color: p.color, alpha: 0.9 * q });
    }
    if (this.lineFlash > 0) {
      this.lineFlash = Math.max(0, this.lineFlash - dt);
      const q = this.lineFlash / 900;
      const ms = [...this.lineFlashMarkers].sort((a, b) => a.octant - b.octant || a.ring - b.ring);
      for (let i = 0; i < ms.length - 1; i++) {
        const pa = this.markerPos(ms[i]!);
        const pb = this.markerPos(ms[i + 1]!);
        fx.moveTo(pa.x, pa.y).lineTo(pb.x, pb.y).stroke({ width: 3 + 4 * q, color: COLORS.brassLight, alpha: 0.9 * q });
      }
      for (const m of ms) {
        const p = this.markerPos(m);
        fx.circle(p.x, p.y, this.starSize() * (1.4 + 1.5 * (1 - q))).stroke({ width: 2, color: COLORS.brassLight, alpha: 0.7 * q });
      }
    }
    let pressing = false;
    for (const b of this.buttons) {
      if (b.pressed > 0) {
        b.pressed = Math.max(0, b.pressed - dt);
        pressing = true;
      }
    }
    if (pressing) this.drawControls();
    if (this.ringFlash > 0) {
      this.ringFlash = Math.max(0, this.ringFlash - dt);
      this.drawHighlight();
    }
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt / 350);
      const s = this.shake * this.R * 0.03;
      this.chart.position.set(this.cx + Math.sin(this.time * 0.09) * s, this.cy + Math.cos(this.time * 0.07) * s);
    } else this.chart.position.set(this.cx, this.cy);
    this.drawFalling();
    this.drawHint();
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

  private zoneAt(x: number, y: number): { zone: "ring" | "center" | "sky" | null; ring: number | null; angle: number } {
    const dx = x - this.cx;
    const dy = y - this.cy;
    const d = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    const inner = this.innerRadius();
    const outer = this.outerRadius();
    if (d < inner) return { zone: "center", ring: null, angle };
    if (d <= outer) return { zone: "ring", ring: Math.min(this.rings - 1, Math.floor((d - inner) / this.bandWidth())), angle };
    // The rim and everything above the chart is the sky: a tap there brings the star down.
    if (d <= this.R * 1.1 || y < this.cy - this.R * 0.8) return { zone: "sky", ring: null, angle };
    return { zone: null, ring: null, angle };
  }

  private pointerDown(e: FederatedPointerEvent): void {
    if (!this.interactive) return;
    const b = this.buttonAt(e.global.x, e.global.y);
    if (b) {
      b.pressed = 160;
      this.drawControls();
      if (b.dir === 0) this.drop();
      else {
        this.rotate(b.ring!, b.dir);
        this.ringFlash = 600;
        this.drawHighlight();
      }
      this.drag = null;
      return;
    }
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

  private buttonAt(x: number, y: number): (typeof this.buttons)[number] | null {
    if (this.controlsH === 0) return null;
    for (const b of this.buttons) if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
    return null;
  }

  private pointerUp(e: FederatedPointerEvent): void {
    const d = this.drag;
    this.drag = null;
    if (!d || !this.interactive) return;
    if (d.zone === "center" || d.zone === "sky") {
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
    this.lastInputAt = this.time;
    this.selectedRing = ring;
    this.drawHighlight();
    if (!this.cb.onRotate(ring, dir)) return;
    this.cb.onNudge();
    // Turn the ring at once, ahead of the state: the stars shift a slot and the ring swings back into place.
    this.ringSpin[ring] = (this.ringSpin[ring] ?? 0) - dir * ((Math.PI * 2) / this.octants);
    this.ringLayers[ring]!.rotation = this.ringSpin[ring]!;
    for (const v of this.stars.values()) {
      if (v.ring !== ring || v.dying !== null) continue;
      v.octant = (((v.octant + dir) % this.octants) + this.octants) % this.octants;
      const a = this.angleOf(v.octant);
      const rad = this.ringRadius(ring);
      v.tx = v.x = Math.cos(a) * rad;
      v.ty = v.y = Math.sin(a) * rad;
      v.g.position.set(v.x, v.y);
    }
  }

  private drop(): void {
    if (!this.interactive) return;
    this.lastInputAt = this.time;
    this.cb.onDrop();
  }

  /** Keyboard: up/down pick a ring (up is outward), left/right turn it, enter or space brings the star down. */
  keyboard(key: string): boolean {
    if (!this.interactive) return false;
    switch (key) {
      case "ArrowUp":
        this.keyboardUsed = true;
        this.lastInputAt = this.time;
        this.selectedRing = Math.min(this.rings - 1, this.selectedRing + 1);
        this.drawHighlight();
        return true;
      case "ArrowDown":
        this.keyboardUsed = true;
        this.lastInputAt = this.time;
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

export { NAVIGATION_ENTRY_OCTANT };
