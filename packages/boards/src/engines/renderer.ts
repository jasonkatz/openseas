import { sfx } from "../audio.js";
import { Application, CanvasSource, Container, Graphics, Sprite, Text, Texture, type FederatedPointerEvent } from "pixi.js";
import {
  ENGINES_ROTATION_KICKS,
  enginesPlacementKey,
  enginesReachablePositions,
  enginesCanDrop,
  enginesFits,
  enginesIdx,
  enginesLandingRow,
  enginesPairCells,
  enginesShelfMask,
  enginesSpawnPosition,
  type Injector,
  type Rotation,
  type EnginesClearRound,
  type EnginesState,
  type Segment,
} from "@openseas/engine";
import type { EnginesContent, PieceColor } from "@openseas/content";
import { pelletCanvas, type PelletForm, type PelletShape } from "./pellets.js";
import { boardSurface } from "../surface.js";
import { FONT, MOTION, ink } from "../look/tokens.js";

export interface EnginesCallbacks {
  /** The player's pair came to rest with its anchor at (col, row) in rotation `rot`. */
  onPlace(col: number, row: number, rot: Rotation): void;
  /** First frame drawn after a new state arrived. */
  onFrame(): void;
  /** A cascade step is clearing on screen now. */
  onClear(round: EnginesClearRound): void;
  /** The falling pair touched down on screen. */
  onLanded(): void;
  /** The pair moved, rotated or dropped: a soft tick. */
  onNudge(): void;
  /** The core filled to the top and was cleared for a penalty. */
  onWipe(): void;
}

export interface EnginesRendererOptions {
  /** Ms per row of free fall, and while the pair is hurried (a held swipe or the down key). From content. */
  fallMs: number;
  softDropMs: number;
  chainLabel(chain: number): string;
  injectorLabel: string;
  /** Callout when the core is cleared for `points`. */
  wipeLabel(points: number): string;
  /** Caption for the next-pair preview above the board. */
  nextLabel: string;
}

interface PieceView {
  s: Sprite;
  kind: number;
  pair: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
  /** Where the move to (tx, ty) began, and how far along it is, 0 to 1 (1 is done). */
  sx: number;
  sy: number;
  move: number;
  dying: number | null;
}

interface Popup {
  t: Text;
  life: number;
  max: number;
  y0: number;
  rise: number;
}

type Step = () => number | "settle";

/** Every colour the board draws, from the game's one palette (docs/BRAND.md section 2). */
const COLORS = {
  ground: ink("ground"),
  raised: ink("raised"),
  line: ink("line"),
  cream: ink("cream"),
  dim: ink("dim"),
  amber: ink("amber"),
  danger: ink("danger"),
};
const MOVE_MS = MOTION.move;
const CLEAR_MS = MOTION.clear;
const DIE_MS = MOTION.clear;
const BEAT_MS = MOTION.beat;
/** The board holds this long on a flameout before the fresh injectors are dealt. */
const WIPE_MS = 420;
/** How long a pair rests on the floor, a shelf or a stack before it locks. */
const LOCK_MS = 350;
/** A finger held still this long hurries the pair: long enough that the start of a swipe or a drag does not. */
const HOLD_MS = 60;
/** Slides and turns that restart the lock timer while resting; after that the timer runs on regardless. Falling to a lower row restores them. */
const MAX_LOCK_RESETS = 3;
/** The bar that joins the halves of a pair, as a share of a cell. */
const LINK_WIDTH = 0.16;
/** How far in from each pellet's centre the bar starts, as a share of a cell. */
const LINK_INSET = 0.2;

const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

export class EnginesRenderer {
  readonly app = new Application();
  private readonly board = new Container();
  /** The playfield's ground and its one hairline. There is no frame round a board (docs/BRAND.md section 3). */
  private readonly well = new Graphics();
  private readonly injectorLayer = new Graphics();
  /** Each target's hollow outline, over its injector's body. */
  private readonly targetLayer = new Container();
  /** Where the pair in hand would land: a fill and an outline for each half. */
  private readonly ghostLayer = new Container();
  private readonly ghostFill: [Sprite, Sprite] = [new Sprite(Texture.EMPTY), new Sprite(Texture.EMPTY)];
  private readonly ghostLine: [Sprite, Sprite] = [new Sprite(Texture.EMPTY), new Sprite(Texture.EMPTY)];
  private readonly linkLayer = new Graphics();
  private readonly pieceLayer = new Container();
  private readonly fallingLayer = new Container();
  private readonly beatLayer = new Graphics();
  private readonly fxLayer = new Container();
  private readonly calloutLayer = new Container();
  /** The next pair, previewed in a strip above the core so it is visible on every layout. */
  private readonly nextLayer = new Container();
  private readonly nextA = new Sprite(Texture.EMPTY);
  private readonly nextB = new Sprite(Texture.EMPTY);
  private readonly nextLink = new Graphics();
  private nextText: Text | null = null;
  private strip = 0;
  private readonly pieces = new Map<number, PieceView>();
  private readonly popups: Popup[] = [];
  /** Each kind baked at the current size, by `kind:form`; `land` is the ghost in cream, for a landing that fills a target. */
  private readonly textures = new Map<string, Texture>();
  private readonly colorByKind = new Map<number, PieceColor>();
  private readonly shapeByKind = new Map<number, PelletShape>();
  private readonly reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  private cell = 40;
  private ox = 0;
  private oy = 0;
  private width = 6;
  private height = 13;
  private state: EnginesState | null = null;
  private injectors: readonly Injector[] = [];
  private steps: Step[] = [];
  private waitMs = 0;
  private waitSettle = 0;
  private moving = false;
  private framePending = false;
  private viewStale = true;
  private destroyed = false;
  private interactive = false;
  private time = 0;
  /** The beat: one amber pulse of the whole board for a big moment (docs/BRAND.md section 6). */
  private beatNow: { life: number; strength: number } | null = null;
  /**
   * The pair under the player's control, or null between placements. `row` is the anchor's row as
   * a continuous value: the pair occupies row ceil(row) and is part way down to the row below.
   */
  private falling: { col: number; rot: Rotation; row: number; a: Sprite; b: Sprite; lock: number; resets: number; low: number } | null = null;
  private reach: { state: EnginesState; set: Set<number> } | null = null;
  private softDrop = false;
  private drag: { x: number; y: number; col: number; moved: boolean; hurried: boolean; turned: boolean; touch: boolean; held: number; far: boolean } | null = null;

