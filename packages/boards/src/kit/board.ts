/**
 * The base every board's renderer extends, prototype (ADR 0036) and core (ADR 0040). It owns the
 * PixiJS application, the frame loop, the tween clock, the effects layer and the pointer plumbing,
 * and it is the whole contract with the page and the smoke test: its public members are what
 * `useBoardHost` calls, its canvas is `data-testid="<id>-canvas"`, and its `data-view` attribute
 * says what is drawn once the board has settled.
 *
 * A renderer draws and reports input. It never scores and never decides what a move does: it asks
 * the engine (CLAUDE.md, "boards is presentation and transport only").
 */
import { Application, Container, Graphics, Rectangle, Texture, type FederatedPointerEvent } from "pixi.js";
import { drawSprite, hasSprite, isSpritePuzzle, loadPuzzleSprites, spritesReady } from "../sprites/atlas.js";
import { boardSurface } from "../surface.js";
import { INK, drawMark, drawPiece, spriteName } from "./art.js";
import { Fx } from "./fx.js";
import { IdleHint, type IdleHintSpec } from "./hint.js";
import { Tweens } from "./tween.js";

export abstract class KitBoard<S> {
  readonly app = new Application();
  /** Everything the board draws. A shake moves it as one. */
  protected readonly world = new Container();
  protected readonly tweens = new Tweens();
  protected readonly reduced = typeof window !== "undefined" && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  protected readonly fx = new Fx(this.world, this.reduced);
  protected state: S | null = null;
  protected interactive = false;
  protected showMarks: boolean;
  /** Ms since the board was made, for idle motion (a pulse, a shimmer). */
  protected time = 0;
  private ready = false;
  private destroyed = false;
  private hintsOn = false;
  private hinter: IdleHint<S, unknown> | null = null;
  private framePending = false;
  private viewStale = false;
  private readonly baked = new Map<string, Texture>();
  /**
   * Atlas frames drawn down to the size they are shown at. Kept for the board's life, not dropped at
   * a layout: a layer the layout does not redraw still holds its fills, and a freed texture under a
   * fill is a crash at the next frame. Sizes are rounded up to a step, so a resize makes few of them.
   */
  private readonly frames = new Map<string, Texture>();

  /**
   * @param host the element the canvas fills.
   * @param id the puzzle id: the canvas is `data-testid="<id>-canvas"`, and the board's sprites are the atlas of that name.
   * @param onFrame called on the first settled frame after each new state, for the latency meter.
   */
  constructor(
    protected readonly host: HTMLElement,
    private readonly id: string,
    private readonly onFrame: () => void,
    showMarks: boolean,
  ) {
    this.showMarks = showMarks;
    if (this.reduced) this.tweens.rate = 4;
  }

  /** True once the canvas exists, until `destroy`. The host hands the board nothing before then. */
  get isReady(): boolean {
    return this.ready;
  }

  /** Load what the board needs and make the canvas. Resolves having made nothing when `destroy` came first. */
  async init(): Promise<void> {
    // One decode a page (ADR 0037). An atlas that fails or times out leaves the code-drawn pieces.
    if (isSpritePuzzle(this.id)) await loadPuzzleSprites(this.id);
    await this.beforeCanvas();
    if (this.destroyed) return;
    await this.app.init({ resizeTo: this.host, backgroundAlpha: 0, ...boardSurface(), autoDensity: true, preference: "webgl" });
    if (this.destroyed) {
      this.app.destroy(true);
      return;
    }
    const canvas = this.app.canvas;
    canvas.style.touchAction = "none";
    canvas.setAttribute("data-testid", `${this.id}-canvas`);
    canvas.setAttribute("data-sprite-atlas", isSpritePuzzle(this.id) && spritesReady(this.id) ? this.id : "fallback");
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    this.host.appendChild(canvas);
    this.app.stage.addChild(this.world);
    this.build();
    this.world.addChild(this.fx.layer);
    const stage = this.app.stage;
    stage.eventMode = "static";
    stage.hitArea = this.app.screen;
    stage.on("pointerdown", (e: FederatedPointerEvent) => {
      if (this.interactive) this.pointerDown(e.global.x, e.global.y, e);
    });
    stage.on("pointermove", (e: FederatedPointerEvent) => this.pointerMove(e.global.x, e.global.y, e));
    stage.on("pointerup", (e: FederatedPointerEvent) => this.pointerUp(e.global.x, e.global.y, e));
    stage.on("pointerupoutside", (e: FederatedPointerEvent) => this.pointerCancel(e.pointerId));
    // Pixi passes a cancel on only where it reads touch events; where it reads pointer events, a
    // touch the browser takes over (a scroll, a system gesture) reaches the canvas alone.
    stage.on("pointercancel", (e: FederatedPointerEvent) => this.pointerCancel(e.pointerId));
    canvas.addEventListener("pointercancel", (e) => this.pointerCancel(e.pointerId));
    stage.on("pointerleave", () => this.pointerLeave());
    this.app.renderer.on("resize", () => this.relayout());
    this.app.ticker.add((ticker) => this.frame(Math.min(50, ticker.deltaMS)));
    this.ready = true;
    this.relayout();
  }

