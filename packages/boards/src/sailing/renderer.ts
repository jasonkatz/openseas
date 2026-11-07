import { loadPuzzleSprites, spritesReady } from "../sprites/atlas.js";
import { Application, CanvasSource, Container, FillGradient, Graphics, Rectangle, Sprite, Text, Texture, type FederatedPointerEvent } from "pixi.js";
import {
  SAILING_ROTATION_KICKS,
  sailingCanDrop,
  sailingFits,
  sailingIdx,
  sailingLandingRow,
  sailingPairCells,
  sailingShelfMask,
  sailingSpawnPosition,
  type Platform,
  type Rotation,
  type SailingClearRound,
  type SailingState,
  type Segment,
} from "@openseas/engine";
import type { SailingContent } from "@openseas/content";
import { mix } from "../bilging/tiles.js";
import { discCanvas, type DiscStyle, type SailTexture } from "./discs.js";

export interface SailingCallbacks {
  /** The player's pair came to rest with its anchor at (col, row) in rotation `rot`. */
  onPlace(col: number, row: number, rot: Rotation): void;
  /** First frame drawn after a new state arrived. */
  onFrame(): void;
  /** A cascade step is clearing on screen now. */
  onClear(round: SailingClearRound): void;
  /** The falling pair touched down on screen. */
  onLanded(): void;
  /** The pair moved, rotated or dropped: a soft tick. */
  onNudge(): void;
  /** The rigging filled to the top and was cleared for a penalty. */
  onWipe(): void;
}

export interface SailingRendererOptions {
  showMarks: boolean;
  /** Ms per row of free fall, and while the pair is hurried (a held swipe or the down key). From content. */
  fallMs: number;
  softDropMs: number;
  chainLabel(chain: number): string;
  platformLabel: string;
  /** Callout when the rigging is cleared for `points`. */
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
  dying: number | null;
}

interface Popup {
  t: Text;
  life: number;
  max: number;
  y0: number;
}

type Step = () => number | "settle";

const COLORS = {
  woodTop: 0x4a3322,
  woodBottom: 0x2a1b10,
  woodEdge: 0x1a0f07,
  skyTop: 0x16294a,
  skyBottom: 0x0a1424,
  brass: 0xd4a548,
  rope: 0xd8b574,
  plank: 0x8a6136,
  plankDark: 0x4e3419,
  danger: 0xf0604d,
};
const CLEAR_MS = 200;
const DIE_MS = 220;
/** How long a pair rests on the floor, a shelf or a stack before it locks. */
const LOCK_MS = 350;
/** Slides and turns that restart the lock timer while resting; after that the timer runs on regardless. Falling to a lower row restores them. */
const MAX_LOCK_RESETS = 3;

export class SailingRenderer {
  readonly app = new Application();
  private readonly board = new Container();
  private readonly staticLayer = new Container();
  private readonly frame = new Graphics();
  private readonly well = new Graphics();
  private readonly platformLayer = new Graphics();
  private readonly ghost = new Graphics();
  private readonly linkLayer = new Graphics();
  private readonly pieceLayer = new Container();
  private readonly fallingLayer = new Container();
  private readonly fxLayer = new Container();
  /** The next pair, previewed in a strip above the rigging so it is visible on every layout. */
  private readonly nextLayer = new Container();
  private readonly nextA = new Sprite(Texture.WHITE);
  private readonly nextB = new Sprite(Texture.WHITE);
  private readonly nextLink = new Graphics();
  private nextText: Text | null = null;
  private strip = 0;
  private readonly pieces = new Map<number, PieceView>();
  private readonly popups: Popup[] = [];
  private readonly textures = new Map<number, Texture>();
  private readonly colorByKind = new Map<number, number>();
  private readonly markByKind = new Map<number, string>();
  private readonly textureByKind = new Map<number, SailTexture>();
  private readonly woodFill = linear(false, [COLORS.woodBottom, COLORS.woodTop, COLORS.woodBottom]);
  private readonly skyFill = linear(true, [COLORS.skyTop, COLORS.skyBottom]);
  private readonly reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  private showMarks: boolean;
  private cell = 40;
  private pad = 8;
  private ox = 0;
  private oy = 0;
  private width = 6;
  private height = 13;
  private state: SailingState | null = null;
  private platforms: readonly Platform[] = [];
  private steps: Step[] = [];
  private waitMs = 0;
  private waitSettle = 0;
  private moving = false;
  private framePending = false;
  private viewStale = true;
  private destroyed = false;
  private interactive = false;
  private time = 0;
  /**
   * The pair under the player's control, or null between placements. `row` is the anchor's row as
   * a continuous value: the pair occupies row ceil(row) and is part way down to the row below.
   */
  private falling: { col: number; rot: Rotation; row: number; a: Sprite; b: Sprite; lock: number; resets: number; low: number } | null = null;
  private softDrop = false;
  private drag: { x: number; y: number; col: number; moved: boolean; hurried: boolean } | null = null;