  constructor(
    private readonly host: HTMLElement,
    content: EnginesContent,
    private readonly cb: EnginesCallbacks,
    private readonly opts: EnginesRendererOptions,
  ) {
    content.pieces.forEach((p, i) => {
      this.colorByKind.set(i, p.color);
      this.shapeByKind.set(i, p.shape);
    });
    this.width = content.config.width;
    this.height = content.config.height;
  }

  private tex(kind: number, form: PelletForm | "land" = "solid"): Texture {
    return this.textures.get(`${kind}:${form}`) ?? Texture.EMPTY;
  }

  async init(): Promise<void> {
    // Points and callouts are drawn as text, so wait (briefly) for the webfont. Before the renderer
    // is made, not after: the board hands over a state as soon as there is one, and by then the layout must be in.
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
    // No atlas to wait for: the pellets are drawn in code (ADR 0062). The studio's thumbnails read this.
    this.app.canvas.dataset.pieces = "drawn";
    this.app.canvas.style.touchAction = "none";
    this.app.canvas.setAttribute("data-testid", "engines-canvas");
    this.app.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    this.host.appendChild(this.app.canvas);
    for (const sprite of [...this.ghostFill, ...this.ghostLine, this.nextA, this.nextB]) sprite.anchor.set(0.5);
    for (const sprite of this.ghostFill) sprite.alpha = 0.4;
    this.ghostLayer.addChild(...this.ghostFill, ...this.ghostLine);
    this.hideGhost();
    this.nextText = new Text({ text: this.opts.nextLabel, style: { fontFamily: FONT.body, fontSize: 13, fill: COLORS.dim }, resolution: 2 });
    this.nextText.anchor.set(1, 0.5);
    this.nextLayer.addChild(this.nextText, this.nextLink, this.nextA, this.nextB);
    this.board.addChild(this.well, this.injectorLayer, this.targetLayer, this.ghostLayer, this.linkLayer, this.pieceLayer, this.fallingLayer, this.beatLayer, this.fxLayer, this.calloutLayer, this.nextLayer);
    this.app.stage.addChild(this.board);
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
    if (!on) {
      this.drag = null;
      this.softDrop = false;
      this.dropFalling();
    } else if (this.state && !this.falling && this.steps.length === 0 && !this.state.finished) this.spawnFalling();
  }