  /** Free the canvas and everything the board made. Safe at any time, before `init` resolves too. */
  destroy(): void {
    this.destroyed = true;
    this.tweens.clear();
    if (this.ready) {
      this.ready = false;
      this.app.destroy(true, { children: true });
      this.dispose();
      this.dropBaked();
      for (const t of this.frames.values()) t.destroy(true);
      this.frames.clear();
    }
  }

  /**
   * A new engine state. Whatever was still animating is finished first, then `onState` plays the move
   * that led here; a ticked board may say the state only continues the last one (`keepsPlaying`).
   */
  setState(state: S): void {
    if (!this.ready) return;
    const prev = this.state;
    // A state that only carries the clock forward must not cut short what is still playing.
    if (!this.keepsPlaying(state, prev)) this.tweens.flush();
    this.state = state;
    this.framePending = true;
    this.viewStale = true;
    this.onState(state, prev);
  }

  setInteractive(on: boolean): void {
    if (this.interactive === on) return;
    this.interactive = on;
    if (!on) this.pointerCancel();
    if (this.ready) this.onInteractive(on);
  }

  setShowMarks(on: boolean): void {
    if (this.showMarks === on) return;
    this.showMarks = on;
    if (this.ready) this.relayout();
  }

  /** A key went down. Return true when the board used it, so the page does not scroll. */
  keyboard(_key: string): boolean {
    return false;
  }

  /**
   * Idle hints: on in practice, off in a recorded round. The host hands the page's setting on as it
   * changes; a board shows them through `idleHint`, and a board with hints of its own overrides this.
   */
  setHints(on: boolean): void {
    this.hintsOn = on;
  }

  /** A key came up, on a board that acts while a key is held (a hurry). Return true when the board used it. The host hands such a board every release. */
  keyUp?(key: string): boolean;

  // ---- what a renderer provides

  /** Make the display objects once and add them to `this.world`. The effects layer goes on top afterwards. */
  protected abstract build(): void;
  /**
   * The canvas is `width` by `height` CSS pixels now: work out the geometry and redraw everything
   * from `this.state`. Baked textures were dropped just before, so sprites must take new ones.
   */
  protected abstract layout(width: number, height: number): void;
  /** Show `state`. With a `prev`, play the move in `state` that led from it; without one, or when the two are unrelated, snap. */
  protected abstract onState(state: S, prev: S | null): void;
  /** What is on screen, as the string the board's `data-board` attribute also holds once settled: built from what is drawn, not from the state. */
  protected abstract view(): string;

  /**
   * True when `state` is the round `prev` was, a moment later: the display state a ticked engine
   * is advanced to every tick (ADR 0015). Tweens still running are then left to finish, and
   * `onState` must play only what is new, which it tells by the rising `seq` on the engine's events.
   * An untimed board leaves this false: every state it is handed is a move.
   */
  protected keepsPlaying(_state: S, _prev: S | null): boolean {
    return false;
  }

  /** Every frame, after tweens and effects. */
  protected update(_dt: number): void {}
  /** The board was switched on or off for input. */
  protected onInteractive(_on: boolean): void {}
  /** Free anything `build` made that the stage does not own (textures, gradients, timers). Called once the stage is gone. */
  protected dispose(): void {}
  /**
   * Wait for what the board needs besides its atlas before the canvas is made: a webfont it bakes
   * into textures, say. The board is not ready until this resolves, and a `destroy` meanwhile makes
   * no canvas at all.
   */
  protected beforeCanvas(): Promise<void> {
    return Promise.resolve();
  }

