import { sfx } from "../audio.js";
import { Application, CanvasSource, Container, Graphics, Sprite, Text, Texture, type FederatedPointerEvent } from "pixi.js";
import {
  NAVIGATION_ENTRY_OCTANT,
  navigationHint,
  navigationLandingSlot,
  navigationOctantOf,
  navigationRingOf,
  navigationSlotOf,
  type Completion,
  type Marker,
  type NavigationEvent,
  type NavigationHint,
  type NavigationState,
} from "@openseas/engine";
import type { NavigationContent, PieceColor } from "@openseas/content";
import { starCanvas, type StarCutName, type StarShapeName } from "./stars.js";
import { boardSurface, retireTextures } from "../surface.js";
import { FONT, MOTION, RADIUS, blend, ink } from "../look/tokens.js";

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
  s: Sprite;
  kind: number;
  ring: number;
  octant: number;
  /** Position inside the ring container. */
  x: number;
  y: number;
  tx: number;
  ty: number;
  /** Where the move under way began, and how far along it is (1 is done). */
  sx: number;
  sy: number;
  move: number;
  /** Ms since this star started clearing, or null while it lives. */
  dying: number | null;
}

interface Popup {
  t: Text;
  life: number;
  max: number;
  y0: number;
  rise: number;
}

interface Pending {
  at: number;
  run(): void;
}

/** Every colour the chart draws, from the game's one palette (docs/BRAND.md section 2). */
const COLORS = {
  ground: ink("ground"),
  raised: ink("raised"),
  line: ink("line"),
  cream: ink("cream"),
  dim: ink("dim"),
  amber: ink("amber"),
  danger: ink("danger"),
  // The rings are flat bands, every other one a shade nearer the ground, so each reads as a thing that turns.
  bandLow: blend("ground", "raised", 0.45),
};
const MOVE_MS = MOTION.move;
const CLEAR_MS = MOTION.clear;
const BEAT_MS = MOTION.beat;
const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
/** No input for this long in a hinted round and the chart points at a turn. */
const HINT_IDLE_MS = 1200;

/** What the chart shows, for the smoke test: the kind in every slot. Shared with the page's board host. */
export function navigationViewString(state: NavigationState): string {
  return state.slots.map((s) => s?.kind ?? -1).join(",");
}