  /** A new engine state. Plays the last move back step by step; anything still animating fast-forwards. */
  setState(state: EnginesState): void {
    if (!this.app.renderer) return;
    const prev = this.state;
    this.state = state;
    this.framePending = true;
    this.viewStale = true;
    this.updateNext();
    const report = state.lastMove;
    if (!prev || !report || report.move.type !== "place" || !report.landed) {
      this.finishSteps();
      this.steps = [];
      this.injectors = state.injectors;
      this.drawInjectors();
      this.place(state.cells, true);
      this.dropFalling();
      if (this.interactive && !state.finished) this.spawnFalling();
      return;
    }
    this.finishSteps();
    // The falling sprites become the two landed segments.
    const landed = report.landed;
    const f = this.falling;
    this.falling = null;
    this.fallingLayer.removeChildren();
    const [ca, cb] = landed.cells;
    const [ia, ib] = landed.ids;
    const kindA = state.lastMove && prev.current.a;
    const kindB = prev.current.b;
    const start = f ? { ax: f.a.x, ay: f.a.y, bx: f.b.x, by: f.b.y } : null;
    const pairId = state.nextPair - 1;
    const va = this.spawn({ id: ia, kind: kindA, pair: pairId }, start?.ax ?? this.cx(ca % this.width), start?.ay ?? this.cy(Math.floor(ca / this.width)));
    const vb = this.spawn({ id: ib, kind: kindB, pair: pairId }, start?.bx ?? this.cx(cb % this.width), start?.by ?? this.cy(Math.floor(cb / this.width)));
    this.aim(va, this.cx(ca % this.width), this.cy(Math.floor(ca / this.width)));
    this.aim(vb, this.cx(cb % this.width), this.cy(Math.floor(cb / this.width)));
    if (f) {
      f.a.destroy();
      f.b.destroy();
    }
    this.cb.onLanded();
    // The next pair is under the player's control at once; it only starts falling once the
    // board below has finished playing out, so input never waits on an animation.
    if (this.interactive && !state.finished) this.spawnFalling();
    this.steps.push(() => "settle");
    for (const round of report.rounds) {
      this.steps.push(() => {
        this.cb.onClear(round);
        let fired = 0;
        for (const g of round.groups) {
          for (const id of g.ids) {
            const v = this.pieces.get(id);
            if (v) v.dying = 0;
          }
          const first = g.cells[0]!;
          this.popup(this.cx(first % this.width), this.cy(Math.floor(first / this.width)) - this.cell * 0.2, `+${g.points * round.groups.length * round.chain}`);
          if (g.cause === "injector") fired++;
        }
        const lines: string[] = [];
        if (fired) lines.push(this.opts.injectorLabel);
        if (round.chain >= 2) lines.push(this.opts.chainLabel(round.chain));
        if (lines.length) this.callout(lines.join("\n"), COLORS.cream);
        // The beat is kept for a chain's third step and beyond, and for two injectors fired in one step.
        if (round.chain >= 3 || fired >= 2) this.beat(0.5 + Math.min(0.5, Math.max(round.chain - 3, fired - 2) * 0.25));
        return this.reduced ? 60 : CLEAR_MS;
      });
      this.steps.push(() => {
        for (const g of round.groups) for (const id of g.ids) this.remove(id);
        this.injectors = round.injectors;
        this.drawInjectors();
        this.place(round.settled, false);
        return "settle";
      });
    }
    if (report.wipe) {
      const wipe = report.wipe;
      this.steps.push(() => {
        this.cb.onWipe();
        this.callout(this.opts.wipeLabel(wipe.penalty), COLORS.danger);
        for (const id of wipe.ids) {
          const v = this.pieces.get(id);
          if (v) v.dying = 0;
        }
        return this.reduced ? 80 : WIPE_MS;
      });
    }
    this.steps.push(() => {
      this.injectors = state.injectors;
      this.drawInjectors();
      this.place(state.cells, false);
      if (this.interactive && !state.finished && !this.falling) this.spawnFalling();
      return 0;
    });
  }

  private finishSteps(): void {
    while (this.steps.length) this.steps.shift()!();
    this.waitMs = 0;
    this.waitSettle = 0;
    for (const v of this.pieces.values()) {
      v.x = v.tx;
      v.y = v.ty;
      v.move = 1;
      v.s.position.set(v.x, v.y);
      if (v.dying !== null) this.kill(v);
    }
  }

  /** Put a sprite on every segment of `cells`, moving existing ones toward their new cell. */
  private place(cells: ReadonlyArray<Segment | null>, snap: boolean): void {
    const seen = new Set<number>();
    for (let i = 0; i < cells.length; i++) {
      const s = cells[i];
      if (!s) continue;
      seen.add(s.id);
      const x = this.cx(i % this.width);
      const y = this.cy(Math.floor(i / this.width));
      let v = this.pieces.get(s.id);
      if (!v) v = this.spawn(s, x, snap ? y : y - this.cell * 2);
      if (snap) {
        v.tx = v.x = x;
        v.ty = v.y = y;
        v.move = 1;
        v.s.position.set(x, y);
      } else this.aim(v, x, y);
    }
    for (const [id, v] of this.pieces) if (!seen.has(id) && v.dying === null) this.kill(v);
  }

  /** Send a piece to (x, y): a short eased move from wherever it is now (docs/BRAND.md section 6). */
  private aim(v: PieceView, x: number, y: number): void {
    if (v.tx === x && v.ty === y && v.x === x && v.y === y) return;
    v.sx = v.x;
    v.sy = v.y;
    v.tx = x;
    v.ty = y;
    v.move = 0;
    this.moving = true;
  }

  private spawn(s: Segment, x: number, y: number): PieceView {
    const sprite = new Sprite(this.tex(s.kind));
    sprite.anchor.set(0.5);
    sprite.position.set(x, y);
    this.pieceLayer.addChild(sprite);
    const v: PieceView = { s: sprite, kind: s.kind, pair: s.pair, x, y, tx: x, ty: y, sx: x, sy: y, move: 1, dying: null };
    this.pieces.set(s.id, v);
    return v;
  }

  private remove(id: number): void {
    const v = this.pieces.get(id);
    if (v) this.kill(v);
  }

  private kill(v: PieceView): void {
    for (const [id, p] of this.pieces) if (p === v) this.pieces.delete(id);
    v.s.destroy();
  }

  // ---- the falling pair

  /** Every pair enters at the engine's spawn. If that is blocked the engine has already wiped the board. */
  private spawnFalling(): void {
    if (!this.state || this.falling || this.state.finished) return;
    const s = enginesSpawnPosition(this.state.config);
    if (!enginesFits(this.state, s.col, s.row, s.rot)) return;
    const a = new Sprite(this.tex(this.state.current.a));
    const b = new Sprite(this.tex(this.state.current.b));
    a.anchor.set(0.5);
    b.anchor.set(0.5);
    this.fallingLayer.addChild(a, b);
    this.falling = { col: s.col, rot: s.rot, row: s.row, a, b, lock: 0, resets: 0, low: s.row };
    this.softDrop = false;
    this.positionFalling();
  }