  protected pointerDown(_x: number, _y: number, _e: FederatedPointerEvent): void {}
  protected pointerMove(_x: number, _y: number, _e: FederatedPointerEvent): void {}
  protected pointerUp(_x: number, _y: number, _e: FederatedPointerEvent): void {}
  /**
   * A press ended without a release on the board: pointer `pointerId` was let go off the canvas or
   * taken over by the browser, or, with no id, the board was switched off. A board that follows one
   * finger at a time ignores the cancel of another.
   */
  protected pointerCancel(_pointerId?: number): void {}
  /** The pointer went off the canvas: a board that previews what a hover would do takes the preview down. */
  protected pointerLeave(): void {}

  /**
   * The board's idle hint: after `spec.after` ms with nothing done, the engine's advice pulses
   * (`kit/hint.ts`). The kit holds it back while input or hints are off, there is no state, the
   * round is over or a move is still playing out; the board adds its own reasons in `spec.held`, and
   * calls `restart` on the handle at every input and every new state. One a board.
   */
  protected idleHint<H>(spec: IdleHintSpec<S, H>): IdleHint<S, H> {
    const hint = new IdleHint(spec);
    this.hinter = hint as IdleHint<S, unknown>;
    return hint;
  }

  /**
   * True while the board is still playing a move out. The view is published, and `onFrame` called,
   * when this turns false. A board that animates outside the kit's tweens adds its own clock here.
   */
  protected get busy(): boolean {
    return this.tweens.busy;
  }

  /**
   * A texture drawn once and kept until the next layout: `draw` paints into a square of `size`
   * pixels centred on (0, 0). Pieces are sprites of these, so a board of them costs one draw each.
   * Include in `key` everything the drawing depends on besides the size (the kind, marks on or off).
   */
  protected bake(key: string, size: number, draw: (g: Graphics) => void): Texture {
    const hit = this.baked.get(key);
    if (hit) return hit;
    const g = new Graphics();
    draw(g);
    const half = Math.ceil(size / 2);
    const texture = this.app.renderer.generateTexture({ target: g, frame: new Rectangle(-half, -half, half * 2, half * 2), resolution: this.app.renderer.resolution, antialias: true });
    g.destroy();
    this.baked.set(key, texture);
    return texture;
  }

  private dropBaked(): void {
    for (const t of this.baked.values()) t.destroy(true);
    this.baked.clear();
  }

  /** True when the board's atlas is loaded and holds `name`. A kind or a lab setting past the sheet has no frame. */
  protected hasSprite(name: string): boolean {
    return isSpritePuzzle(this.id) && hasSprite(this.id, name);
  }