  constructor(
    private readonly host: HTMLElement,
    content: SailingContent,
    private readonly cb: SailingCallbacks,
    private readonly opts: SailingRendererOptions,
  ) {
    this.showMarks = opts.showMarks;
    content.pieces.forEach((p, i) => {
      this.colorByKind.set(i, parseInt(p.color.slice(1), 16));
      this.markByKind.set(i, p.mark);
      this.textureByKind.set(i, p.texture);
    });
    this.width = content.config.width;
    this.height = content.config.height;
  }

  private styleFor(kind: number): DiscStyle {
    return {
      color: this.colorByKind.get(kind) ?? 0xffffff,
      texture: this.textureByKind.get(kind) ?? "speckle",
      mark: this.markByKind.get(kind) ?? null,
      showMarks: this.showMarks,
    };
  }

  async init(): Promise<void> {
    await loadPuzzleSprites("sailing");
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
    this.app.canvas.dataset.spriteAtlas = spritesReady("sailing") ? "sailing" : "fallback";
    this.app.canvas.style.touchAction = "none";
    this.app.canvas.setAttribute("data-testid", "sailing-canvas");
    this.app.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    this.host.appendChild(this.app.canvas);
    this.staticLayer.addChild(this.frame, this.well);
    this.staticLayer.cacheAsTexture({ resolution: this.app.renderer.resolution, antialias: true });
    this.nextA.anchor.set(0.5);
    this.nextB.anchor.set(0.5);
    this.nextText = new Text({ text: this.opts.nextLabel, style: { fontFamily: "Atkinson Hyperlegible, Avenir Next, Segoe UI, sans-serif", fontSize: 11, fontWeight: "700", fill: 0xc9bb9a, letterSpacing: 2 } });
    this.nextText.anchor.set(1, 0.5);
    this.nextLayer.addChild(this.nextText, this.nextLink, this.nextA, this.nextB);
    this.board.addChild(this.staticLayer, this.platformLayer, this.ghost, this.linkLayer, this.pieceLayer, this.fallingLayer, this.fxLayer, this.nextLayer);
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
      this.woodFill.destroy();
      this.skyFill.destroy();
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

  setShowMarks(on: boolean): void {
    if (this.showMarks === on) return;
    this.showMarks = on;
    if (this.app.renderer) this.bake();
  }

  /** A new engine state. Plays the last move back step by step; anything still animating fast-forwards. */
  setState(state: SailingState): void {
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
      this.platforms = state.platforms;
      this.drawPlatforms();
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
    va.tx = this.cx(ca % this.width);
    va.ty = this.cy(Math.floor(ca / this.width));
    vb.tx = this.cx(cb % this.width);
    vb.ty = this.cy(Math.floor(cb / this.width));
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
        for (const g of round.groups) {
          for (const id of g.ids) {
            const v = this.pieces.get(id);
            if (v) v.dying = 0;
          }
          const first = g.cells[0]!;
          const color = g.cause === "platform" ? COLORS.brass : (this.colorByKind.get(this.pieces.get(g.ids[0]!)?.kind ?? 0) ?? 0xffffff);
          this.popup(this.cx(first % this.width), this.cy(Math.floor(first / this.width)) - this.cell * 0.2, `+${g.points * round.groups.length * round.chain}`, color);
          if (g.cause === "platform") this.callout(this.opts.platformLabel, COLORS.brass);
        }
        if (round.chain >= 2) this.callout(this.opts.chainLabel(round.chain), 0xf5d58a);
        return this.reduced ? 60 : CLEAR_MS;
      });
      this.steps.push(() => {
        for (const g of round.groups) for (const id of g.ids) this.remove(id);
        this.platforms = round.platforms;
        this.drawPlatforms();
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
        return this.reduced ? 80 : 420;
      });
    }
    this.steps.push(() => {
      this.platforms = state.platforms;
      this.drawPlatforms();
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
      v.tx = x;
      v.ty = y;
      if (snap) {
        v.x = x;
        v.y = y;
        v.s.position.set(x, y);
      } else if (v.x !== x || v.y !== y) this.moving = true;
    }
    for (const [id, v] of this.pieces) if (!seen.has(id) && v.dying === null) this.kill(v);
  }

  private spawn(s: Segment, x: number, y: number): PieceView {
    const sprite = new Sprite(this.textures.get(s.kind) ?? Texture.WHITE);
    sprite.anchor.set(0.5);
    sprite.position.set(x, y);
    this.pieceLayer.addChild(sprite);
    const v: PieceView = { s: sprite, kind: s.kind, pair: s.pair, x, y, tx: x, ty: y, dying: null };
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
    const s = sailingSpawnPosition(this.state.config);
    if (!sailingFits(this.state, s.col, s.row, s.rot)) return;
    const a = new Sprite(this.textures.get(this.state.current.a) ?? Texture.WHITE);
    const b = new Sprite(this.textures.get(this.state.current.b) ?? Texture.WHITE);
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
    this.ghost.clear();
  }

  /** The pair may occupy (col, row, rot) now: it fits there and, mid-fall, in the row it is entering too. */
  private mayOccupy(col: number, row: number, rot: Rotation): boolean {
    const f = this.falling;
    if (!f || !this.state) return false;
    const R = Math.ceil(f.row);
    if (!sailingFits(this.state, col, row, rot)) return false;
    // Mid-fall, the row being entered must be free too, unless the pair would rest here anyway.
    return f.row === R || !sailingCanDrop(this.state, col, row, rot) || sailingFits(this.state, col, row - 1, rot);
  }

  /** After a slide or turn mid-fall into a spot with a shelf or a stack under it, the pair sits up on it instead of sinking past. */
  private settleIfResting(): void {
    const f = this.falling;
    if (!f || !this.state) return;
    const R = Math.ceil(f.row);
    if (f.row !== R && !sailingCanDrop(this.state, f.col, R, f.rot)) {
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

  /** Turn clockwise (1) or counter-clockwise (-1) with the engine's kicks, so what the player sees is a position the engine accepts. */
  private tryRotate(dir: 1 | -1 = 1): void {
    const f = this.falling;
    if (!f || !this.interactive) return;
    const R = Math.ceil(f.row);
    const rot = ((f.rot + dir + 4) % 4) as Rotation;
    for (const kick of SAILING_ROTATION_KICKS) {
      if (!this.mayOccupy(f.col + kick, R, rot)) continue;
      f.col += kick;
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
    const g = this.ghost;
    g.clear();
    if (!f || !this.state) return;
    const R = Math.ceil(f.row);
    const cells = sailingPairCells(this.state.config, f.col, R, f.rot);
    if (!cells) return;
    const dy = (R - f.row) * this.cell;
    f.a.position.set(this.cx(cells.a % this.width), this.cy(Math.floor(cells.a / this.width)) + dy);
    f.b.position.set(this.cx(cells.b % this.width), this.cy(Math.floor(cells.b / this.width)) + dy);
    const landRow = sailingLandingRow(this.state, f.col, R, f.rot);
    const land = sailingPairCells(this.state.config, f.col, landRow, f.rot);
    if (land) {
      const wantAt = new Map<number, number | null>();
      for (const p of this.platforms) for (const c of p.cells) wantAt.set(sailingIdx(this.state.config, c.col, c.row), c.want);
      for (const [c, kind] of [
        [land.a, this.state.current.a],
        [land.b, this.state.current.b],
      ] as const) {
        const x = this.cx(c % this.width);
        const y = this.cy(Math.floor(c / this.width));
        const color = this.colorByKind.get(kind) ?? 0xffffff;
        const s = this.cell;
        if (wantAt.get(c) === kind) {
          // The landing fills a target of its own kind: a soft glow around the target ring.
          for (const [r, a] of [
            [0.62, 0.1],
            [0.55, 0.18],
            [0.48, 0.3],
          ] as const) g.circle(x, y, s * r).fill({ color, alpha: a });
          g.circle(x, y, s * 0.47).stroke({ width: 2, color: mix(color, 0xffffff, 0.5), alpha: 0.9 });
        } else {
          // Plain landing: a thin outer ring, so a target ring underneath stays readable.
          g.circle(x, y, s * 0.46).stroke({ width: 1.5, color, alpha: 0.6 });
        }
      }
    }
  }

  // ---- drawing

  private layout(): void {
    if (!this.app.renderer) return;
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const padFor = (cell: number): number => Math.max(6, Math.round(cell * 0.15));
    // One extra row's worth of height is kept above the board for the next-pair strip.
    const rows = this.height + 1.2;
    let cell = Math.floor(Math.min(w / this.width, h / rows));
    cell = Math.floor(Math.min((w - padFor(cell) * 2 - 2) / this.width, (h - padFor(cell) * 2 - 2) / rows));
    this.cell = Math.max(12, cell);
    this.pad = padFor(this.cell);
    this.strip = Math.round(this.cell * 1.2);
    this.ox = Math.floor((w - this.cell * this.width) / 2);
    this.oy = Math.floor((h - this.cell * this.height - this.strip) / 2) + this.strip;
    this.board.position.set(this.ox, this.oy);
    this.drawFrame();
    this.bake();
    this.drawPlatforms();
    this.layoutNext();
    if (this.state) this.place(this.state.cells, true);
    this.positionFalling();
    this.steps = [];
  }

  /** The next-pair strip: caption on the left of two small discs in the top-right corner of the frame. */
  private layoutNext(): void {
    const s = this.cell;
    const W = this.width * s;
    const y = -this.strip / 2 - 1;
    const scale = 0.72;
    this.nextA.scale.set(scale);
    this.nextB.scale.set(scale);
    this.nextB.position.set(W - s * 0.55, y);
    this.nextA.position.set(W - s * 0.55 - s * scale, y);
    this.nextLink.clear();
    const lw = s * 0.26;
    this.nextLink.roundRect(this.nextA.x, y - lw / 2, this.nextB.x - this.nextA.x, lw, lw / 2).fill({ color: 0x1a2a44, alpha: 0.9 });
    if (this.nextText) {
      this.nextText.style.fontSize = Math.max(9, Math.round(s * 0.34));
      this.nextText.position.set(this.nextA.x - s * scale * 0.6 - 4, y);
    }
  }

  private updateNext(): void {
    if (!this.state) return;
    this.nextA.texture = this.textures.get(this.state.next.a) ?? Texture.WHITE;
    this.nextB.texture = this.textures.get(this.state.next.b) ?? Texture.WHITE;
  }

  private drawFrame(): void {
    const g = this.frame;
    const W = this.width * this.cell;
    const H = this.height * this.cell;
    const p = this.pad;
    g.clear();
    const top = -p - this.strip;
    g.roundRect(-p - 2, top + 4, W + p * 2 + 4, H + p * 2 + this.strip, p + 6).fill({ color: 0x000000, alpha: 0.45 });
    g.roundRect(-p, top, W + p * 2, H + p * 2 + this.strip, p + 4).fill(this.woodFill);
    g.roundRect(-p, top, W + p * 2, H + p * 2 + this.strip, p + 4).stroke({ width: 1.5, color: 0x6b4a2e, alpha: 0.9 });
    // A darker ledge for the next-pair strip.
    g.roundRect(0, -this.strip + 2, W, this.strip - 4, 4).fill({ color: 0x000000, alpha: 0.28 });
    // Rope lashings down both sides.
    for (let r = 1; r < this.height; r += 2) {
      const y = r * this.cell;
      g.moveTo(-p, y - 2).lineTo(0, y + 2).moveTo(W, y + 2).lineTo(W + p, y - 2);
    }
    g.stroke({ width: Math.max(1.5, p * 0.25), color: COLORS.rope, alpha: 0.55 });

    const w = this.well;
    w.clear();
    w.rect(0, 0, W, H).fill(this.skyFill);
    const inset = this.cell * 0.06;
    for (let r = 0; r < this.height; r++) {
      for (let c = 0; c < this.width; c++) {
        w.roundRect(c * this.cell + inset, r * this.cell + inset, this.cell - inset * 2, this.cell - inset * 2, this.cell * 0.16).fill({ color: 0xffffff, alpha: 0.03 });
      }
    }
    // The spawn row is marked so the player knows where topping out happens.
    w.moveTo(0, this.cell).lineTo(W, this.cell).stroke({ width: 1, color: 0xffffff, alpha: 0.12 });
    w.rect(0, 0, W, H).stroke({ width: 3, color: 0x000000, alpha: 0.55, alignment: 1 });
    this.staticLayer.updateCacheTexture();
  }

  /**
   * Platforms: one continuous outlined shape per platform, a plank under every cell that has a
   * shelf, round target outlines in their color and a faint ring for blank cells. Circles sit at
   * the exact cell centre so the ghost and the landed disc line up with them.
   */
  private drawPlatforms(): void {
    const g = this.platformLayer;
    g.clear();
    const s = this.cell;
    if (!this.state) return;
    const shelf = sailingShelfMask(this.state.config, this.platforms);
    for (const p of this.platforms) {
      const has = (col: number, row: number): boolean => p.cells.some((c) => c.col === col && c.row === row);
      // Body: the union of the cells.
      for (const c of p.cells) {
        const x = c.col * s;
        const y = (this.height - c.row - 1) * s;
        g.rect(x, y, s, s).fill({ color: COLORS.plank, alpha: 0.1 });
      }
      // Outline: every cell edge that faces outside the shape.
      for (const c of p.cells) {
        const x = c.col * s;
        const y = (this.height - c.row - 1) * s;
        if (!has(c.col, c.row + 1)) g.moveTo(x, y).lineTo(x + s, y);
        if (!has(c.col, c.row - 1)) g.moveTo(x, y + s).lineTo(x + s, y + s);
        if (!has(c.col - 1, c.row)) g.moveTo(x, y).lineTo(x, y + s);
        if (!has(c.col + 1, c.row)) g.moveTo(x + s, y).lineTo(x + s, y + s);
      }
      g.stroke({ width: Math.max(1.5, s * 0.05), color: COLORS.rope, alpha: 0.5 });
      // Planks under the shelf cells.
      for (const c of p.cells) {
        if (!shelf[sailingIdx(this.state.config, c.col, c.row)]) continue;
        const x = c.col * s;
        const y = (this.height - c.row - 1) * s;
        g.roundRect(x + 1, y + s - s * 0.14, s - 2, s * 0.16, 3).fill({ color: COLORS.plankDark });
        g.roundRect(x + 1, y + s - s * 0.17, s - 2, s * 0.12, 3).fill({ color: COLORS.plank });
      }
      // Targets.
      for (const c of p.cells) {
        const cx = this.cx(c.col);
        const cy = this.cy(c.row);
        if (c.want === null) {
          g.circle(cx, cy, s * 0.3).stroke({ width: 1, color: COLORS.rope, alpha: 0.3 });
          continue;
        }
        const color = this.colorByKind.get(c.want) ?? 0xffffff;
        // The disc is 0.42 of a cell wide, so a wrong disc sitting here would hide a smaller ring.
        // The ring hugs the cell edge instead, so its color stays readable around any disc.
        g.circle(cx, cy, s * 0.4).fill({ color, alpha: 0.16 });
        g.circle(cx, cy, s * 0.46).stroke({ width: Math.max(3, s * 0.08), color, alpha: 0.9 });
        drawMark(g, cx, cy, s * 0.18, this.markByKind.get(c.want) ?? "circle", color);
      }
    }
  }

  private bake(): void {
    const r = this.app.renderer;
    if (!r) return;
    const old = [...this.textures.values()];
    for (const kind of this.colorByKind.keys()) {
      const canvas = discCanvas(this.cell, this.styleFor(kind), r.resolution);
      this.textures.set(kind, new Texture({ source: new CanvasSource({ resource: canvas, resolution: r.resolution }) }));
    }
    for (const v of this.pieces.values()) v.s.texture = this.textures.get(v.kind) ?? Texture.WHITE;
    this.updateNext();
    if (this.falling && this.state) {
      this.falling.a.texture = this.textures.get(this.state.current.a) ?? Texture.WHITE;
      this.falling.b.texture = this.textures.get(this.state.current.b) ?? Texture.WHITE;
    }
    for (const tex of old) tex.destroy(true);
  }

  private cx(col: number): number {
    return (col + 0.5) * this.cell;
  }
  private cy(row: number): number {
    return (this.height - row - 0.5) * this.cell;
  }

  private popup(x: number, y: number, text: string, color: number): void {
    const t = new Text({
      text,
      style: { fontFamily: "Fraunces, Georgia, serif", fontSize: Math.max(12, this.cell * 0.5), fontWeight: "700", fill: color, stroke: { color: 0x000000, width: 3 } },
    });
    t.anchor.set(0.5);
    t.position.set(x, y);
    this.fxLayer.addChild(t);
    this.popups.push({ t, life: 0, max: this.reduced ? 300 : 700, y0: y });
  }

  private callout(text: string, color: number): void {
    const t = new Text({
      text,
      style: { fontFamily: "Fraunces, Georgia, serif", fontSize: Math.max(16, this.cell * 0.8), fontWeight: "900", fill: color, stroke: { color: 0x000000, width: 4 }, letterSpacing: 1 },
    });
    t.anchor.set(0.5);
    t.position.set((this.width * this.cell) / 2, (this.height * this.cell) * 0.35);
    this.fxLayer.addChild(t);
    this.popups.push({ t, life: 0, max: this.reduced ? 400 : 900, y0: t.y });
  }

  // ---- per frame

  private tick(dt: number): void {
    this.time += dt;
    this.runSteps(dt);
    this.movePieces(dt);
    this.moveFx(dt);
    this.fall(dt);
    this.drawLinks();
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
    const speed = this.reduced ? 1 : 0.018 * this.cell;
    for (const v of [...this.pieces.values()]) {
      if (v.dying !== null) {
        v.dying += dt;
        const k = Math.min(1, v.dying / DIE_MS);
        v.s.alpha = 1 - k;
        v.s.scale.set(1 + k * 0.35);
        if (k >= 1) this.kill(v);
        continue;
      }
      if (v.y !== v.ty || v.x !== v.tx) {
        const step = speed * dt;
        v.y = v.y < v.ty ? Math.min(v.ty, v.y + step) : Math.max(v.ty, v.y - step);
        v.x = v.x < v.tx ? Math.min(v.tx, v.x + step) : Math.max(v.tx, v.x - step);
        v.s.position.set(v.x, v.y);
        if (v.y !== v.ty || v.x !== v.tx) moving = true;
      }
    }
    this.moving = moving;
  }

  private moveFx(dt: number): void {
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i]!;
      p.life += dt;
      const k = p.life / p.max;
      p.t.y = p.y0 - k * this.cell * 0.8;
      p.t.alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      if (k >= 1) {
        p.t.destroy();
        this.popups.splice(i, 1);
      }
    }
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
    const bar = (ax: number, ay: number, bx: number, by: number, ka: number, kb: number): void => {
      const dx = bx - ax;
      const dy = by - ay;
      if (Math.hypot(dx, dy) > this.cell * 1.08) return;
      const w = this.cell * 0.34;
      const color = mix(mix(this.colorByKind.get(ka) ?? 0xffffff, this.colorByKind.get(kb) ?? 0xffffff, 0.5), 0x000000, 0.45);
      if (Math.abs(dx) > Math.abs(dy)) g.roundRect(Math.min(ax, bx), ay - w / 2, Math.abs(dx), w, w / 2).fill({ color, alpha: 0.95 });
      else g.roundRect(ax - w / 2, Math.min(ay, by), w, Math.abs(dy), w / 2).fill({ color, alpha: 0.95 });
    };
    for (const list of byPair.values()) {
      if (list.length !== 2) continue;
      const [a, b] = list as [PieceView, PieceView];
      bar(a.s.x, a.s.y, b.s.x, b.s.y, a.kind, b.kind);
    }
    const f = this.falling;
    if (f && this.state) bar(f.a.x, f.a.y, f.b.x, f.b.y, this.state.current.a, this.state.current.b);
  }

  /** Gravity on the falling pair: one row per fallMs, softDropMs while hurried, then a short lock once it rests. */
  private fall(dt: number): void {
    const f = this.falling;
    if (!f || !this.interactive || this.steps.length || !this.state) return;
    const R = Math.ceil(f.row);
    if (!sailingCanDrop(this.state, f.col, R, f.rot)) {
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

  /** Mirrors what the canvas shows, for the smoke test: the kind at every cell once settled. */
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
    this.drag = { x: e.global.x, y: e.global.y, col: this.falling.col, moved: false, hurried: false };
  }

  /** Drag sideways to steer a column at a time; hold a downward swipe to hurry the fall until the finger lifts, with steering locked meanwhile. */
  private pointerMove(e: FederatedPointerEvent): void {
    const d = this.drag;
    const f = this.falling;
    if (!d || !f) return;
    const dx = e.global.x - d.x;
    const dy = e.global.y - d.y;
    if (dy > this.cell * 0.9 && Math.abs(dx) < this.cell * 1.5) {
      d.hurried = true;
      this.softDrop = true;
    } else if (dy < this.cell * 0.4) this.softDrop = false;
    // A downward swipe commits to the column it started in: no steering until the finger lifts.
    if (d.hurried) return;
    const wantCol = d.col + Math.round(dx / this.cell);
    while (f.col < wantCol) {
      const before = f.col;
      this.tryMove(1);
      d.moved = true;
      if (f.col === before) break;
    }
    while (f.col > wantCol) {
      const before = f.col;
      this.tryMove(-1);
      d.moved = true;
      if (f.col === before) break;
    }
  }

  private pointerUp(e: FederatedPointerEvent): void {
    const d = this.drag;
    this.drag = null;
    this.softDrop = false;
    if (!d || !this.falling || d.hurried) return;
    const dx = e.global.x - d.x;
    const dy = e.global.y - d.y;
    if (!d.moved && Math.abs(dx) < this.cell * 0.4 && Math.abs(dy) < this.cell * 0.4) this.tryRotate();
  }

  private pointerCancel(): void {
    this.drag = null;
    this.softDrop = false;
  }

  /** Keyboard: left and right steer, up turns clockwise, down turns counter-clockwise, space hurries while held. */
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
        this.tryRotate(1);
        return true;
      case "ArrowDown":
      case "z":
      case "Z":
        this.tryRotate(-1);
        return true;
      default:
        return false;
    }
  }
}