  private dropFalling(): void {
    if (!this.falling) return;
    this.falling.a.destroy();
    this.falling.b.destroy();
    this.falling = null;
    this.hideGhost();
  }

  private hideGhost(): void {
    for (const sprite of [...this.ghostFill, ...this.ghostLine]) sprite.visible = false;
  }

  /** The pair may occupy (col, row, rot) now: it fits there and, mid-fall, in the row it is entering too. */
  private mayOccupy(col: number, row: number, rot: Rotation): boolean {
    const f = this.falling;
    if (!f || !this.state) return false;
    const R = Math.ceil(f.row);
    if (!this.fitsAt(col, row, rot)) return false;
    // Mid-fall, the row being entered must be free too, unless the pair would rest here anyway.
    return f.row === R || !this.canDropAt(col, row, rot) || this.fitsAt(col, row - 1, rot);
  }

  /**
   * A pair turned upright in the top row stands with half `b` above the board until it has sunk a
   * row: the pivot does not give way to make room. The engine has no such row, so the board keeps
   * it to itself, and only where the pair can sink into the board from there.
   */
  private above(row: number, rot: Rotation): boolean {
    return rot === 1 && row === this.height;
  }

  private fitsAt(col: number, row: number, rot: Rotation): boolean {
    return enginesFits(this.state!, col, this.above(row, rot) ? row - 1 : row, rot);
  }

  private canDropAt(col: number, row: number, rot: Rotation): boolean {
    return this.above(row, rot) || enginesCanDrop(this.state!, col, row, rot);
  }

  /** After a slide or turn mid-fall into a spot with a shelf or a stack under it, the pair sits up on it instead of sinking past. */
  private settleIfResting(): void {
    const f = this.falling;
    if (!f || !this.state) return;
    const R = Math.ceil(f.row);
    if (f.row !== R && !this.canDropAt(f.col, R, f.rot)) {
      f.row = R;
      f.lock = 0;
    }
  }

  /** A slide or turn while resting restarts the lock, but only a few times, so the pair cannot be shuffled forever. */
  private resetLock(): void {
    const f = this.falling;
    if (!f || f.lock === 0 || f.resets >= MAX_LOCK_RESETS) return;
    f.lock = 0;
    f.resets++;
  }

  private tryMove(dcol: number): void {
    const f = this.falling;
    if (!f || !this.interactive) return;
    const R = Math.ceil(f.row);
    if (!this.mayOccupy(f.col + dcol, R, f.rot)) return;
    f.col += dcol;
    this.resetLock();
    this.settleIfResting();
    this.cb.onNudge();
    this.positionFalling();
  }

  /** Every position the engine lets this pair pass through, worked out once for the board it is falling into. */
  private reachable(): Set<number> {
    const s = this.state!;
    if (this.reach?.state !== s) this.reach = { state: s, set: enginesReachablePositions(s) };
    return this.reach.set;
  }

  /**
   * Turn clockwise (1) or counter-clockwise (-1) as the player sees it. Half `a`, the left one as
   * the pair enters, is the pivot: it stays in its cell, falling as it was, and half `b` swings
   * around it. Rows count up from the floor, so clockwise is 0 → 3 → 2 → 1. Only when the swing
   * does not fit does the pivot give way, a column to either side. Only positions the engine can
   * reach are taken, so what the player sees is a position the engine accepts.
   */
  private tryRotate(dir: 1 | -1 = 1): void {
    const f = this.falling;
    if (!f || !this.interactive) return;
    const R = Math.ceil(f.row);
    const rot = ((f.rot + (dir === 1 ? 3 : 1)) % 4) as Rotation;
    // The engine anchors a pair at its left column and top row; the pivot is where half `a` sits.
    const pc = f.rot === 2 ? f.col + 1 : f.col;
    const pr = f.rot === 1 ? R - 1 : R;
    const col = rot === 2 ? pc - 1 : pc;
    const row = rot === 1 ? pr + 1 : pr;
    const reach = this.reachable();
    for (const kick of ENGINES_ROTATION_KICKS) {
      // Above the board the pair is on its way to the engine's top row: that is the spot to be reachable.
      if (!reach.has(enginesPlacementKey(col + kick, this.above(row, rot) ? row - 1 : row, rot)) || !this.mayOccupy(col + kick, row, rot)) continue;
      f.col = col + kick;
      f.row += row - R;
      f.rot = rot;
      this.resetLock();
      this.settleIfResting();
      this.cb.onNudge();
      this.positionFalling();
      return;
    }
  }

  private commit(): void {
    const f = this.falling;
    if (!f || !this.state) return;
    const row = Math.ceil(f.row);
    f.row = row;
    this.positionFalling();
    this.cb.onPlace(f.col, row, f.rot);
  }