  /**
   * Paint the atlas frame `name` into `g`, its art fitted in a square of `size` centred on (x, y).
   * Returns false, having drawn nothing, when there is no such frame: the caller then draws the
   * piece in code, so `this.sprite(...) || drawPiece(...)` is the whole of a fallback.
   *
   * The frame is drawn down once to about the pixels it is shown at, since a 192px frame sampled
   * straight into a 40px cell shimmers. `natural` is the size to draw it down for when `size` is animated.
   * `turns` draws the art that many quarter turns clockwise, for a sprite that is itself turned back.
   */
  protected sprite(g: Graphics, name: string, x: number, y: number, size: number, alpha = 1, natural = size, turns = 0): boolean {
    if (!isSpritePuzzle(this.id) || !hasSprite(this.id, name) || size <= 0.5) return false;
    const full = size * FRAME_FIT;
    const px = Math.max(FRAME_STEP, Math.ceil((natural * FRAME_FIT * this.app.renderer.resolution) / FRAME_STEP) * FRAME_STEP);
    const key = `${name}@${px}@${turns}`;
    let texture = this.frames.get(key);
    if (!texture) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = px;
      const ctx = canvas.getContext("2d");
      if (!ctx) return false;
      ctx.imageSmoothingQuality = "high";
      ctx.translate(px / 2, px / 2);
      ctx.rotate((turns * Math.PI) / 2);
      drawSprite(ctx, this.id, name, -px / 2, -px / 2, px, px);
      texture = Texture.from(canvas);
      this.frames.set(key, texture);
    }
    g.rect(x - full / 2, y - full / 2, full, full).fill({ texture, textureSpace: "local", alpha });
    return true;
  }

  /**
   * A kind's piece as a texture `size` pixels square, baked once: the atlas frame
   * `<prefix>-<kind id>` with its art fitted in `look.art`, or where the sheet has none the kit's
   * code-drawn piece of radius `look.r` (or the board's own `look.fallback`). With marks on, the
   * kind's pips tell it apart without color (rule 6): on a plate of radius `look.r` over the frame,
   * `look.markY` below its middle, and on the face of the code-drawn piece. Every number the drawing
   * depends on is in the bake key, so a texture baked for another size is never handed out;
   * `fallback` must draw from the kind, the size and the mark setting alone.
   */
  protected kindPiece(prefix: string, kind: number, size: number, look: KindLook = {}): Texture {
    const art = look.art ?? size * 0.84;
    const r = look.r ?? size * 0.36;
    const markY = look.markY ?? 0;
    const marks = this.showMarks;
    return this.bake(`kind:${prefix}:${kind}:${size}:${art}:${r}:${markY}:${marks ? 1 : 0}`, size, (g) => {
      if (this.sprite(g, spriteName(prefix, kind), 0, 0, art)) {
        if (marks) drawMark(g, kind, 0, markY, r);
      } else if (look.fallback) look.fallback(g, marks);
      else drawPiece(g, kind, 0, 0, r, { marks });
    });
  }

  /** Tell the smoke test where the grid sits on the canvas, in CSS pixels: `data-geom="ox,oy,cell"`. */
  protected publishGeom(ox: number, oy: number, cell: number): void {
    this.app.canvas.setAttribute("data-geom", `${Math.round(ox)},${Math.round(oy)},${Math.round(cell * 100) / 100}`);
  }

  /** Ask for the view to be published again once settled: something drawn changed without a new state. */
  protected touchView(): void {
    this.viewStale = true;
  }

  /**
   * Lay the board out afresh at the canvas's size, as a resize does: whatever is playing is
   * finished, effects are cleared and baked textures dropped before `layout`. A board whose state
   * needs another geometry (a lab config of another size) calls this, never `layout` itself.
   */
  protected relayout(): void {
    if (!this.ready) return;
    this.tweens.flush();
    this.fx.clear();
    const { width, height } = this.app.screen;
    this.fx.resize(width, height);
    this.dropBaked();
    this.layout(width, height);
    this.viewStale = true;
  }

  private frame(dt: number): void {
    this.time += dt;
    this.tweens.update(dt);
    this.fx.update(dt);
    this.update(dt);
    if (this.hinter) this.hinter.frame(dt, this.hintable(this.hinter), this.time);
    if (this.busy) return;
    if (this.framePending) {
      this.framePending = false;
      this.onFrame();
    }
    if (this.viewStale) {
      this.viewStale = false;
      this.app.canvas.setAttribute("data-view", this.view());
    }
  }

  /** The state an idle hint may show on now, or null. Every engine's state says when its round is over. */
  private hintable(hint: IdleHint<S, unknown>): S | null {
    const s = this.state;
    if (!this.interactive || !this.hintsOn || s === null || (s as { finished?: unknown }).finished === true) return null;
    return hint.whileBusy || !this.busy ? s : null;
  }
}

/** How a board sizes a kind's piece in `kindPiece`, in pixels, round the middle of its texture. */
export interface KindLook {
  /** The square the atlas frame's art is fitted in. */
  art?: number;
  /** The radius of the code-drawn piece and of the plate the pips sit on over a frame. */
  r?: number;
  /** How far below the middle the plate sits over a frame (negative is up). */
  markY?: number;
  /** The board's own code-drawn piece, for a kind the sheet has no frame of; it draws the pips itself when `marks` is true. */
  fallback?: (g: Graphics, marks: boolean) => void;
}

/** A frame is 192 pixels and its art is fitted in the middle 176 (`sprites/README.md`). */
export const FRAME_FIT = 192 / 176;
/** Drawn-down frames come in sizes this many pixels apart. */
const FRAME_STEP = 8;

/** A rectangular grid of square cells laid out in the canvas: where each cell is, and which cell a point is in. Row 0 is the top row. */
export class Grid {
  cell = 40;
  ox = 0;
  oy = 0;