function linear(vertical: boolean, stops: number[]): FillGradient {
  const g = new FillGradient({ type: "linear", start: { x: 0, y: 0 }, end: vertical ? { x: 0, y: 1 } : { x: 1, y: 0 }, textureSpace: "local" });
  stops.forEach((c, i) => g.addColorStop(i / Math.max(1, stops.length - 1), c));
  return g;
}

/** The legend's mark symbols, drawn as vector outlines for platform targets. */
export function drawMark(g: Graphics, x: number, y: number, r: number, mark: string, color: number): void {
  const poly = (n: number, rot = -Math.PI / 2): void => {
    const pts: number[] = [];
    for (let i = 0; i < n; i++) pts.push(x + r * Math.cos(rot + (i * Math.PI * 2) / n), y + r * Math.sin(rot + (i * Math.PI * 2) / n));
    g.poly(pts);
  };
  switch (mark) {
    case "circle":
      g.circle(x, y, r);
      break;
    case "square":
      g.rect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7);
      break;
    case "triangle":
      poly(3);
      break;
    case "diamond":
      poly(4);
      break;
    case "hexagon":
      poly(6, 0);
      break;
    case "star": {
      const pts: number[] = [];
      for (let i = 0; i < 10; i++) {
        const rr = i % 2 === 0 ? r : r * 0.45;
        pts.push(x + rr * Math.cos(-Math.PI / 2 + (i * Math.PI) / 5), y + rr * Math.sin(-Math.PI / 2 + (i * Math.PI) / 5));
      }
      g.poly(pts);
      break;
    }
    default:
      g.circle(x, y, r * 0.6);
  }
  g.stroke({ width: 2, color: mix(color, 0xffffff, 0.4), alpha: 0.9 });
}