  private positionFalling(): void {
    const f = this.falling;
    this.hideGhost();
    if (!f || !this.state) return;
    const R = Math.ceil(f.row);
    const dy = (R - f.row) * this.cell;
    // By hand, not from the engine's cells: half `b` may stand above the top row.
    const flat = f.rot === 0 || f.rot === 2;
    const a = { col: f.rot === 2 ? f.col + 1 : f.col, row: f.rot === 1 ? R - 1 : R };
    const b = { col: f.rot === 0 ? f.col + 1 : f.col, row: flat || f.rot === 1 ? R : R - 1 };
    f.a.position.set(this.cx(a.col), this.cy(a.row) + dy);
    f.b.position.set(this.cx(b.col), this.cy(b.row) + dy);
    const landRow = enginesLandingRow(this.state, f.col, this.above(R, f.rot) ? R - 1 : R, f.rot);
    const land = enginesPairCells(this.state.config, f.col, landRow, f.rot);
    if (land) {
      const wantAt = new Map<number, number | null>();
      for (const p of this.injectors) for (const c of p.cells) wantAt.set(enginesIdx(this.state.config, c.col, c.row), c.want);
      // The ghost is amber, the player's own: each half's outline where it would come to rest. A half
      // that would fill a target of its own kind is filled in and outlined in cream instead.
      [[land.a, this.state.current.a] as const, [land.b, this.state.current.b] as const].forEach(([c, kind], i) => {
        const x = this.cx(c % this.width);
        const y = this.cy(Math.floor(c / this.width));
        const fills = wantAt.get(c) === kind;
        const line = this.ghostLine[i]!;
        line.texture = this.tex(kind, fills ? "land" : "ghost");
        line.position.set(x, y);
        line.visible = true;
        const fill = this.ghostFill[i]!;
        fill.texture = this.tex(kind);
        fill.position.set(x, y);
        fill.visible = fills;
      });
    }
  }

  // ---- drawing

  private layout(): void {
    if (!this.app.renderer) return;
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    // One extra row's worth of height is kept above the board for the next-pair strip. Nothing
    // frames the board, so the pellets get all of the screen but the hairline.
    const rows = this.height + 1.2;
    this.cell = Math.max(12, Math.floor(Math.min((w - 2) / this.width, (h - 2) / rows)));
    this.strip = Math.round(this.cell * 1.2);
    this.ox = Math.floor((w - this.cell * this.width) / 2);
    this.oy = Math.floor((h - this.cell * this.height - this.strip) / 2) + this.strip;
    this.board.pivot.set((this.cell * this.width) / 2, (this.cell * this.height) / 2);
    this.board.position.set(this.ox + this.board.pivot.x, this.oy + this.board.pivot.y);
    this.drawWell();
    this.bake();
    this.drawInjectors();
    this.layoutNext();
    if (this.state) this.place(this.state.cells, true);
    this.positionFalling();
    this.steps = [];
  }

  /** The next-pair strip: a caption and two small pellets above the playfield's top-right corner. */
  private layoutNext(): void {
    const s = this.cell;
    const W = this.width * s;
    const y = -this.strip / 2;
    const scale = 0.8;
    this.nextA.scale.set(scale);
    this.nextB.scale.set(scale);
    this.nextB.position.set(W - s * scale * 0.5, y);
    this.nextA.position.set(this.nextB.x - s * scale, y);
    this.nextLink.clear();
    const lw = s * LINK_WIDTH * scale;
    const in0 = s * LINK_INSET * scale;
    this.nextLink.rect(this.nextA.x + in0, y - lw / 2, this.nextB.x - this.nextA.x - in0 * 2, lw).fill(COLORS.dim);
    if (this.nextText) {
      this.nextText.style.fontSize = Math.max(11, Math.min(13, Math.round(s * 0.45)));
      this.nextText.position.set(this.nextA.x - s * scale * 0.5 - 6, y);
    }
  }

  private updateNext(): void {
    if (!this.state) return;
    this.nextA.texture = this.tex(this.state.next.a);
    this.nextB.texture = this.tex(this.state.next.b);
  }

  /** The playfield is bare ground with one hairline round it: no frame, no grid (docs/BRAND.md section 3). */
  private drawWell(): void {
    const W = this.width * this.cell;
    const H = this.height * this.cell;
    // The ground is painted, not left clear, so the board is whole wherever it is shown (a thumbnail, a capture).
    this.well.clear().rect(0, 0, W, H).fill(COLORS.ground).rect(-0.5, -0.5, W + 1, H + 1).stroke({ width: 1, color: COLORS.line });
  }