  constructor(
    public cols: number,
    public rows: number,
  ) {}

  /**
   * Fit the grid into a `width` by `height` area, centred, leaving `margin` round it and extra room
   * measured in cells above and below (for a strip of HUD drawn in the canvas).
   */
  fit(width: number, height: number, opts: { margin?: number; top?: number; bottom?: number; maxCell?: number } = {}): void {
    const margin = opts.margin ?? 10;
    const top = opts.top ?? 0;
    const bottom = opts.bottom ?? 0;
    const cell = Math.floor(Math.min((width - margin * 2) / this.cols, (height - margin * 2) / (this.rows + top + bottom)));
    this.cell = Math.max(12, Math.min(opts.maxCell ?? 96, cell));
    this.ox = Math.floor((width - this.cell * this.cols) / 2);
    this.oy = Math.floor((height - this.cell * (this.rows + top + bottom)) / 2 + this.cell * top);
  }

  get width(): number {
    return this.cols * this.cell;
  }

  get height(): number {
    return this.rows * this.cell;
  }

  /** The centre of a column, a row, or a cell index. */
  cx(col: number): number {
    return this.ox + (col + 0.5) * this.cell;
  }
  cy(row: number): number {
    return this.oy + (row + 0.5) * this.cell;
  }
  x(index: number): number {
    return this.cx(index % this.cols);
  }
  y(index: number): number {
    return this.cy(Math.floor(index / this.cols));
  }

  /** The cell under a point, or null outside the grid. */
  at(px: number, py: number): { col: number; row: number; index: number } | null {
    const col = Math.floor((px - this.ox) / this.cell);
    const row = Math.floor((py - this.oy) / this.cell);
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return null;
    return { col, row, index: row * this.cols + col };
  }
}

/** Arrows and WASD step a cursor one cell; Q, E, Z and C step it diagonally on a board that allows it. */
const STEPS: Readonly<Record<string, readonly [number, number]>> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], a: [-1, 0], d: [1, 0], w: [0, -1], s: [0, 1] };
const DIAGONALS: Readonly<Record<string, readonly [number, number]>> = { q: [-1, -1], e: [1, -1], z: [-1, 1], c: [1, 1] };

/**
 * The keyboard's cell on a `Grid`, drawn in a layer of its own. A step that would leave the grid
 * stays put. The cursor shows, as an outline round its cell, once a key has used it, and a pointer
 * hides it again; shown or not, the canvas says where it is as `data-cursor="col,row"`.
 */
export class GridCursor {
  /** The cell, as an index into the grid. */
  index = 0;
  /** True once a key has used it, until the pointer is used. */
  shown = false;

  /** @param diagonals Q, E, Z and C step diagonally too. */
  constructor(
    private readonly grid: Grid,
    private readonly layer: Graphics,
    private readonly diagonals = false,
  ) {}

  /** The cell `key` steps to from the cursor, or null when the key is no step. A step off the grid gives the cursor's own cell. */
  target(key: string): number | null {
    const k = key.length === 1 ? key.toLowerCase() : key;
    const step = STEPS[k] ?? (this.diagonals ? DIAGONALS[k] : undefined);
    if (!step) return null;
    const g = this.grid;
    const col = (this.index % g.cols) + step[0];
    const row = Math.floor(this.index / g.cols) + step[1];
    return col >= 0 && col < g.cols && row >= 0 && row < g.rows ? row * g.cols + col : this.index;
  }

  /** Step by `key` and show the cursor. Returns false, having changed nothing, when the key is no step. */
  move(key: string): boolean {
    const next = this.target(key);
    if (next === null) return false;
    this.index = next;
    this.shown = true;
    return true;
  }

  /** Draw it as it now is, inside the grid as it is laid out, and say where it is on `canvas`. */
  draw(canvas: HTMLCanvasElement): void {
    const g = this.grid;
    this.index = Math.min(this.index, g.cols * g.rows - 1);
    this.layer.clear();
    canvas.setAttribute("data-cursor", `${this.index % g.cols},${Math.floor(this.index / g.cols)}`);
    if (!this.shown) return;
    const half = g.cell / 2 - 2;
    this.layer.roundRect(g.x(this.index) - half, g.y(this.index) - half, half * 2, half * 2, g.cell * 0.16).stroke({ width: 3, color: INK.white, alpha: 0.9 });
  }
}
