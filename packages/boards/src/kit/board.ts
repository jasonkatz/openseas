/**
 * The base every prototype board's renderer extends (ADR 0036). It owns the PixiJS application, the
 * frame loop, the tween clock, the effects layer and the pointer plumbing, and it speaks the same
 * contract to the page and the smoke test as the game's hand-built boards: `setState`,
 * `setInteractive`, `setShowMarks`, `keyboard`, a `data-testid="<id>-canvas"` canvas, and a
 * `data-view` attribute that says what is drawn once the board has settled.
 *
 * A renderer draws and reports input. It never scores and never decides what a move does: it asks
 * the engine (CLAUDE.md, "boards is presentation and transport only").
 */
import { Application, Container, Graphics, Rectangle, Texture, type FederatedPointerEvent } from "pixi.js";
import { drawSprite, hasSprite, isSpritePuzzle, loadPuzzleSprites, spritesReady } from "../sprites/atlas.js";
import { boardSurface } from "../surface.js";
import { Fx } from "./fx.js";
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

  /** True once the canvas exists. Before that, state and settings are held until `init` resolves. */
  get isReady(): boolean {
    return this.ready;
  }

  async init(): Promise<void> {
    // One decode a page (ADR 0037). An atlas that fails or times out leaves the code-drawn pieces.
    if (isSpritePuzzle(this.id)) await loadPuzzleSprites(this.id);
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
    stage.on("pointerupoutside", () => this.pointerCancel());
    stage.on("pointercancel", () => this.pointerCancel());
    this.app.renderer.on("resize", () => this.relayout());
    this.app.ticker.add((ticker) => this.frame(Math.min(50, ticker.deltaMS)));
    this.ready = true;
    this.relayout();
  }

  destroy(): void {
    this.destroyed = true;
    this.tweens.clear();
    if (this.ready) {
      this.ready = false;
      this.dispose();
      this.app.destroy(true, { children: true });
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
  /** Free anything `build` made that the stage does not own (textures, gradients). */
  protected dispose(): void {}

  protected pointerDown(_x: number, _y: number, _e: FederatedPointerEvent): void {}
  protected pointerMove(_x: number, _y: number, _e: FederatedPointerEvent): void {}
  protected pointerUp(_x: number, _y: number, _e: FederatedPointerEvent): void {}
  protected pointerCancel(): void {}

  /** True while the board is still playing a move out. The view is published when this turns false. */
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

  /** Tell the smoke test where the grid sits on the canvas, in CSS pixels: `data-geom="ox,oy,cell"`. */
  protected publishGeom(ox: number, oy: number, cell: number): void {
    this.app.canvas.setAttribute("data-geom", `${Math.round(ox)},${Math.round(oy)},${Math.round(cell * 100) / 100}`);
  }

  /** Ask for the view to be published again once settled: something drawn changed without a new state. */
  protected touchView(): void {
    this.viewStale = true;
  }

  private relayout(): void {
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