  /**
   * Injectors: each a flat raised shape, a line bar under every cell that has a shelf, the hollow
   * outline of its kind in every target and a small dot in every blank. A target's outline sits at
   * the exact cell centre and a little outside the pellet, so it shows round whatever lands in it.
   * The two cells a pair enters by are dotted too: a pellet left there flames the core out.
   */
  private drawInjectors(): void {
    const g = this.injectorLayer;
    g.clear();
    for (const old of this.targetLayer.removeChildren()) old.destroy();
    const s = this.cell;
    if (!this.state) return;
    const dot = Math.max(1.5, s * 0.07);
    const spawn = enginesSpawnPosition(this.state.config);
    for (const col of [spawn.col, spawn.col + 1]) g.circle(this.cx(col), this.cy(spawn.row), dot).fill(COLORS.line);
    const shelf = enginesShelfMask(this.state.config, this.injectors);
    const r = s * 0.16;
    const bar = Math.max(2, Math.round(s * 0.12));
    for (const p of this.injectors) {
      const has = (col: number, row: number): boolean => p.cells.some((c) => c.col === col && c.row === row);
      // Body: the union of the cells, rounded where it turns a corner.
      for (const c of p.cells) {
        const x = c.col * s;
        const y = (this.height - c.row - 1) * s;
        g.roundRect(x, y, s, s, r).fill(COLORS.raised);
        if (has(c.col + 1, c.row)) g.rect(x + s / 2, y, s, s).fill(COLORS.raised);
        if (has(c.col, c.row - 1)) g.rect(x, y + s / 2, s, s).fill(COLORS.raised);
      }
      // A shelf is a bar along the bottom of its cell.
      for (const c of p.cells) {
        if (!shelf[enginesIdx(this.state.config, c.col, c.row)]) continue;
        const x = c.col * s;
        const y = (this.height - c.row - 1) * s;
        const left = has(c.col - 1, c.row) && shelf[enginesIdx(this.state.config, c.col - 1, c.row)];
        const right = has(c.col + 1, c.row) && shelf[enginesIdx(this.state.config, c.col + 1, c.row)];
        g.roundRect(x, y + s - bar, s, bar, bar / 2).fill(COLORS.line);
        if (left) g.rect(x, y + s - bar, s / 2, bar).fill(COLORS.line);
        if (right) g.rect(x + s / 2, y + s - bar, s / 2, bar).fill(COLORS.line);
      }
      for (const c of p.cells) {
        const cx = this.cx(c.col);
        const cy = this.cy(c.row);
        if (c.want === null) {
          g.circle(cx, cy, dot).fill(COLORS.line);
          continue;
        }
        const target = new Sprite(this.tex(c.want, "target"));
        target.anchor.set(0.5);
        target.position.set(cx, cy);
        this.targetLayer.addChild(target);
      }
    }
  }

  private bake(): void {
    const r = this.app.renderer;
    if (!r) return;
    const old = [...this.textures.values()];
    const next = new Map<string, Texture>();
    const add = (key: string, canvas: HTMLCanvasElement): void => {
      next.set(key, new Texture({ source: new CanvasSource({ resource: canvas, resolution: r.resolution }) }));
    };
    for (const [kind, shape] of this.shapeByKind) {
      const color = this.colorByKind.get(kind) ?? "cream";
      add(`${kind}:solid`, pelletCanvas(this.cell, shape, color, r.resolution));
      add(`${kind}:target`, pelletCanvas(this.cell, shape, color, r.resolution, "target"));
      add(`${kind}:ghost`, pelletCanvas(this.cell, shape, "amber", r.resolution, "ghost"));
      add(`${kind}:land`, pelletCanvas(this.cell, shape, "cream", r.resolution, "ghost"));
    }
    this.textures.clear();
    for (const [key, tex] of next) this.textures.set(key, tex);
    for (const v of this.pieces.values()) v.s.texture = this.tex(v.kind);
    for (const sprite of [...this.ghostFill, ...this.ghostLine]) sprite.texture = Texture.EMPTY;
    this.updateNext();
    if (this.falling && this.state) {
      this.falling.a.texture = this.tex(this.state.current.a);
      this.falling.b.texture = this.tex(this.state.current.b);
    }
    for (const tex of old) tex.destroy(true);
  }

  private cx(col: number): number {
    return (col + 0.5) * this.cell;
  }
  private cy(row: number): number {
    return (this.height - row - 0.5) * this.cell;
  }

  private popup(x: number, y: number, text: string): void {
    const t = new Text({
      text,
      style: {
        fontFamily: FONT.mono,
        fontSize: Math.max(15, this.cell * 0.56),
        fontWeight: "700",
        fill: COLORS.cream,
        // A ground edge keeps the number readable over any pellet.
        stroke: { color: COLORS.ground, width: Math.max(3, this.cell * 0.12), join: "round" },
      },
      resolution: 2,
    });
    t.anchor.set(0.5);
    const margin = t.width / 2 + 4;
    t.position.set(Math.min(Math.max(x, margin), this.width * this.cell - margin), y);
    this.fxLayer.addChild(t);
    this.popups.push({ t, life: 0, max: this.reduced ? 300 : 950, y0: y, rise: this.cell * 0.9 });
  }

  private callout(text: string, color: number): void {
    // One callout at a time: the last one is hurried out as the next arrives.
    for (const p of this.popups) if (p.t.parent === this.calloutLayer) p.life = Math.max(p.life, p.max - 120);
    const t = new Text({
      text,
      style: {
        fontFamily: FONT.body,
        fontSize: Math.max(22, this.cell * 1.1),
        fontWeight: "700",
        fill: color,
        align: "center",
        stroke: { color: COLORS.ground, width: Math.max(4, this.cell * 0.18), join: "round" },
      },
      resolution: 2,
    });
    t.anchor.set(0.5);
    t.position.set((this.width * this.cell) / 2, this.height * this.cell * 0.35);
    this.calloutLayer.addChild(t);
    this.popups.push({ t, life: 0, max: this.reduced ? 400 : 900, y0: t.y, rise: this.cell * 0.5 });
  }