export class NavigationRenderer {
  readonly app = new Application();
  private readonly chart = new Container();
  /** The canvas's ground: painted, not left clear, so the board is whole wherever it is shown. */
  private readonly ground = new Graphics();
  private readonly sky = new Graphics();
  private readonly dots = new Graphics();
  private readonly linesLayer = new Graphics();
  private readonly markerLayer = new Container();
  private readonly pulseLayer = new Graphics();
  private readonly highlight = new Graphics();
  private readonly ringLayers: Container[] = [];
  /** A turning ring: the angle it started from and how far along the turn is (1 is done). */
  private readonly ringSpin: Array<{ from: number; t: number }> = [];
  private readonly path = new Graphics();
  private readonly fallingLayer = new Graphics();
  private readonly fallingStar = new Sprite(Texture.EMPTY);
  private readonly hintLayer = new Graphics();
  private readonly nextBadge = new Graphics();
  private readonly nextStar = new Sprite(Texture.EMPTY);
  private readonly nextText = new Text({ text: "", style: { fontFamily: FONT.body, fontSize: 13, fill: COLORS.dim }, resolution: 2 });
  private readonly fxLayer = new Container();
  private readonly beatLayer = new Graphics();
  /** The beat: one amber pulse of the whole board for a big moment (docs/BRAND.md section 6). */
  private beatNow: { life: number; strength: number } | null = null;
  private readonly controlsG = new Graphics();
  private readonly controlsLayer = new Container();
  private readonly controlTexts: Text[] = [];
  /** Turn and drop buttons under the chart on tall screens; empty when there is no room. */
  private buttons: Array<{ x: number; y: number; w: number; h: number; ring: number | null; dir: -1 | 1 | 0; pressed: number }> = [];
  /** Height the controls take at the bottom of the canvas, 0 when hidden. */
  private controlsH = 0;
  private readonly stars = new Map<number, StarView>();
  private readonly popups: Popup[] = [];
  private readonly pending: Pending[] = [];
  private readonly colorName: PieceColor[] = [];
  private readonly colorCut: StarCutName[] = [];
  private readonly shapeName: StarShapeName[] = [];
  /** Every star and marker baked so far at the current size, by shape, colour and whether it is hollow. */
  private readonly textures = new Map<string, Texture>();
  private readonly reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
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
    this.showMarkers = opts.showMarkers;
    this.hints = opts.hints;
    this.rings = content.config.rings;
    this.octants = content.config.octants;
    for (const c of content.colors) {
      this.colorName.push(c.color);
      this.colorCut.push(c.cut);
    }
    for (const s of content.shapes) this.shapeName.push(s.shape);
    this.selectedRing = Math.min(1, this.rings - 1);
  }

  async init(): Promise<void> {
    // Callouts and labels are drawn as text, so wait (briefly) for the webfont. Before the app
    // exists: the board hands a state to any renderer that has one, and the layers come after.
    await Promise.race([document.fonts?.ready, new Promise((r) => window.setTimeout(r, 800))]).catch(() => undefined);
    if (this.destroyed) return;
    await this.app.init({
      resizeTo: this.host,
      backgroundAlpha: 0,
      ...boardSurface(),
      autoDensity: true,
      preference: "webgl",
    });
    if (this.destroyed) {
      this.app.destroy(true);
      return;
    }
    // No atlas to wait for: the stars are drawn in code (ADR 0062). The studio's thumbnails read this.
    this.app.canvas.dataset.pieces = "drawn";
    this.app.canvas.style.touchAction = "none";
    this.app.canvas.setAttribute("data-testid", "navigation-canvas");
    this.app.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    this.host.appendChild(this.app.canvas);
    this.chart.addChild(this.sky, this.dots, this.linesLayer, this.highlight, this.markerLayer, this.pulseLayer);
    for (let r = 0; r < this.rings; r++) {
      const c = new Container();
      this.ringLayers.push(c);
      this.ringSpin.push({ from: 0, t: 1 });
      this.chart.addChild(c);
    }
    this.fallingStar.anchor.set(0.5);
    this.fallingStar.visible = false;
    this.nextStar.anchor.set(0.5);
    this.nextStar.visible = false;
    this.chart.addChild(this.path, this.hintLayer, this.fallingLayer, this.fallingStar, this.fxLayer);
    this.nextText.anchor.set(0.5, 1);
    this.nextText.text = this.opts.labels.next;
    this.controlsLayer.addChild(this.controlsG);
    this.app.stage.addChild(this.ground, this.chart, this.nextBadge, this.nextStar, this.nextText, this.controlsLayer, this.beatLayer);
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
    if (this.app.renderer) {
      this.app.destroy(true, { children: true });
      for (const tex of this.textures.values()) tex.destroy(true);
    }
  }

  setInteractive(on: boolean): void {
    this.interactive = on;
    if (!on) this.drag = null;
    this.lastInputAt = this.time;
    this.drawHighlight();
    this.drawNextBadge();
    this.drawControls();
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
    this.drawDots();
    if (reset) {
      this.flushPending();
      for (const v of this.stars.values()) v.s.destroy();
      this.stars.clear();
      this.lastSeq = state.eventSeq;
      this.shownMarkers = state.markers;
      this.fallY = null;
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
            this.jump(v, 0, this.fallY ?? -this.R);
            this.fallY = null;
            delay = Math.max(delay, this.reduced ? 60 : MOVE_MS);
            break;
          }
          case "lost_heading": {
            for (const id of e.ids) {
              const v = this.stars.get(id);
              if (v) v.dying = 0;
            }
            this.fallY = null;
            this.callout(this.opts.labels.lostHeading, COLORS.danger);
            this.popup(0, -this.ringRadius(this.rings - 1), `-${e.penalty}`, COLORS.danger);
            break;
          }
          case "charted": {
            const c = e.completion;
            this.pending.push({
              at: this.time + delay,
              run: () => this.playCharted(c),
            });
            delay += this.reduced ? 80 : CLEAR_MS + 140;
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
                  sx += v.tx;
                  sy += v.ty;
                }
                const n = Math.max(1, run.ids.length);
                this.popup(sx / n, sy / n, `${this.opts.labels.run} +${run.points}`, COLORS.cream, 0.8);
              },
            });
            delay += this.reduced ? 40 : CLEAR_MS;
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

  /**
   * A constellation charted: its stars shrink away and its points are named. Swift charting, the
   * puzzle's planned move, and a chain reaching its top are the beat.
   */
  private playCharted(c: Completion): void {
    const cfg = this.state?.config;
    for (const id of c.ids) {
      const v = this.stars.get(id);
      if (v) v.dying = 0;
    }
    this.callout(this.opts.labels.charted + (c.chain >= 2 ? ` ${this.opts.labels.chain(c.chain)}` : ""), COLORS.cream);
    this.popup(0, -this.R * 0.02, `+${c.points}`, COLORS.cream);
    if (c.efficient) this.popup(0, this.R * 0.18, this.opts.labels.efficient, COLORS.cream, 0.8, false);
    const n = Math.max(1, c.markers.length);
    const top = cfg !== undefined && c.chain === cfg.chainPercent.length;
    // A constellation with no landing wasted is the strongest pulse; it is never a second effect.
    if (c.efficient || top) this.beat(0.5 + 0.5 * Math.max(c.efficient ? Math.min(1, c.saved / n) : 0, top ? 0.5 : 0));
  }

  private flushPending(): void {
    while (this.pending.length) this.pending.shift()!.run();
    for (const v of [...this.stars.values()]) {
      this.jump(v, v.tx, v.ty);
      v.move = 1;
      if (v.dying !== null) this.kill(v);
    }
    for (let r = 0; r < this.rings; r++) {
      this.ringSpin[r]!.t = 1;
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
        this.ringLayers[v.ring]!.removeChild(v.s);
        this.ringLayers[ring]!.addChild(v.s);
        v.ring = ring;
      }
      v.octant = octant;
      const a = this.angleOf(octant);
      const rad = this.ringRadius(ring);
      this.aim(v, Math.cos(a) * rad, Math.sin(a) * rad);
      if (snap) {
        this.jump(v, v.tx, v.ty);
        v.move = 1;
      }
    }
    if (!keepGone) {
      for (const [id, v] of this.stars) {
        if (!seen.has(id) && v.dying === null) v.dying = 0;
      }
    }
    this.drawMarkers();
  }

  /** Send a star to a new resting place: it glides there from wherever it is now. */
  private aim(v: StarView, tx: number, ty: number): void {
    if (v.tx === tx && v.ty === ty) return;
    v.tx = tx;
    v.ty = ty;
    v.sx = v.x;
    v.sy = v.y;
    v.move = 0;
  }

  /** Put a star somewhere at once; it glides on to its resting place from there. */
  private jump(v: StarView, x: number, y: number): void {
    v.x = v.sx = x;
    v.y = v.sy = y;
    v.move = 0;
    v.s.position.set(x, y);
  }

  private spawnStar(id: number, kind: number, ring: number, octant: number): StarView {
    const old = this.stars.get(id);
    if (old) return old;
    const s = new Sprite(this.texture(kind, false));
    s.anchor.set(0.5);
    const a = this.angleOf(octant);
    const rad = this.ringRadius(ring);
    const x = Math.cos(a) * rad;
    const y = Math.sin(a) * rad;
    const v: StarView = { s, kind, ring, octant, x, y, tx: x, ty: y, sx: x, sy: y, move: 1, dying: null };
    s.position.set(x, y);
    this.ringLayers[ring]!.addChild(s);
    this.stars.set(id, v);
    return v;
  }

  /** A kind's star, or its hollow marker (bare, or with a star on it), baked at the current size the first time it is asked for. */
  private texture(kind: number, hollow: boolean, covered = false): Texture {
    const colors = this.state?.config.colors ?? this.colorName.length;
    const shape = Math.floor(kind / colors);
    const color = kind % colors;
    const key = `${shape}:${color}:${hollow ? (covered ? 2 : 1) : 0}`;
    let tex = this.textures.get(key);
    if (!tex) {
      const r = this.app.renderer.resolution;
      // A kind past the content's list is a plain cream star: a lab may ask for more than are drawn.
      const look = { shape: this.shapeName[shape] ?? "star", color: this.colorName[color] ?? "cream", cut: this.colorCut[color] ?? null, hollow, covered };
      const canvas = starCanvas(hollow ? this.markerCell() : this.cell(), look, r);
      tex = new Texture({ source: new CanvasSource({ resource: canvas, resolution: r }) });
      this.textures.set(key, tex);
    }
    return tex;
  }

  /** Every star is baked for one size, so a new size bakes them again. Returns the old textures, for the layout to retire once it has redrawn. */
  private rebake(): Texture[] {
    const old = [...this.textures.values()];
    this.textures.clear();
    for (const v of this.stars.values()) v.s.texture = this.texture(v.kind, false);
    return old;
  }

  private kill(v: StarView): void {
    for (const [id, s] of this.stars) if (s === v) this.stars.delete(id);
    v.s.destroy();
    this.drawMarkers();
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
  /** The square a star is drawn in: its pictogram fills 20/24 of it (docs/BRAND.md section 3). */
  private cell(): number {
    return this.starSize() * 2.9;
  }
  /** A marker is drawn a little larger, so its outline shows round the star that fills it. */
  private markerCell(): number {
    return this.cell() * 1.18;
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
    this.ground.clear().rect(0, 0, w, h).fill(COLORS.ground);
    this.layoutControls(w, h, rowH);
    const stale = this.rebake();
    this.drawSky();
    this.drawMarkers();
    this.drawLines();
    this.drawHighlight();
    for (const v of this.stars.values()) {
      const a = this.angleOf(v.octant);
      const rad = this.ringRadius(v.ring);
      v.tx = Math.cos(a) * rad;
      v.ty = Math.sin(a) * rad;
      this.jump(v, v.tx, v.ty);
      v.move = 1;
    }
    this.drawNextBadge();
    retireTextures(this.app.stage, stale);
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
    const labelStyle = { fontFamily: FONT.body, fontSize: Math.max(13, rowH * 0.3), fill: COLORS.dim };
    for (let i = 0; i < this.rings; i++) {
      const ring = this.rings - 1 - i;
      const y = top + i * rowH + rowH / 2;
      this.buttons.push({ x: pad, y: y - btn / 2, w: btn * 1.6, h: btn, ring, dir: -1, pressed: 0 });
      this.buttons.push({ x: w - pad - btn * 1.6, y: y - btn / 2, w: btn * 1.6, h: btn, ring, dir: 1, pressed: 0 });
      const t = new Text({ text: this.opts.labels.ring(ring, this.rings), style: labelStyle, resolution: 2 });
      t.anchor.set(0.5);
      t.position.set(w / 2, y);
      this.controlsLayer.addChild(t);
      this.controlTexts.push(t);
    }
    const dy = top + this.rings * rowH + rowH / 2;
    this.buttons.push({ x: pad, y: dy - btn / 2, w: w - pad * 2, h: btn, ring: null, dir: 0, pressed: 0 });
    const d = new Text({ text: this.opts.labels.drop, style: { ...labelStyle, fontSize: 16, fill: COLORS.cream }, resolution: 2 });
    d.anchor.set(0.5);
    d.position.set(w / 2, dy);
    this.controlsLayer.addChild(d);
    this.controlTexts.push(d);
    this.drawControls();
  }

  /** The turn and drop buttons: raised, with cream marks; a press shows as an amber hairline. */
  private drawControls(): void {
    const g = this.controlsG;
    g.clear();
    if (this.controlsH === 0) return;
    this.controlsLayer.alpha = this.interactive ? 1 : 0.4;
    for (const b of this.buttons) {
      g.roundRect(b.x, b.y, b.w, b.h, RADIUS).fill(COLORS.raised);
      if (b.pressed > 0) g.roundRect(b.x, b.y, b.w, b.h, RADIUS).stroke({ width: 2, color: COLORS.amber });
      if (b.dir === 0) continue;
      // A curved arrow: an arc with a head, bending the way the ring will turn.
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      const ar = b.h * 0.26;
      const sweep = b.dir === 1 ? [Math.PI * 1.15, Math.PI * 1.85] : [Math.PI * 1.85, Math.PI * 1.15];
      const sx = cx + Math.cos(sweep[0]!) * ar;
      const sy = cy + ar * 0.35 + Math.sin(sweep[0]!) * ar;
      g.moveTo(sx, sy)
        .arc(cx, cy + ar * 0.35, ar, sweep[0]!, sweep[1]!, b.dir === -1)
        .stroke({ width: 2, color: COLORS.cream, cap: "round" });
      const ex = cx + Math.cos(sweep[1]!) * ar;
      const ey = cy + ar * 0.35 + Math.sin(sweep[1]!) * ar;
      const hd = b.h * 0.14;
      const dirx = b.dir === 1 ? 1 : -1;
      g.poly([ex + dirx * hd * 0.2, ey + hd * 0.9, ex - dirx * hd * 1.1, ey - hd * 0.15, ex + dirx * hd * 0.7, ey - hd * 0.6]).fill(COLORS.cream);
    }
  }

  /**
   * The chart is bare ground with one hairline round it: no frame, no spokes, no rim (docs/BRAND.md
   * section 3). Each ring is a flat band, the lane stars fall down is a shade lighter, and every
   * slot has a dot, since where a star is not matters as much as where one is.
   */
  private drawSky(): void {
    const g = this.sky;
    g.clear();
    const inner = this.innerRadius();
    const outer = this.outerRadius();
    const bw = this.bandWidth();
    for (let r = this.rings - 1; r >= 0; r--) g.circle(0, 0, inner + (r + 1) * bw).fill(r % 2 === 0 ? COLORS.raised : COLORS.bandLow);
    // The entry lane: the top octant, so the column stars fall into reads at a glance.
    const half = Math.PI / this.octants;
    const a0 = this.angleOf(0) - half;
    const a1 = this.angleOf(0) + half;
    g.moveTo(Math.cos(a0) * inner, Math.sin(a0) * inner).arc(0, 0, outer, a0, a1).lineTo(Math.cos(a1) * inner, Math.sin(a1) * inner).arc(0, 0, inner, a1, a0, true).fill({ color: COLORS.line, alpha: 0.45 });
    g.circle(0, 0, inner).fill(COLORS.ground);
    g.circle(0, 0, outer).stroke({ width: 1, color: COLORS.line });
    this.drawDots();
  }

  /** A dot in every empty slot. A slot with a star has none, so nothing shows through a star's cut-out but its ring. */
  private drawDots(): void {
    const g = this.dots;
    g.clear();
    const dot = Math.max(2, this.starSize() * 0.13);
    for (let r = 0; r < this.rings; r++) {
      for (let o = 0; o < this.octants; o++) {
        if (this.state?.slots[r * this.octants + o]) continue;
        const a = this.angleOf(o);
        g.circle(Math.cos(a) * this.ringRadius(r), Math.sin(a) * this.ringRadius(r), dot).fill(o === 0 ? COLORS.dim : COLORS.line);
      }
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

  /** The constellation: a hollow star in every slot that wants one. */
  private drawMarkers(): void {
    for (const c of this.markerLayer.removeChildren()) c.destroy();
    if (!this.showMarkers || !this.state) return;
    // Under a star a marker is its outline alone, so nothing of it shows through the star's cut-out.
    const under = new Set<number>();
    for (const v of this.stars.values()) under.add(v.ring * this.octants + v.octant);
    for (const m of this.shownMarkers) {
      const s = new Sprite(this.texture(m.kind, true, under.has(m.ring * this.octants + m.octant)));
      s.anchor.set(0.5);
      const p = this.markerPos(m);
      s.position.set(p.x, p.y);
      this.markerLayer.addChild(s);
    }
  }

  /** The constellation's figure: hairlines joining its markers in order around the chart, cream where both ends hold. */
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
      // A line stops short of each marker, so it never runs through one.
      const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
      const gap = this.markerCell() * 0.5;
      if (len <= gap * 2) continue;
      const ux = ((pb.x - pa.x) / len) * gap;
      const uy = ((pb.y - pa.y) / len) * gap;
      g.moveTo(pa.x + ux, pa.y + uy).lineTo(pb.x - ux, pb.y - uy).stroke({ width: lit ? 2 : 1, color: lit ? COLORS.cream : COLORS.dim, alpha: lit ? 1 : 0.6 });
    }
  }

  private drawHighlight(): void {
    const g = this.highlight;
    g.clear();
    if ((!this.keyboardUsed && this.ringFlash <= 0) || !this.interactive) return;
    // The ring picked is the player's own, so it is amber.
    const alpha = this.keyboardUsed ? 1 : Math.min(1, this.ringFlash / 300);
    const r0 = this.innerRadius() + this.selectedRing * this.bandWidth();
    g.circle(0, 0, r0 + this.bandWidth()).stroke({ width: 2, color: COLORS.amber, alpha });
    g.circle(0, 0, r0).stroke({ width: 2, color: COLORS.amber, alpha });
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
      this.fallingStar.visible = false;
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
    const cell = this.cell();
    // Dotted path from the star to where it rests: cream, or danger when the column is shut.
    const dots = 6;
    for (let i = 1; i <= dots; i++) {
      const d = y + ((endY - y) * i) / (dots + 1);
      p.circle(0, d, Math.max(1.5, size * 0.12)).fill({ color: blocked ? COLORS.danger : COLORS.cream, alpha: 0.7 });
    }
    const onMarker = !blocked && state.markers.some((m) => navigationSlotOf(cfg, m.ring, m.octant) === landing && m.kind === f.kind);
    if (blocked) {
      const d = this.ringRadius(this.rings - 1);
      const s = size * 0.6;
      p.moveTo(-s, -d - s).lineTo(s, -d + s).moveTo(s, -d - s).lineTo(-s, -d + s).stroke({ width: 3, color: COLORS.danger, cap: "round" });
      // The chart's edge turns danger: the column is shut.
      p.circle(0, 0, this.outerRadius()).stroke({ width: 2, color: COLORS.danger });
    } else {
      // Where the player's star will rest: an amber ring, bold when that slot is its own marker.
      const d = this.ringRadius(navigationRingOf(cfg, landing));
      g.circle(0, -d, cell * 0.64).stroke({ width: onMarker ? 3.5 : 1.5, color: COLORS.amber });
    }
    // Markers wanting this kind are ringed in cream.
    if (this.showMarkers) {
      for (const m of state.markers) {
        if (m.kind !== f.kind || this.markerHeld(m)) continue;
        if (!blocked && navigationSlotOf(cfg, m.ring, m.octant) === landing) continue;
        const mp = this.markerPos(m);
        pulse.circle(mp.x, mp.y, cell * 0.64).stroke({ width: 1, color: COLORS.cream, alpha: 0.8 });
      }
    }
    this.fallingStar.texture = this.texture(f.kind, false);
    this.fallingStar.position.set(0, y);
    this.fallingStar.visible = true;
  }

  /** In the sky beside the entry: the star after this one. */
  private drawNextBadge(): void {
    const g = this.nextBadge;
    g.clear();
    this.nextText.visible = false;
    this.nextStar.visible = false;
    const state = this.state;
    if (!state || !this.interactive || state.finished) return;
    const cell = this.cell();
    const room = this.cy - this.R;
    const open = room > cell * 1.6;
    const x = this.cx + this.R * (open ? 0.55 : 0.66);
    const y = open ? room * 0.5 + 7 : this.cy - this.R * 0.86;
    // With no sky to sit in, the star rests on a small panel off the chart's edge.
    if (!open) g.roundRect(x - cell * 0.6, y - cell * 0.6, cell * 1.2, cell * 1.2, RADIUS).fill(COLORS.raised).stroke({ width: 1, color: COLORS.line });
    this.nextStar.texture = this.texture(state.next, false);
    this.nextStar.scale.set(0.9);
    this.nextStar.position.set(x, y);
    this.nextStar.visible = true;
    if (open) {
      this.nextText.visible = true;
      this.nextText.position.set(x, y - cell * 0.5);
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
    const beat = 0.5 + 0.5 * Math.sin(this.time * 0.006);
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
        .stroke({ width: 3, color: COLORS.cream, alpha: 0.4 + 0.4 * beat, cap: "round", join: "round" });
    }
  }

  /** A number, or a short label, rising from where it was earned. */
  private popup(x: number, y: number, text: string, color: number, scale = 1, counted = true): void {
    const t = new Text({
      text,
      style: {
        fontFamily: counted ? FONT.mono : FONT.body,
        fontSize: Math.max(14, this.R * 0.1 * scale),
        fontWeight: "700",
        fill: color,
        // A ground edge keeps the number readable over any star.
        stroke: { color: COLORS.ground, width: 4, join: "round" },
      },
      resolution: 2,
    });
    t.anchor.set(0.5);
    t.position.set(x, y);
    this.fxLayer.addChild(t);
    this.popups.push({ t, life: 0, max: this.reduced ? 500 : 950, y0: y, rise: this.R * 0.1 });
  }

  private callout(text: string, color: number): void {
    const t = new Text({
      text,
      style: { fontFamily: FONT.body, fontSize: Math.max(18, this.R * 0.14), fontWeight: "700", fill: color, stroke: { color: COLORS.ground, width: 5, join: "round" }, align: "center" },
      resolution: 2,
    });
    t.anchor.set(0.5);
    t.position.set(0, -this.R * 0.3);
    this.fxLayer.addChild(t);
    this.popups.push({ t, life: 0, max: this.reduced ? 600 : 1000, y0: t.y, rise: this.R * 0.06 });
  }

  /** Ask for the beat. A stronger moment while one is playing takes it over; it never stacks. */
  private beat(strength: number): void {
    // The pulse and its sound are asked for together, so they cannot drift apart.
    sfx.beat(strength);
    this.beatNow = { life: 0, strength: Math.max(strength, this.beatNow?.strength ?? 0) };
  }

  /**
   * The beat: the whole board pulses once in amber and swells a hair, in `BEAT_MS`. Reduced motion
   * keeps it as a still flash.
   */
  private drawBeat(dt: number): void {
    const g = this.beatLayer;
    g.clear();
    const b = this.beatNow;
    if (!b) return;
    b.life += dt;
    const t = b.life / BEAT_MS;
    if (t >= 1) {
      this.beatNow = null;
      this.chart.scale.set(1);
      return;
    }
    // Up in the first quarter, down over the rest.
    const env = this.reduced ? 1 : t < 0.25 ? easeOutCubic(t / 0.25) : 1 - easeOutCubic((t - 0.25) / 0.75);
    g.rect(0, 0, this.app.screen.width, this.app.screen.height).fill({ color: COLORS.amber, alpha: (0.14 + 0.16 * b.strength) * env });
    this.chart.scale.set(this.reduced ? 1 : 1 + 0.012 * b.strength * env);
  }

  // ---- per frame

  private tick(dt: number): void {
    this.time += dt;
    while (this.pending.length && this.pending[0]!.at <= this.time) this.pending.shift()!.run();
    let busy = this.pending.length > 0;
    for (let r = 0; r < this.rings; r++) {
      const spin = this.ringSpin[r]!;
      if (spin.t >= 1) continue;
      // A turn is a move: 120ms, eased out, never past its place (docs/BRAND.md section 6).
      spin.t = this.reduced ? 1 : Math.min(1, spin.t + dt / MOVE_MS);
      this.ringLayers[r]!.rotation = spin.t >= 1 ? 0 : spin.from * (1 - easeOutCubic(spin.t));
      if (spin.t < 1) busy = true;
    }
    for (const v of [...this.stars.values()]) {
      if (v.dying !== null) {
        // A cleared star shrinks to nothing.
        v.dying += dt;
        const q = Math.min(1, v.dying / CLEAR_MS);
        v.s.scale.set(1 - q * q);
        if (q >= 1) this.kill(v);
        else busy = true;
        continue;
      }
      if (v.move < 1) {
        v.move = this.reduced ? 1 : Math.min(1, v.move + dt / MOVE_MS);
        const e = easeOutCubic(v.move);
        v.x = v.sx + (v.tx - v.sx) * e;
        v.y = v.sy + (v.ty - v.sy) * e;
        v.s.position.set(v.x, v.y);
        if (v.move < 1) busy = true;
      }
    }
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i]!;
      p.life += dt;
      const q = p.life / p.max;
      p.t.scale.set(0.6 + 0.4 * easeOutCubic(Math.min(1, p.life / MOTION.panel)));
      p.t.y = p.y0 - p.rise * easeOutCubic(Math.min(1, q));
      p.t.alpha = q < 0.65 ? 1 : Math.max(0, 1 - (q - 0.65) / 0.35);
      if (q >= 1) {
        p.t.destroy();
        this.popups.splice(i, 1);
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
    this.drawFalling();
    this.drawHint();
    this.drawBeat(dt);
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
    const layer = this.ringLayers[ring]!;
    layer.rotation -= dir * ((Math.PI * 2) / this.octants);
    this.ringSpin[ring] = { from: layer.rotation, t: 0 };
    for (const v of this.stars.values()) {
      if (v.ring !== ring || v.dying !== null) continue;
      v.octant = (((v.octant + dir) % this.octants) + this.octants) % this.octants;
      const a = this.angleOf(v.octant);
      const rad = this.ringRadius(ring);
      v.tx = Math.cos(a) * rad;
      v.ty = Math.sin(a) * rad;
      this.jump(v, v.tx, v.ty);
      v.move = 1;
    }
    this.drawMarkers();
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