  /** Ask for the beat. A stronger moment while one is playing takes it over; it never stacks. */
  private beat(strength: number): void {
    // The pulse and its sound are asked for together, so they cannot drift apart.
    sfx.beat(strength);
    this.beatNow = { life: 0, strength: Math.max(strength, this.beatNow?.strength ?? 0) };
  }

  // ---- per frame

  private tick(dt: number): void {
    this.time += dt;
    this.runSteps(dt);
    this.movePieces(dt);
    this.moveFx(dt);
    this.hold(dt);
    this.fall(dt);
    this.drawLinks();
    this.drawBeat(dt);
    if (this.framePending && this.steps.length === 0 && !this.moving) {
      this.framePending = false;
      this.cb.onFrame();
    }
    if (this.viewStale && this.steps.length === 0 && !this.moving) this.publishView();
  }

  private runSteps(dt: number): void {
    if (this.waitSettle > 0) {
      if (this.moving) return;
      this.waitSettle = 0;
    }
    this.waitMs -= dt;
    while (this.waitMs <= 0 && this.steps.length) {
      const r = this.steps.shift()!();
      if (r === "settle") {
        // Wait for the next frame to measure movement, so pieces land before the next step fires.
        this.waitSettle = 1;
        this.waitMs = 0;
        return;
      }
      this.waitMs = r;
    }
  }

  private movePieces(dt: number): void {
    let moving = false;
    for (const v of [...this.pieces.values()]) {
      if (v.dying !== null) {
        // A cleared pellet shrinks to nothing.
        v.dying += dt;
        const k = Math.min(1, v.dying / DIE_MS);
        v.s.scale.set(1 - k * k);
        if (k >= 1) this.kill(v);
        continue;
      }
      if (v.move < 1) {
        // Reduced motion turns a move into a cut.
        v.move = this.reduced ? 1 : Math.min(1, v.move + dt / MOVE_MS);
        const e = easeOutCubic(v.move);
        v.x = v.sx + (v.tx - v.sx) * e;
        v.y = v.sy + (v.ty - v.sy) * e;
        v.s.position.set(v.x, v.y);
        if (v.move < 1) moving = true;
      }
    }
    this.moving = moving;
  }

  private moveFx(dt: number): void {
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i]!;
      p.life += dt;
      const k = p.life / p.max;
      p.t.y = p.y0 - p.rise * easeOutCubic(Math.min(1, k));
      p.t.alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      if (k >= 1) {
        p.t.destroy();
        this.popups.splice(i, 1);
      }
    }
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
      this.board.scale.set(1);
      return;
    }
    // Up in the first quarter, down over the rest.
    const env = this.reduced ? 1 : t < 0.25 ? easeOutCubic(t / 0.25) : 1 - easeOutCubic((t - 0.25) / 0.75);
    g.rect(0, 0, this.width * this.cell, this.height * this.cell).fill({ color: COLORS.amber, alpha: (0.14 + 0.16 * b.strength) * env });
    this.board.scale.set(this.reduced ? 1 : 1 + 0.012 * b.strength * env);
  }

  /** Halves of a pair stay visibly joined: a bar between them while both are on the board and adjacent. */
  private drawLinks(): void {
    const g = this.linkLayer;
    g.clear();
    const byPair = new Map<number, PieceView[]>();
    for (const v of this.pieces.values()) {
      if (v.dying !== null) continue;
      const list = byPair.get(v.pair);
      if (list) list.push(v);
      else byPair.set(v.pair, [v]);
    }
    const bar = (ax: number, ay: number, bx: number, by: number): void => {
      const dx = bx - ax;
      const dy = by - ay;
      if (Math.hypot(dx, dy) > this.cell * 1.08) return;
      const w = this.cell * LINK_WIDTH;
      // The bar starts inside each pellet's edge, short of a cut-out, so the ground still shows through one.
      const in0 = this.cell * LINK_INSET;
      if (Math.abs(dx) > Math.abs(dy)) g.rect(Math.min(ax, bx) + in0, ay - w / 2, Math.abs(dx) - in0 * 2, w).fill(COLORS.dim);
      else g.rect(ax - w / 2, Math.min(ay, by) + in0, w, Math.abs(dy) - in0 * 2).fill(COLORS.dim);
    };
    for (const list of byPair.values()) {
      if (list.length !== 2) continue;
      const [a, b] = list as [PieceView, PieceView];
      bar(a.s.x, a.s.y, b.s.x, b.s.y);
    }
    const f = this.falling;
    if (f && this.state) bar(f.a.x, f.a.y, f.b.x, f.b.y);
  }

  /** Gravity on the falling pair: one row per fallMs, softDropMs while hurried, then a short lock once it rests. */
  private fall(dt: number): void {
    const f = this.falling;
    if (!f || !this.interactive || this.steps.length || !this.state) return;
    const R = Math.ceil(f.row);
    if (!this.canDropAt(f.col, R, f.rot)) {
      f.row = R;
      f.lock += dt;
      this.positionFalling();
      if (f.lock >= LOCK_MS) this.commit();
      return;
    }
    const per = this.softDrop ? this.opts.softDropMs : this.opts.fallMs;
    f.row = Math.max(R - 1, f.row - dt / per);
    // Reaching a new lowest row is fresh ground: the lock and its resets start over.
    if (Math.ceil(f.row) < f.low) {
      f.low = Math.ceil(f.row);
      f.lock = 0;
      f.resets = 0;
    }
    this.positionFalling();
  }

  /** Mirrors what the plasma shows, for the smoke test: the kind at every cell once settled. */
  private publishView(): void {
    this.viewStale = false;
    const kinds: number[] = new Array<number>(this.width * this.height).fill(-1);
    for (const v of this.pieces.values()) {
      if (v.dying !== null) continue;
      const col = Math.round(v.tx / this.cell - 0.5);
      const row = this.height - 1 - Math.round(v.ty / this.cell - 0.5);
      if (col >= 0 && col < this.width && row >= 0 && row < this.height) kinds[row * this.width + col] = v.kind;
    }
    this.app.canvas.setAttribute("data-view", kinds.join(","));
  }

  // ---- input

  private pointerDown(e: FederatedPointerEvent): void {
    if (!this.interactive || !this.falling) return;
    this.drag = { x: e.global.x, y: e.global.y, col: this.falling.col, moved: false, hurried: false, turned: false, touch: e.pointerType !== "mouse", held: 0, far: false };
  }

  /** Drag sideways to steer a column at a time; swipe up to turn counter-clockwise; hold a downward swipe to hurry the fall until the finger lifts, with steering locked meanwhile. */
  private pointerMove(e: FederatedPointerEvent): void {
    const d = this.drag;
    const f = this.falling;
    if (!d || !f) return;
    const dx = e.global.x - d.x;
    const dy = e.global.y - d.y;
    if (d.touch) {
      // A finger that leaves where it came down is swiping or steering, not holding: the hurry ends.
      if (Math.abs(dx) > this.cell * 0.4 || Math.abs(dy) > this.cell * 0.4) {
        d.far = true;
        if (d.hurried) {
          d.hurried = false;
          this.softDrop = false;
        }
      }
      // A swipe down turns the pair clockwise, a swipe up counter-clockwise, once: the finger lifts before it can turn again.
      if (!d.moved && !d.turned && Math.abs(dy) > this.cell * 0.9 && Math.abs(dx) < this.cell * 1.5) {
        d.turned = true;
        this.tryRotate(dy > 0 ? 1 : -1);
      }
      if (d.turned) return;
      this.steer(d, dx);
      return;
    }
    if (dy > this.cell * 0.9 && Math.abs(dx) < this.cell * 1.5) {
      d.hurried = true;
      this.softDrop = true;
    } else if (dy < this.cell * 0.4) this.softDrop = false;
    // A swipe up turns the pair counter-clockwise, once: the finger lifts before it can turn again.
    if (!d.moved && !d.hurried && !d.turned && dy < -this.cell * 0.9 && Math.abs(dx) < this.cell * 1.5) {
      d.turned = true;
      this.tryRotate(-1);
    }
    if (d.turned) return;
    // A downward swipe commits to the column it started in: no steering until the finger lifts.
    if (d.hurried) return;
    this.steer(d, dx);
  }

  /** Follow the drag sideways, a column at a time. */
  private steer(d: { col: number; moved: boolean }, dx: number): void {
    const f = this.falling;
    if (!f) return;
    const want = d.col + Math.round(dx / this.cell);
    while (f.col < want) {
      const before = f.col;
      this.tryMove(1);
      d.moved = true;
      if (f.col === before) break;
    }
    while (f.col > want) {
      const before = f.col;
      this.tryMove(-1);
      d.moved = true;
      if (f.col === before) break;
    }
  }

  /** Touch: a finger held where it came down hurries the pair in hand, from HOLD_MS until it lifts or moves off. */
  private hold(dt: number): void {
    const d = this.drag;
    if (!d || !d.touch || d.far || d.hurried || d.turned || !this.falling) return;
    d.held += dt;
    if (d.held < HOLD_MS) return;
    d.hurried = true;
    this.softDrop = true;
  }

  private pointerUp(e: FederatedPointerEvent): void {
    const d = this.drag;
    this.drag = null;
    this.softDrop = false;
    if (!d || !this.falling || d.hurried || d.turned || d.touch) return;
    const dx = e.global.x - d.x;
    const dy = e.global.y - d.y;
    if (!d.moved && Math.abs(dx) < this.cell * 0.4 && Math.abs(dy) < this.cell * 0.4) this.tryRotate();
  }

  private pointerCancel(): void {
    this.drag = null;
    this.softDrop = false;
  }

  /** Keyboard: left and right steer, up and X turn counter-clockwise, down and Z clockwise, space hurries while held. */
  keyboard(key: string, down: boolean): boolean {
    if (key === " " && !down) {
      this.softDrop = false;
      return true;
    }
    if (!this.interactive) return false;
    if (key === " ") {
      this.softDrop = true;
      return true;
    }
    if (!down) return false;
    switch (key) {
      case "ArrowLeft":
        this.tryMove(-1);
        return true;
      case "ArrowRight":
        this.tryMove(1);
        return true;
      case "ArrowUp":
      case "x":
      case "X":
        this.tryRotate(-1);
        return true;
      case "ArrowDown":
      case "z":
      case "Z":
        this.tryRotate(1);
        return true;
      default:
        return false;
    }
  }
}
