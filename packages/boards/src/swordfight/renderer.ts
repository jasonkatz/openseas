import { Application, CanvasSource, Container, FillGradient, Graphics, Sprite, Text, Texture, type FederatedPointerEvent } from "pixi.js";
import {
  swordfightBoardString,
  swordfightIdx,
  swordfightLandingCells,
  swordfightSpawnCol,
  type Slab,
  type SwordBoard,
  type SwordCell,
  type SwordRotation,
  type SwordfightConfig,
  type SwordfightEvent,
  type SwordfightState,
} from "@openseas/engine";
import type { SwordfightContent } from "@openseas/content";
import { mix } from "../bilging/tiles.js";
import { drawMark } from "../sailing/renderer.js";
import { WRACK_COLOR, blockCanvas, wrackStage, type BlockStyle, type SwordTexture } from "./art.js";

/** A board in the melee that is not in this fight's state: another pirate's, or a brigand's run by the server. */
export interface RemoteBoard {
  readonly key: string;
  readonly name: string;
  readonly side: 0 | 1;
  /** Row-major, top row first: `.` empty, 0-5 a color, A-F a breaker, `#` wrack. */
  readonly cells: string;
  readonly pending: number;
  readonly out: boolean;
  readonly points: number;
}

/** What the engine said to a rest: taken, not yet (too soon after the pair appeared), or never there. */
export type PlaceAnswer = "placed" | "wait" | "refused";

export interface SwordfightCallbacks {
  /** The player's pair came to rest. "wait" means the engine will take it shortly and the board asks again. */
  onPlace(col: number, rot: SwordRotation): PlaceAnswer;
  /** First frame drawn after a new state arrived. */
  onFrame(): void;
  /** Fresh events as they are shown, for sound. */
  onEvents(events: readonly SwordfightEvent[]): void;
  /** The pair moved or turned: a soft tick. */
  onNudge(): void;
}

export interface SwordfightRendererOptions {
  showMarks: boolean;
  /** Ms per row while the player hurries the pair. Free fall is the config's fallTicks * tickMs. */
  softDropMs: number;
  labels: {
    you: string;
    foe(n: number): string;
    ally(n: number): string;
    next: string;
    incoming: string;
    shatter: string;
    slab: string;
    chain(chain: number): string;
    wrackOver(wrack: number): string;
    wrackIn: string;
    out: string;
    won: string;
    lost: string;
  };
}

/** What the board shows, for the smoke test: the player's board. */
export function swordfightViewString(state: SwordfightState): string {
  return state.config.player ? swordfightBoardString(state.config, state.boards[0]!.cells) : "";
}

interface PieceView {
  s: Sprite;
  kind: SwordCell["kind"];
  color: number;
  /** Wrack: the drops left before it ripens, which picks its look. 0 otherwise. */
  ripen: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
  dying: number | null;
  flash: number;
}

interface SlabView {
  s: Sprite;
  color: number;
  w: number;
  h: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
  dying: number | null;
  flash: number;
}

interface Mini {
  key: string;
  name: string;
  side: 0 | 1;
  cells: string;
  pending: number;
  out: boolean;
  points: number;
  g: Graphics;
  label: Text;
  pendingLabel: Text;
  flash: number;
  shake: number;
  x: number;
  y: number;
  cell: number;
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
  /** Flies to a point instead of ballistic. */
  to?: { x: number; y: number };
}

type Step = () => number | "settle";

const COLORS = {
  woodTop: 0x4a3322,
  woodBottom: 0x2a1b10,
  deckTop: 0x1a2438,
  deckBottom: 0x0b1526,
  rope: 0xd8b574,
  brass: 0xd4a548,
  bone: 0xf2f0e6,
  danger: 0xf0604d,
  good: 0x6fdc8c,
  muted: 0x9aa7bd,
  text: 0xefe3c6,
};
const CLEAR_MS = 240;
const DIE_MS = 240;
const LOCK_MS = 350;
const MAX_LOCK_RESETS = 3;
const FONT = "Atkinson Hyperlegible, Avenir Next, Segoe UI, sans-serif";
const DISPLAY = "Fraunces, Georgia, serif";

function linear(vertical: boolean, stops: number[]): FillGradient {
  const g = new FillGradient({ type: "linear", start: { x: 0, y: 0 }, end: vertical ? { x: 0, y: 1 } : { x: 1, y: 0 }, textureSpace: "local" });
  stops.forEach((c, i) => g.addColorStop(i / Math.max(1, stops.length - 1), c));
  return g;
}

/** Where the two halves sit for a pivot column (a's column), rotation and a's row. */
function halves(pc: number, rot: SwordRotation, row: number): { a: [number, number]; b: [number, number] } {
  switch (rot) {
    case 0:
      return { a: [pc, row], b: [pc + 1, row] };
    case 1:
      return { a: [pc, row], b: [pc, row + 1] };
    case 2:
      return { a: [pc, row], b: [pc - 1, row] };
    default:
      return { a: [pc, row], b: [pc, row - 1] };
  }
}
const anchorOf = (pc: number, rot: SwordRotation): number => (rot === 2 ? pc - 1 : pc);

export class SwordfightRenderer {
  readonly app = new Application();
  private readonly board = new Container();
  private readonly staticLayer = new Container();
  private readonly frame = new Graphics();
  private readonly well = new Graphics();
  private readonly ghost = new Graphics();
  private readonly pieceLayer = new Container();
  private readonly slabLayer = new Container();
  private readonly fallingLayer = new Container();
  private readonly fxG = new Graphics();
  private readonly fxLayer = new Container();
  private readonly stripLayer = new Container();
  private readonly stripG = new Graphics();
  private readonly warnG = new Graphics();
  /** The well's shape: the falling pair is clipped to it, so a pair slides in from above the board. */
  private readonly wellMask = new Graphics();
  private pendingShown = 0;
  /** Ms without a pair in hand while one is due, and ms a taken pair has waited for its state. */
  private idleMs = 0;
  private placedMs = 0;
  private readonly nextA = new Sprite(Texture.WHITE);
  private readonly nextB = new Sprite(Texture.WHITE);
  private nextText: Text | null = null;
  private incomingText: Text | null = null;
  private readonly miniLayer = new Container();
  private readonly veil = new Graphics();
  private readonly woodFill = linear(false, [COLORS.woodBottom, COLORS.woodTop, COLORS.woodBottom]);
  private readonly deckFill = linear(true, [COLORS.deckTop, COLORS.deckBottom]);
  private readonly textures = new Map<string, Texture>();
  private readonly pieces = new Map<number, PieceView>();
  private readonly slabs = new Map<number, SlabView>();
  private minis: Mini[] = [];
  private remote: readonly RemoteBoard[] = [];
  private popups: Popup[] = [];
  private particles: Particle[] = [];
  private readonly styles: Array<{ color: number; texture: SwordTexture; mark: string }> = [];
  private readonly reduced = typeof window !== "undefined" && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  private showMarks: boolean;
  private cell = 40;
  private pad = 8;
  private ox = 0;
  private oy = 0;
  private strip = 0;
  private width = 6;
  private height = 12;
  private state: SwordfightState | null = null;
  /** The player's board as shown: cells and slabs as of the last played step. */
  private cells: Array<SwordCell | null> = [];
  private shownSlabs: Slab[] = [];
  private steps: Step[] = [];
  private waitMs = 0;
  private waitSettle = 0;
  private moving = false;
  private framePending = false;
  private viewStale = true;
  private destroyed = false;
  private interactive = false;
  private time = 0;
  private shake = 0;
  private shownTick = -1;
  private shownMoves = -1;
  /** Events already shown, per tick and board: how many of that pair's events have been played. */
  private seen = new Map<string, number>();
  /** `placed` is set once the engine took the pair: it then waits for the state that replaces it, so a rest is never logged twice. */
  private falling: { pc: number; rot: SwordRotation; row: number; a: Sprite; b: Sprite; lock: number; resets: number; low: number; refused: number; placed: boolean } | null = null;
  private softDrop = false;
  private drag: { x: number; y: number; pc: number; moved: boolean; hurried: boolean } | null = null;

  constructor(
    private readonly host: HTMLElement,
    content: SwordfightContent,
    private readonly cb: SwordfightCallbacks,
    private readonly opts: SwordfightRendererOptions,
  ) {
    this.showMarks = opts.showMarks;
    for (const p of content.pieces) this.styles.push({ color: parseInt(p.color.slice(1), 16), texture: p.texture, mark: p.mark });
    this.width = content.config.width;
    this.height = content.config.height;
  }

  private styleFor(color: number, kind: SwordCell["kind"], ripen: number): BlockStyle {
    const st = this.styles[Math.max(0, color)] ?? { color: 0xffffff, texture: "rings" as const, mark: "circle" };
    return { color: st.color, texture: st.texture, mark: st.mark, kind, showMarks: this.showMarks, ripen };
  }

  private colorOf(color: number): number {
    return color < 0 ? WRACK_COLOR : (this.styles[color]?.color ?? 0xffffff);
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
    this.app.canvas.setAttribute("data-testid", "swordfight-canvas");
    this.app.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    this.host.appendChild(this.app.canvas);
    this.staticLayer.addChild(this.frame, this.well);
    this.staticLayer.cacheAsTexture({ resolution: this.app.renderer.resolution, antialias: true });
    this.nextA.anchor.set(0.5);
    this.nextB.anchor.set(0.5);
    this.nextText = new Text({ text: this.opts.labels.next.toUpperCase(), style: { fontFamily: FONT, fontSize: 11, fontWeight: "700", fill: 0xc9bb9a, letterSpacing: 2 } });
    this.nextText.anchor.set(0, 0.5);
    this.incomingText = new Text({ text: "", style: { fontFamily: FONT, fontSize: 12, fontWeight: "700", fill: COLORS.bone } });
    this.incomingText.anchor.set(1, 0.5);
    this.stripLayer.addChild(this.stripG, this.warnG, this.nextText, this.nextA, this.nextB, this.incomingText);
    this.fallingLayer.mask = this.wellMask;
    this.fxLayer.addChild(this.fxG);
    this.board.addChild(this.staticLayer, this.ghost, this.pieceLayer, this.slabLayer, this.wellMask, this.fallingLayer, this.fxLayer, this.stripLayer, this.veil);
    this.app.stage.addChild(this.board, this.miniLayer);
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
      this.deckFill.destroy();
    }
  }

  setInteractive(on: boolean): void {
    this.interactive = on;
    if (!on) {
      this.drag = null;
      this.softDrop = false;
      this.dropFalling();
    } else if (this.state && !this.falling && this.steps.length === 0) this.spawnFalling();
  }

  setShowMarks(on: boolean): void {
    if (this.showMarks === on) return;
    this.showMarks = on;
    if (this.app.renderer) {
      this.bake();
      this.drawMinis();
    }
  }

  /** Boards from outside this fight's state, beside the player's. */
  setRemote(boards: readonly RemoteBoard[]): void {
    this.remote = boards;
    if (this.app.renderer) this.syncMinis();
  }

  // ---- state

  setState(state: SwordfightState): void {
    if (!this.app.renderer) return;
    const first = !this.state;
    const sizeChanged = this.state !== null && (this.state.config.width !== state.config.width || this.state.config.height !== state.config.height);
    const reset = first || sizeChanged || state.tick < this.shownTick || state.moveCount < this.shownMoves;
    this.state = state;
    this.framePending = true;
    this.viewStale = true;
    if (sizeChanged) {
      this.width = state.config.width;
      this.height = state.config.height;
      this.layout();
    }
    const player = state.config.player ? state.boards[0]! : null;
    if (reset) {
      this.finishSteps();
      this.steps = [];
      this.seen.clear();
      this.popups.forEach((p) => p.t.destroy());
      this.popups = [];
      this.particles = [];
      this.cells = player ? player.cells.slice() : [];
      this.shownSlabs = player ? player.slabs.slice() : [];
      this.place(true);
      this.dropFalling();
      this.shownTick = state.tick;
      this.shownMoves = state.moveCount;
      this.syncMinis();
      this.updateStrip();
      if (this.interactive && player && !player.out && !state.finished) this.spawnFalling();
      return;
    }
    // Which of the report's events are new: the display is advanced every tick between logged
    // moves, and a logged move's report repeats what those advances already showed.
    const fresh: SwordfightEvent[] = [];
    const counts = new Map<string, number>();
    for (const e of state.lastMove?.events ?? []) {
      const key = `${e.tick}:${e.board}`;
      const n = counts.get(key) ?? 0;
      counts.set(key, n + 1);
      if (n >= (this.seen.get(key) ?? 0)) fresh.push(e);
    }
    for (const [key, n] of counts) this.seen.set(key, Math.max(n, this.seen.get(key) ?? 0));
    for (const key of [...this.seen.keys()]) if (Number(key.split(":")[0]) < state.tick - 100) this.seen.delete(key);
    this.shownTick = state.tick;
    this.shownMoves = state.moveCount;
    if (fresh.length) this.cb.onEvents(fresh);
    this.enqueue(state, fresh);
    this.syncMinis();
    for (const e of fresh) {
      if (e.board === 0 && player) continue;
      const mini = this.minis.find((m) => m.key === `board:${e.board}`);
      if (!mini) continue;
      if (e.type === "broke") mini.flash = 1;
      else if (e.type === "out") mini.shake = 1;
    }
    this.updateStrip();
  }

  /** Steps for the player's board, in the order things happened. Other boards are shown from the state. */
  private enqueue(state: SwordfightState, fresh: readonly SwordfightEvent[]): void {
    const player = state.config.player ? state.boards[0]! : null;
    if (!player) return;
    const own = fresh.filter((e) => e.board === 0 || (e.type === "attack" && e.to === 0));
    if (own.length === 0 && this.steps.length === 0) {
      // Nothing happened on the player's board; keep what is shown but refresh textures that may have changed.
      this.cells = player.cells.slice();
      this.shownSlabs = player.slabs.slice();
      this.place(false);
      if (this.interactive && !this.falling && !player.out && !state.finished) this.spawnFalling();
      return;
    }
    for (const e of own) {
      switch (e.type) {
        case "placed": {
          const ev = e;
          this.steps.push(() => {
            this.landFalling(ev.cells, ev.ids, player);
            return "settle";
          });
          break;
        }
        case "fused": {
          const ev = e;
          this.steps.push(() => {
            for (const s of ev.slabs) {
              this.shownSlabs = [...this.shownSlabs.filter((x) => x.id !== s.id), s];
              for (let r = s.row; r < s.row + s.h; r++) {
                for (let c = s.col; c < s.col + s.w; c++) {
                  const i = swordfightIdx(state.config, c, r);
                  const cell = this.cells[i];
                  if (cell) this.cells[i] = { ...cell, slab: s.id };
                }
              }
            }
            this.place(false);
            for (const s of ev.slabs) {
              const v = this.slabs.get(s.id);
              if (v) v.flash = 1;
              if (s.w * s.h >= 6) this.callout(this.opts.labels.slab, this.colorOf(s.color));
            }
            return this.reduced ? 40 : 120;
          });
          break;
        }
        case "broke": {
          const ev = e;
          this.steps.push(() => {
            for (const g of ev.groups) {
              const slabsHit = new Set<number>();
              for (let k = 0; k < g.cells.length; k++) {
                const cell = this.cells[g.cells[k]!];
                if (cell?.slab) slabsHit.add(cell.slab);
                const v = this.pieces.get(g.ids[k]!);
                if (v) v.dying = 0;
                this.burst(this.cx(g.cells[k]! % this.width), this.cy(Math.floor(g.cells[k]! / this.width)), this.colorOf(g.color), cell?.slab ? 2 : 4);
              }
              for (const id of slabsHit) {
                const v = this.slabs.get(id);
                if (v) v.dying = 0;
              }
              const mid = g.cells[Math.floor(g.cells.length / 2)]!;
              this.popup(this.cx(mid % this.width), this.cy(Math.floor(mid / this.width)) - this.cell * 0.2, `+${Math.round((g.points * ev.groups.length * ev.chain) || g.points)}`, this.colorOf(g.color));
            }
            if (ev.chain >= 2) this.callout(this.opts.labels.chain(ev.chain), 0xf5d58a);
            else if (ev.groups.reduce((n, g) => n + g.cells.length, 0) >= 6) this.callout(this.opts.labels.shatter, COLORS.bone);
            this.shake = Math.min(1, 0.3 + ev.chain * 0.2);
            return this.reduced ? 60 : CLEAR_MS;
          });
          break;
        }
        case "settled": {
          const ev = e;
          this.steps.push(() => {
            for (const g of this.pieces.values()) if (g.dying !== null) this.kill(g);
            for (const v of this.slabs.values()) if (v.dying !== null) this.killSlab(v);
            this.cells = ev.cells.slice();
            this.shownSlabs = ev.slabs.slice();
            this.place(false);
            return "settle";
          });
          break;
        }
        case "ripened": {
          const ev = e;
          this.steps.push(() => {
            for (let k = 0; k < ev.ids.length; k++) {
              const id = ev.ids[k]!;
              const color = ev.colors[k]!;
              const i = this.cells.findIndex((c) => c?.id === id);
              if (i >= 0) this.cells[i] = { ...this.cells[i]!, kind: "block", color, ripen: 0 };
              const v = this.pieces.get(id);
              if (v) {
                v.kind = "block";
                v.color = color;
                v.ripen = 0;
                v.s.texture = this.texture(color, "block", 1, 1);
                v.flash = 1;
              }
            }
            return this.reduced ? 40 : 160;
          });
          break;
        }
        case "attack": {
          const ev = e;
          if (ev.board !== 0) {
            // Wrack coming our way from a board in the fight.
            this.steps.push(() => {
              this.callout(this.opts.labels.wrackIn, COLORS.danger);
              const from = this.minis.find((m) => m.key === `board:${ev.board}`);
              if (from) this.fly(from.x + (from.cell * this.width) / 2 - this.ox, from.y - this.oy, (this.width * this.cell) / 2, -this.strip / 2, WRACK_COLOR, Math.min(12, ev.wrack));
              return 0;
            });
            break;
          }
          this.steps.push(() => {
            if (ev.wrack > 0) {
              this.callout(this.opts.labels.wrackOver(ev.wrack), COLORS.good);
              const to = ev.to >= 0 ? this.minis.find((m) => m.key === `board:${ev.to}`) : null;
              const target = to ? { x: to.x + (to.cell * this.width) / 2 - this.ox, y: to.y + (to.cell * this.height) / 2 - this.oy } : { x: (this.width * this.cell) / 2, y: -this.strip * 3 };
              this.fly((this.width * this.cell) / 2, (this.height * this.cell) * 0.4, target.x, target.y, COLORS.bone, Math.min(14, ev.wrack));
            }
            return 0;
          });
          break;
        }
        case "landed": {
          const ev = e;
          this.steps.push(() => {
            for (let k = 0; k < ev.cells.length; k++) {
              const i = ev.cells[k]!;
              const col = i % this.width;
              const row = Math.floor(i / this.width);
              const cell: SwordCell = { id: ev.ids[k]!, color: ev.colors[k] ?? 0, kind: "wrack", ripen: state.config.ripenMoves, slab: 0 };
              this.cells[i] = cell;
              const v = this.spawn(cell, this.cx(col), this.cy(this.height + 1 + (k % 3)));
              v.tx = this.cx(col);
              v.ty = this.cy(row);
            }
            this.moving = true;
            this.shake = Math.max(this.shake, 0.35);
            return "settle";
          });
          break;
        }
        case "out": {
          this.steps.push(() => {
            this.callout(this.opts.labels.out, COLORS.danger);
            this.shake = 1;
            this.dropFalling();
            return this.reduced ? 100 : 500;
          });
          break;
        }
        case "ended": {
          const ev = e;
          this.steps.push(() => {
            this.callout(ev.outcome === "won" ? this.opts.labels.won : this.opts.labels.lost, ev.outcome === "won" ? COLORS.good : COLORS.danger);
            this.dropFalling();
            return 0;
          });
          break;
        }
        default:
          break;
      }
    }
    // Finally the state's own truth, in case a step was skipped.
    this.steps.push(() => {
      this.cells = player.cells.slice();
      this.shownSlabs = player.slabs.slice();
      this.place(false);
      this.refitFalling();
      if (this.interactive && !this.falling && !player.out && !state.finished) this.spawnFalling();
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
    for (const v of this.slabs.values()) {
      v.x = v.tx;
      v.y = v.ty;
      v.s.position.set(v.x, v.y);
      if (v.dying !== null) this.killSlab(v);
    }
  }

  // ---- views of the player's board

  /** Put a sprite on every loose cell and a slab sprite on every slab, moving existing ones toward their new cells. */
  private place(snap: boolean): void {
    const seen = new Set<number>();
    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i];
      if (!c || c.slab) continue;
      seen.add(c.id);
      const x = this.cx(i % this.width);
      const y = this.cy(Math.floor(i / this.width));
      let v = this.pieces.get(c.id);
      if (!v) v = this.spawn(c, x, snap ? y : y - this.cell * 2);
      else if (v.kind !== c.kind || v.color !== c.color || v.ripen !== c.ripen) {
        // Wrack a drop closer to ripening changes its look: the texture is keyed on the stage too.
        v.kind = c.kind;
        v.color = c.color;
        v.ripen = c.ripen;
        v.s.texture = this.texture(c.color, c.kind, 1, 1, c.ripen);
      }
      v.tx = x;
      v.ty = y;
      if (snap) {
        v.x = x;
        v.y = y;
        v.s.position.set(x, y);
      } else if (v.x !== x || v.y !== y) this.moving = true;
    }
    for (const [id, v] of this.pieces) if (!seen.has(id) && v.dying === null) this.kill(v);
    const seenSlabs = new Set<number>();
    for (const s of this.shownSlabs) {
      seenSlabs.add(s.id);
      const x = s.col * this.cell;
      const y = (this.height - s.row - s.h) * this.cell;
      let v = this.slabs.get(s.id);
      if (!v) {
        const sprite = new Sprite(this.texture(s.color, "block", s.w, s.h));
        sprite.position.set(x, snap ? y : y - this.cell);
        this.slabLayer.addChild(sprite);
        v = { s: sprite, color: s.color, w: s.w, h: s.h, x, y: snap ? y : y - this.cell, tx: x, ty: y, dying: null, flash: 0 };
        this.slabs.set(s.id, v);
      } else if (v.w !== s.w || v.h !== s.h || v.color !== s.color) {
        v.w = s.w;
        v.h = s.h;
        v.color = s.color;
        v.s.texture = this.texture(s.color, "block", s.w, s.h);
      }
      v.tx = x;
      v.ty = y;
      if (snap) {
        v.x = x;
        v.y = y;
        v.s.position.set(x, y);
      } else if (v.x !== x || v.y !== y) this.moving = true;
    }
    for (const [id, v] of this.slabs) if (!seenSlabs.has(id) && v.dying === null) this.killSlab(v);
  }

  private spawn(c: SwordCell, x: number, y: number): PieceView {
    const sprite = new Sprite(this.texture(c.color, c.kind, 1, 1, c.ripen));
    sprite.anchor.set(0.5);
    sprite.position.set(x, y);
    this.pieceLayer.addChild(sprite);
    const v: PieceView = { s: sprite, kind: c.kind, color: c.color, ripen: c.ripen, x, y, tx: x, ty: y, dying: null, flash: 0 };
    this.pieces.set(c.id, v);
    return v;
  }

  private kill(v: PieceView): void {
    for (const [id, p] of this.pieces) if (p === v) this.pieces.delete(id);
    v.s.destroy({ children: true });
  }

  private killSlab(v: SlabView): void {
    for (const [id, p] of this.slabs) if (p === v) this.slabs.delete(id);
    v.s.destroy();
  }

  /** The texture for a block; `ripen` is the drops left on wrack, which picks its stage. */
  private texture(color: number, kind: SwordCell["kind"], w: number, h: number, ripen = 0): Texture {
    const stage = kind === "wrack" ? wrackStage(ripen) : "";
    const key = `${color}:${kind}:${stage}:${w}x${h}:${this.showMarks ? 1 : 0}:${this.cell}`;
    let t = this.textures.get(key);
    if (!t) {
      const r = this.app.renderer;
      const canvas = blockCanvas(this.cell, w, h, this.styleFor(color, kind, ripen), r.resolution);
      t = new Texture({ source: new CanvasSource({ resource: canvas, resolution: r.resolution }) });
      this.textures.set(key, t);
    }
    return t;
  }

  /** Repaint every sprite with the current cell size and marks setting. */
  private bake(): void {
    const old = [...this.textures.values()];
    this.textures.clear();
    for (const v of this.pieces.values()) v.s.texture = this.texture(v.color, v.kind, 1, 1, v.ripen);
    for (const v of this.slabs.values()) v.s.texture = this.texture(v.color, "block", v.w, v.h);
    if (this.falling && this.state?.config.player) {
      const cur = this.state.boards[0]!.current;
      this.falling.a.texture = this.texture(cur.a.color, cur.a.breaker ? "breaker" : "block", 1, 1);
      this.falling.b.texture = this.texture(cur.b.color, cur.b.breaker ? "breaker" : "block", 1, 1);
    }
    this.updateStrip();
    for (const t of old) t.destroy(true);
  }

  // ---- the falling pair

  private spawnFalling(): void {
    const s = this.state;
    if (!s || !s.config.player || this.falling || s.finished) return;
    const b = s.boards[0]!;
    if (b.out) return;
    const pc = swordfightSpawnCol(s.config);
    // The pair starts above the well and slides in; only the top cell of its column can bar it.
    const row = this.height;
    if (!this.fits(pc, 1, row)) return;
    const a = new Sprite(this.texture(b.current.a.color, b.current.a.breaker ? "breaker" : "block", 1, 1));
    const bb = new Sprite(this.texture(b.current.b.color, b.current.b.breaker ? "breaker" : "block", 1, 1));
    a.anchor.set(0.5);
    bb.anchor.set(0.5);
    this.fallingLayer.addChild(a, bb);
    this.falling = { pc, rot: 1, row, a, b: bb, lock: 0, resets: 0, low: row, refused: 0, placed: false };
    this.softDrop = false;
    this.idleMs = 0;
    this.placedMs = 0;
    this.positionFalling();
  }

  private dropFalling(): void {
    if (!this.falling) return;
    this.falling.a.destroy();
    this.falling.b.destroy();
    this.falling = null;
    this.ghost.clear();
    this.app.canvas.setAttribute("data-falling", "");
  }

  /** The falling sprites become the two placed cells and slide into them. */
  private landFalling(cells: readonly [number, number], ids: readonly [number, number], player: SwordBoard): void {
    const f = this.falling;
    const prevA = f ? { x: f.a.x, y: f.a.y } : null;
    const prevB = f ? { x: f.b.x, y: f.b.y } : null;
    this.falling = null;
    this.fallingLayer.removeChildren();
    f?.a.destroy();
    f?.b.destroy();
    this.ghost.clear();
    // The pair the state says was just placed is the previous `current`; its kinds are in the placed cells of the state's board,
    // or, if a cascade moved them, in the cells by id.
    const find = (id: number): SwordCell | null => player.cells.find((c) => c?.id === id) ?? null;
    const pending = [
      [cells[0], ids[0], prevA],
      [cells[1], ids[1], prevB],
    ] as const;
    for (const [i, id, prev] of pending) {
      // A half that fell away over the top: it was above the well and is simply gone.
      if (i < 0) continue;
      const col = i % this.width;
      const row = Math.floor(i / this.width);
      const known = find(id);
      const cell: SwordCell = known ? { ...known, slab: 0 } : { id, color: 0, kind: "block", ripen: 0, slab: 0 };
      this.cells[i] = cell;
      const v = this.spawn(cell, prev?.x ?? this.cx(col), prev?.y ?? this.cy(row));
      v.tx = this.cx(col);
      v.ty = this.cy(row);
      if (!known) {
        // The state no longer has it (shattered at once): draw it from the move's pair.
        const pair = this.lastPair;
        if (pair) {
          const p = id === ids[0] ? pair.a : pair.b;
          v.kind = p.breaker ? "breaker" : "block";
          v.color = p.color;
          v.s.texture = this.texture(p.color, v.kind, 1, 1);
          this.cells[i] = { ...cell, color: p.color, kind: v.kind };
        }
      }
    }
    this.moving = true;
    if (this.interactive && !player.out && !this.state?.finished) this.spawnFalling();
  }

  /** The pair in hand when the last placement was made, for a half that shattered at once. */
  private lastPair: { a: { color: number; breaker: boolean }; b: { color: number; breaker: boolean } } | null = null;

  /**
   * The pair may sit at (pc, rot, row): inside the board and over free cells. Two rows above the
   * well are open sky, but only over a column whose top cell is free: a pair never passes over a
   * full column, which is the engine's "no way through" refusal.
   */
  private fits(pc: number, rot: SwordRotation, row: number): boolean {
    const h = halves(pc, rot, row);
    for (const [c, r] of [h.a, h.b]) {
      if (c < 0 || c >= this.width || r < 0 || r >= this.height + 2) return false;
      if (this.cells[Math.min(r, this.height - 1) * this.width + c]) return false;
    }
    return true;
  }

  /** The pair can fall a row from a's row `row`: the cells under its lowest halves are free. */
  private canDrop(pc: number, rot: SwordRotation, row: number): boolean {
    const h = halves(pc, rot, row);
    const lows = rot === 1 ? [h.a] : rot === 3 ? [h.b] : [h.a, h.b];
    for (const [c, r] of lows) {
      if (r <= 0) return false;
      if (this.cells[(r - 1) * this.width + c]) return false;
    }
    return true;
  }

  private mayOccupy(pc: number, rot: SwordRotation, row: number): boolean {
    const f = this.falling;
    if (!f) return false;
    const R = Math.ceil(f.row);
    if (!this.fits(pc, rot, row)) return false;
    return f.row === R || !this.canDrop(pc, rot, row) || this.fits(pc, rot, row - 1);
  }

  /** After wrack landed under it, lift the pair clear; if there is no room at all it waits for the engine's word. */
  private refitFalling(): void {
    const f = this.falling;
    if (!f) return;
    let R = Math.ceil(f.row);
    while (R < this.height + 1 && !this.fits(f.pc, f.rot, R)) R += 1;
    if (!this.fits(f.pc, f.rot, R)) {
      this.dropFalling();
      return;
    }
    if (R !== Math.ceil(f.row)) {
      f.row = R;
      f.lock = 0;
    }
    this.positionFalling();
  }

  private settleIfResting(): void {
    const f = this.falling;
    if (!f) return;
    const R = Math.ceil(f.row);
    if (f.row !== R && !this.canDrop(f.pc, f.rot, R)) {
      f.row = R;
      f.lock = 0;
    }
  }

  private resetLock(): void {
    const f = this.falling;
    if (!f || f.lock === 0 || f.resets >= MAX_LOCK_RESETS) return;
    f.lock = 0;
    f.resets++;
  }

  private tryMove(d: number): void {
    const f = this.falling;
    if (!f || !this.interactive || f.placed) return;
    const R = Math.ceil(f.row);
    if (!this.mayOccupy(f.pc + d, f.rot, R)) return;
    f.pc += d;
    this.resetLock();
    this.settleIfResting();
    this.cb.onNudge();
    this.positionFalling();
  }

  /**
   * Turn the loose half around the pivot: clockwise is 1 → 0 → 3 → 2. A turn that does not fit
   * tries a kick either way, then a lift of one row (the other half would go through the floor
   * or a block), and when the pair is boxed into one column it turns twice instead, so the halves
   * swap ends.
   */
  private tryRotate(dir: 1 | -1): void {
    const f = this.falling;
    if (!f || !this.interactive || f.placed) return;
    const R = Math.ceil(f.row);
    const once = ((f.rot + (dir === 1 ? 3 : 1)) % 4) as SwordRotation;
    const twice = ((f.rot + 2) % 4) as SwordRotation;
    for (const rot of [once, twice]) {
      for (const lift of [0, 1]) {
        for (const kick of [0, -1, 1]) {
          const row = R + lift;
          if (!this.mayOccupy(f.pc + kick, rot, row)) continue;
          f.pc += kick;
          f.rot = rot;
          if (lift) f.row = row;
          this.resetLock();
          this.settleIfResting();
          this.cb.onNudge();
          this.positionFalling();
          return;
        }
      }
    }
  }

  private commit(): void {
    const f = this.falling;
    const s = this.state;
    if (!f || !s) return;
    const R = Math.ceil(f.row);
    f.row = R;
    this.positionFalling();
    if (s.config.player) this.lastPair = s.boards[0]!.current;
    const answer = this.cb.onPlace(anchorOf(f.pc, f.rot), f.rot);
    if (answer === "placed") {
      f.placed = true;
      this.placedMs = 0;
    } else if (answer === "wait") f.refused = 120;
    else {
      // The engine's board is not the one shown: take its word, lift the pair clear and carry on.
      this.cells = s.config.player ? s.boards[0]!.cells.slice() : this.cells;
      this.shownSlabs = s.config.player ? s.boards[0]!.slabs.slice() : this.shownSlabs;
      this.place(false);
      f.refused = 0;
      f.lock = 0;
      f.resets = 0;
      this.refitFalling();
    }
  }

  private positionFalling(): void {
    const f = this.falling;
    const g = this.ghost;
    g.clear();
    this.app.canvas.setAttribute("data-falling", f ? `${f.pc},${f.rot},${Math.ceil(f.row)}` : "");
    if (!f || !this.state) return;
    const R = Math.ceil(f.row);
    const h = halves(f.pc, f.rot, R);
    const dy = (R - f.row) * this.cell;
    f.a.position.set(this.cx(h.a[0]), this.cy(h.a[1]) + dy);
    f.b.position.set(this.cx(h.b[0]), this.cy(h.b[1]) + dy);
    const land = swordfightLandingCells(this.state.config, this.cells, anchorOf(f.pc, f.rot), f.rot);
    if (!land) return;
    const cur = this.state.boards[0]!.current;
    for (const [i, piece] of [
      [land[0], cur.a],
      [land[1], cur.b],
    ] as const) {
      if (i < 0) continue;
      const x = i % this.width;
      const y = Math.floor(i / this.width);
      const color = this.colorOf(piece.color);
      const s = this.cell;
      g.roundRect(x * s + s * 0.1, (this.height - y - 1) * s + s * 0.1, s * 0.8, s * 0.8, s * 0.14).fill({ color, alpha: 0.14 });
      g.roundRect(x * s + s * 0.1, (this.height - y - 1) * s + s * 0.1, s * 0.8, s * 0.8, s * 0.14).stroke({ width: piece.breaker ? 2.5 : 1.5, color: mix(color, 0xffffff, 0.3), alpha: piece.breaker ? 0.95 : 0.7 });
    }
  }

  // ---- layout and drawing

  private layout(): void {
    if (!this.app.renderer) return;
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const n = this.miniCount();
    const padFor = (cell: number): number => Math.max(6, Math.round(cell * 0.15));
    const rows = this.height + 1.3;
    const mainMaxW = n > 0 ? w * 0.68 : w;
    let cell = Math.floor(Math.min(mainMaxW / this.width, h / rows));
    cell = Math.floor(Math.min((mainMaxW - padFor(cell) * 2 - 2) / this.width, (h - padFor(cell) * 2 - 2) / rows));
    this.cell = Math.max(12, cell);
    this.pad = padFor(this.cell);
    this.strip = Math.round(this.cell * 1.3);
    const boardW = this.cell * this.width;
    this.ox = n > 0 ? this.pad + 2 : Math.floor((w - boardW) / 2);
    this.oy = Math.floor((h - this.cell * this.height - this.strip) / 2) + this.strip;
    this.board.position.set(this.ox, this.oy);
    this.wellMask.clear().rect(0, 0, this.cell * this.width, this.cell * this.height).fill(0xffffff);
    this.drawFrame();
    this.bake();
    this.layoutStrip();
    this.layoutMinis(w, h);
    this.place(true);
    this.positionFalling();
    this.steps = [];
  }

  private layoutStrip(): void {
    const s = this.cell;
    const y = -this.strip / 2 - 1;
    const scale = 0.68;
    this.nextA.scale.set(scale);
    this.nextB.scale.set(scale);
    if (this.nextText) {
      this.nextText.style.fontSize = Math.max(9, Math.round(s * 0.3));
      this.nextText.position.set(s * 0.15, y);
      this.nextA.position.set(this.nextText.x + this.nextText.width + s * 0.5, y);
    } else this.nextA.position.set(s * 0.5, y);
    this.nextB.position.set(this.nextA.x + s * scale + 2, y);
    if (this.incomingText) {
      this.incomingText.style.fontSize = Math.max(9, Math.round(s * 0.32));
      this.incomingText.position.set(this.width * s - s * 0.15, y);
    }
  }

  private updateStrip(): void {
    const s = this.state;
    if (!s || !s.config.player) return;
    const b = s.boards[0]!;
    this.nextA.texture = this.texture(b.next.a.color, b.next.a.breaker ? "breaker" : "block", 1, 1);
    this.nextB.texture = this.texture(b.next.b.color, b.next.b.breaker ? "breaker" : "block", 1, 1);
    const pending = b.pending.reduce((n, p) => n + p.wrack, 0);
    const g = this.stripG;
    g.clear();
    const cs = this.cell;
    const y = -this.strip / 2 - 1;
    // Pending wrack as a row of small grey blocks, right of centre, capped with a count.
    const show = Math.min(pending, 8);
    const bw = cs * 0.3;
    const right = this.width * cs - cs * 0.15 - (this.incomingText ? this.incomingText.width + cs * 0.2 : 0);
    for (let i = 0; i < show; i++) {
      const x = right - (i + 1) * (bw + 2);
      g.roundRect(x, y - bw / 2, bw, bw, bw * 0.2).fill({ color: WRACK_COLOR });
      g.roundRect(x, y - bw / 2, bw, bw, bw * 0.2).stroke({ width: 1, color: 0xffffff, alpha: 0.25 });
    }
    if (this.incomingText) {
      this.incomingText.text = pending > 0 ? String(pending) : "";
      this.incomingText.style.fill = pending >= this.width * 2 ? COLORS.danger : COLORS.bone;
      this.incomingText.style.fontSize = Math.max(9, Math.round(cs * 0.34));
    }
    if (pending > 0) {
      const heat = Math.min(1, pending / (this.width * 3));
      this.warnG.clear().rect(0, -this.strip + 2, this.width * cs, this.strip - 4).fill({ color: COLORS.danger, alpha: 0.06 + heat * 0.16 });
    } else this.warnG.clear();
    this.pendingShown = pending;
    this.drawWarn();
  }

  /** Wrack on its way: the count, its blocks and the tint flash so they are not missed, quicker the more there is. */
  private drawWarn(): void {
    const pending = this.pendingShown;
    const on = pending > 0;
    const pulse = on ? 0.55 + 0.45 * Math.max(0, Math.sin(this.time / (pending >= this.width ? 120 : 200))) : 1;
    this.stripG.alpha = pulse;
    this.warnG.alpha = pulse;
    if (this.incomingText) this.incomingText.alpha = pulse;
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
    g.roundRect(0, -this.strip + 2, W, this.strip - 4, 4).fill({ color: 0x000000, alpha: 0.3 });
    // Brass studs down the rails.
    for (let r = 1; r < this.height; r += 2) {
      const y = r * this.cell;
      g.circle(-p / 2, y, Math.max(1.5, p * 0.22)).fill({ color: COLORS.brass, alpha: 0.6 });
      g.circle(W + p / 2, y, Math.max(1.5, p * 0.22)).fill({ color: COLORS.brass, alpha: 0.6 });
    }
    const w = this.well;
    w.clear();
    w.rect(0, 0, W, H).fill(this.deckFill);
    const inset = this.cell * 0.06;
    for (let r = 0; r < this.height; r++) {
      for (let c = 0; c < this.width; c++) {
        w.roundRect(c * this.cell + inset, r * this.cell + inset, this.cell - inset * 2, this.cell - inset * 2, this.cell * 0.16).fill({ color: 0xffffff, alpha: 0.03 });
      }
    }
    // The entry: the top cell of the column pairs come in down, marked so covering it reads as the end.
    const sc = swordfightSpawnCol({ width: this.width } as SwordfightConfig);
    w.roundRect(sc * this.cell + 2, 2, this.cell - 4, this.cell - 4, 6).stroke({ width: 1.5, color: COLORS.danger, alpha: 0.35 });
    w.moveTo(0, this.cell).lineTo(W, this.cell).stroke({ width: 1, color: 0xffffff, alpha: 0.12 });
    w.rect(0, 0, W, H).stroke({ width: 3, color: 0x000000, alpha: 0.55, alignment: 1 });
    this.staticLayer.updateCacheTexture();
  }

  private cx(col: number): number {
    return (col + 0.5) * this.cell;
  }
  private cy(row: number): number {
    return (this.height - row - 0.5) * this.cell;
  }

  // ---- the other boards

  private miniCount(): number {
    const s = this.state;
    const inState = s ? s.boards.length - (s.config.player ? 1 : 0) : 0;
    return inState + this.remote.length;
  }

  /** The boards beside the player's, as snapshots: foes first, then allies. */
  private miniModels(): Array<Omit<Mini, "g" | "label" | "pendingLabel" | "flash" | "shake" | "x" | "y" | "cell">> {
    const s = this.state;
    const out: Array<Omit<Mini, "g" | "label" | "pendingLabel" | "flash" | "shake" | "x" | "y" | "cell">> = [];
    if (s) {
      let foe = 0;
      let ally = 0;
      s.boards.forEach((b, i) => {
        if (s.config.player && i === 0) return;
        const name = b.side === 1 ? this.opts.labels.foe(++foe) : this.opts.labels.ally(++ally);
        out.push({ key: `board:${i}`, name, side: b.side, cells: swordfightBoardString(s.config, b.cells), pending: b.pending.reduce((n, p) => n + p.wrack, 0), out: b.out, points: b.points });
      });
    }
    for (const r of this.remote) out.push({ key: r.key, name: r.name, side: r.side, cells: r.cells, pending: r.pending, out: r.out, points: r.points });
    out.sort((a, b) => b.side - a.side);
    return out;
  }

  private syncMinis(): void {
    const models = this.miniModels();
    const before = this.minis.length;
    const keep = new Map(this.minis.map((m) => [m.key, m]));
    const next: Mini[] = [];
    for (const m of models) {
      let mini = keep.get(m.key);
      if (!mini) {
        const g = new Graphics();
        const label = new Text({ text: m.name, style: { fontFamily: FONT, fontSize: 11, fontWeight: "700", fill: COLORS.text } });
        label.anchor.set(0, 1);
        const pendingLabel = new Text({ text: "", style: { fontFamily: FONT, fontSize: 11, fontWeight: "700", fill: COLORS.danger } });
        pendingLabel.anchor.set(1, 1);
        this.miniLayer.addChild(g, label, pendingLabel);
        mini = { ...m, g, label, pendingLabel, flash: 0, shake: 0, x: 0, y: 0, cell: 8 };
      } else {
        const changed = mini.cells !== m.cells;
        Object.assign(mini, m);
        if (changed) mini.flash = Math.max(mini.flash, 0.001);
      }
      keep.delete(m.key);
      next.push(mini);
    }
    for (const gone of keep.values()) {
      gone.g.destroy();
      gone.label.destroy();
      gone.pendingLabel.destroy();
    }
    this.minis = next;
    if (next.length !== before) this.layout();
    else this.drawMinis();
  }

  private layoutMinis(w: number, h: number): void {
    const n = this.minis.length;
    if (n === 0) return;
    const left = this.ox + this.width * this.cell + this.pad * 2 + 6;
    const avail = Math.max(10, w - left - this.pad);
    const perRow = Math.max(1, Math.min(n, Math.floor(avail / (this.width * 9))));
    const rowsN = Math.ceil(n / perRow);
    const gap = 8;
    let mc = Math.floor(Math.min((avail - (perRow - 1) * gap) / perRow / this.width, (h - this.pad * 2 - rowsN * 18) / rowsN / (this.height + 0.3), this.cell * 0.6));
    mc = Math.max(5, mc);
    const bw = mc * this.width;
    const bh = mc * this.height;
    const totalH = rowsN * (bh + 18) + (rowsN - 1) * gap;
    const y0 = Math.max(this.pad, Math.floor((h - totalH) / 2)) + 16;
    this.minis.forEach((m, i) => {
      const r = Math.floor(i / perRow);
      const c = i % perRow;
      const rowCount = Math.min(perRow, n - r * perRow);
      const rowW = rowCount * bw + (rowCount - 1) * gap;
      m.x = left + Math.floor((avail - rowW) / 2) + c * (bw + gap);
      m.y = y0 + r * (bh + 18 + gap);
      m.cell = mc;
      m.label.style.fontSize = Math.max(9, Math.min(12, mc * 1.4));
      m.pendingLabel.style.fontSize = m.label.style.fontSize;
      m.label.position.set(m.x, m.y - 2);
      m.pendingLabel.position.set(m.x + bw, m.y - 2);
    });
    this.drawMinis();
  }

  private drawMinis(): void {
    for (const m of this.minis) {
      const g = m.g;
      const s = m.cell;
      const W = s * this.width;
      const H = s * this.height;
      g.clear();
      g.position.set(m.x, m.y);
      g.roundRect(-3, -3, W + 6, H + 6, 5).fill({ color: m.side === 1 ? 0x3a1a1a : 0x1f2a1f });
      g.roundRect(-3, -3, W + 6, H + 6, 5).stroke({ width: 1, color: m.side === 1 ? COLORS.danger : COLORS.good, alpha: 0.5 });
      g.rect(0, 0, W, H).fill({ color: COLORS.deckBottom });
      const sc = swordfightSpawnCol({ width: this.width } as SwordfightConfig);
      g.rect(sc * s, 0, s, s).fill({ color: COLORS.danger, alpha: 0.12 });
      // Slabs read as one block in a snapshot too: adjacent cells of one color in a rectangle are drawn without seams.
      const rows = m.cells.length === this.width * this.height ? m.cells : "";
      for (let r = 0; r < this.height; r++) {
        for (let c = 0; c < this.width; c++) {
          const ch = rows[r * this.width + c] ?? ".";
          if (ch === ".") continue;
          const x = c * s;
          const y = r * s;
          if (ch === "#") {
            g.roundRect(x + 0.5, y + 0.5, s - 1, s - 1, s * 0.15).fill({ color: WRACK_COLOR });
            continue;
          }
          const breaker = ch >= "A" && ch <= "F";
          const color = breaker ? ch.charCodeAt(0) - 65 : Number(ch);
          const fill = this.colorOf(color);
          const same = (cc: number, rr: number): boolean => rr >= 0 && rr < this.height && cc >= 0 && cc < this.width && rows[rr * this.width + cc] === ch && !breaker;
          const l = same(c - 1, r) ? 0 : 0.5;
          const t = same(c, r - 1) ? 0 : 0.5;
          const rgt = same(c + 1, r) ? 0 : 0.5;
          const btm = same(c, r + 1) ? 0 : 0.5;
          g.rect(x + l, y + t, s - l - rgt, s - t - btm).fill({ color: breaker ? mix(fill, 0x000000, 0.15) : fill });
          if (breaker) {
            g.moveTo(x + s * 0.2, y + s * 0.8).lineTo(x + s * 0.8, y + s * 0.2).stroke({ width: Math.max(1, s * 0.18), color: COLORS.bone, alpha: 0.95 });
          } else if (this.showMarks && s >= 9) {
            drawMark(g, x + s / 2, y + s / 2, s * 0.25, this.styles[color]?.mark ?? "circle", fill);
          }
        }
      }
      if (m.flash > 0) g.rect(0, 0, W, H).fill({ color: 0xffffff, alpha: Math.min(0.5, m.flash * 0.5) });
      if (m.out) {
        g.rect(0, 0, W, H).fill({ color: 0x000000, alpha: 0.6 });
        g.moveTo(W * 0.25, H * 0.42).lineTo(W * 0.75, H * 0.58).moveTo(W * 0.75, H * 0.42).lineTo(W * 0.25, H * 0.58).stroke({ width: Math.max(2, s * 0.3), color: COLORS.danger });
      }
      m.label.text = m.name;
      m.pendingLabel.text = m.pending > 0 ? `+${m.pending}` : "";
    }
  }

  // ---- fx

  private popup(x: number, y: number, text: string, color: number): void {
    const t = new Text({ text, style: { fontFamily: DISPLAY, fontSize: Math.max(12, this.cell * 0.5), fontWeight: "700", fill: color, stroke: { color: 0x000000, width: 3 } } });
    t.anchor.set(0.5);
    t.position.set(x, y);
    this.fxLayer.addChild(t);
    this.popups.push({ t, life: 0, max: this.reduced ? 300 : 700, y0: y });
  }

  private callout(text: string, color: number): void {
    const t = new Text({ text, style: { fontFamily: DISPLAY, fontSize: Math.max(16, this.cell * 0.75), fontWeight: "900", fill: color, stroke: { color: 0x000000, width: 4 }, letterSpacing: 1 } });
    t.anchor.set(0.5);
    t.position.set((this.width * this.cell) / 2, this.height * this.cell * 0.35);
    this.fxLayer.addChild(t);
    this.popups.push({ t, life: 0, max: this.reduced ? 400 : 900, y0: t.y });
  }

  private burst(x: number, y: number, color: number, n: number): void {
    if (this.reduced) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = this.cell * (0.004 + Math.random() * 0.008);
      this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - this.cell * 0.004, r: this.cell * (0.06 + Math.random() * 0.1), color: Math.random() < 0.3 ? 0xffffff : color, life: 0, max: 400 + Math.random() * 300 });
    }
  }

  /** Blocks of wrack flying from one place to another, in board coordinates. */
  private fly(x0: number, y0: number, x1: number, y1: number, color: number, n: number): void {
    if (this.reduced) return;
    for (let i = 0; i < n; i++) {
      const jx = (Math.random() - 0.5) * this.cell;
      const jy = (Math.random() - 0.5) * this.cell;
      this.particles.push({ x: x0 + jx, y: y0 + jy, vx: 0, vy: 0, r: this.cell * 0.14, color, life: -i * 30, max: 520, to: { x: x1 + jx * 0.4, y: y1 + jy * 0.4 } });
    }
  }

  // ---- per frame

  private tick(dt: number): void {
    this.time += dt;
    this.runSteps(dt);
    this.movePieces(dt);
    this.moveFx(dt);
    this.fall(dt);
    this.drawShake();
    if (this.pendingShown > 0) this.drawWarn();
    this.watch(dt);
    let miniDirty = false;
    for (const m of this.minis) {
      if (m.flash > 0) {
        m.flash = Math.max(0, m.flash - dt / 220);
        miniDirty = true;
      }
      if (m.shake > 0) {
        m.shake = Math.max(0, m.shake - dt / 400);
        m.g.position.set(m.x + (Math.random() - 0.5) * m.shake * 6, m.y + (Math.random() - 0.5) * m.shake * 6);
        if (m.shake === 0) m.g.position.set(m.x, m.y);
      }
    }
    if (miniDirty) this.drawMinis();
    if (this.framePending && this.steps.length === 0 && !this.moving) {
      this.framePending = false;
      this.cb.onFrame();
    }
    if (this.viewStale && this.steps.length === 0 && !this.moving) this.publishView();
  }

  /**
   * Nothing on screen may ever leave the player without a pair: if one is due and missing for long,
   * deal it; if a taken pair has waited too long for its state, let it be asked for again.
   */
  private watch(dt: number): void {
    const s = this.state;
    if (!s || !s.config.player || !this.interactive || s.finished || s.boards[0]!.out || this.steps.length > 0) {
      this.idleMs = 0;
      return;
    }
    const f = this.falling;
    if (!f) {
      this.idleMs += dt;
      if (this.idleMs > 700) {
        this.idleMs = 0;
        this.cells = s.boards[0]!.cells.slice();
        this.shownSlabs = s.boards[0]!.slabs.slice();
        this.place(false);
        this.spawnFalling();
      }
      return;
    }
    this.idleMs = 0;
    if (f.placed) {
      this.placedMs += dt;
      if (this.placedMs > 1500) {
        f.placed = false;
        f.lock = 0;
        this.placedMs = 0;
      }
    } else this.placedMs = 0;
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
        this.waitSettle = 1;
        this.waitMs = 0;
        return;
      }
      this.waitMs = r;
    }
  }

  private movePieces(dt: number): void {
    let moving = false;
    const speed = this.reduced ? 1 : 0.02 * this.cell;
    const step = (v: { x: number; y: number; tx: number; ty: number }): boolean => {
      if (!Number.isFinite(v.tx) || !Number.isFinite(v.ty) || !Number.isFinite(v.x) || !Number.isFinite(v.y)) {
        v.x = Number.isFinite(v.tx) ? v.tx : 0;
        v.y = Number.isFinite(v.ty) ? v.ty : 0;
        return false;
      }
      if (v.y === v.ty && v.x === v.tx) return false;
      const d = speed * dt;
      v.y = v.y < v.ty ? Math.min(v.ty, v.y + d) : Math.max(v.ty, v.y - d);
      v.x = v.x < v.tx ? Math.min(v.tx, v.x + d) : Math.max(v.tx, v.x - d);
      return v.y !== v.ty || v.x !== v.tx;
    };
    for (const v of [...this.pieces.values()]) {
      if (v.dying !== null) {
        v.dying += dt;
        const k = Math.min(1, v.dying / DIE_MS);
        v.s.alpha = 1 - k;
        v.s.scale.set(1 + k * 0.4);
        if (k >= 1) this.kill(v);
        continue;
      }
      if (v.flash > 0) {
        v.flash = Math.max(0, v.flash - dt / 240);
        v.s.tint = mix(0xffffff, 0xffffff, 0);
        v.s.alpha = 1 - v.flash * 0.35;
      }
      if (step(v)) moving = true;
      v.s.position.set(v.x, v.y);
    }
    for (const v of [...this.slabs.values()]) {
      if (v.dying !== null) {
        v.dying += dt;
        const k = Math.min(1, v.dying / DIE_MS);
        v.s.alpha = 1 - k;
        if (k >= 1) this.killSlab(v);
        continue;
      }
      if (v.flash > 0) {
        v.flash = Math.max(0, v.flash - dt / 260);
        v.s.alpha = 1 - v.flash * 0.4;
      }
      if (step(v)) moving = true;
      v.s.position.set(v.x, v.y);
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
    const g = this.fxG;
    g.clear();
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.life += dt;
      if (p.life < 0) continue;
      const k = p.life / p.max;
      if (k >= 1) {
        this.particles.splice(i, 1);
        continue;
      }
      if (p.to) {
        const e = 1 - (1 - k) * (1 - k);
        const x = p.x + (p.to.x - p.x) * e;
        const y = p.y + (p.to.y - p.y) * e - Math.sin(k * Math.PI) * this.cell * 1.5;
        g.roundRect(x - p.r, y - p.r, p.r * 2, p.r * 2, p.r * 0.3).fill({ color: p.color, alpha: 0.9 });
      } else {
        p.vy += this.cell * 0.00002 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        g.circle(p.x, p.y, p.r * (1 - k * 0.5)).fill({ color: p.color, alpha: 1 - k });
      }
    }
  }

  private drawShake(): void {
    if (this.shake <= 0) {
      this.board.position.set(this.ox, this.oy);
      return;
    }
    this.shake = Math.max(0, this.shake - 0.04);
    const a = this.reduced ? 0 : this.shake * this.cell * 0.12;
    this.board.position.set(this.ox + (Math.random() - 0.5) * a, this.oy + (Math.random() - 0.5) * a);
  }

  /** Gravity on the falling pair; a short lock once it rests, then the engine is asked. */
  private fall(dt: number): void {
    const f = this.falling;
    if (!f || !this.interactive || this.steps.length || !this.state || f.placed) return;
    if (f.refused > 0) {
      // The engine said too soon: hold the pair where it rests and ask again shortly.
      f.refused -= dt;
      if (f.refused <= 0) this.commit();
      return;
    }
    const R = Math.ceil(f.row);
    if (!this.canDrop(f.pc, f.rot, R)) {
      f.row = R;
      f.lock += dt;
      this.positionFalling();
      if (f.lock >= LOCK_MS) this.commit();
      return;
    }
    const fallMs = this.state.config.fallTicks * this.state.config.tickMs;
    // Sliding in from above the well is quick; the fall proper starts once the pair is on the board.
    const entering = f.row > this.height - 1;
    const per = this.softDrop ? this.opts.softDropMs : entering ? fallMs / 5 : fallMs;
    f.row = Math.max(R - 1, f.row - dt / per);
    if (Math.ceil(f.row) < f.low) {
      f.low = Math.ceil(f.row);
      f.lock = 0;
      f.resets = 0;
    }
    this.positionFalling();
  }

  /** Mirrors what the canvas shows, for the smoke test: the player's board as drawn. */
  private publishView(): void {
    this.viewStale = false;
    if (!this.state) return;
    const cfg = this.state.config;
    const chars: string[] = new Array<string>(this.width * this.height).fill(".");
    for (const v of this.pieces.values()) {
      if (v.dying !== null) continue;
      const col = Math.round(v.tx / this.cell - 0.5);
      const row = this.height - 1 - Math.round(v.ty / this.cell - 0.5);
      if (col < 0 || col >= this.width || row < 0 || row >= this.height) continue;
      chars[row * this.width + col] = v.kind === "wrack" ? "#" : v.kind === "breaker" ? String.fromCharCode(65 + v.color) : String(v.color);
    }
    for (const v of this.slabs.values()) {
      if (v.dying !== null) continue;
      const col0 = Math.round(v.tx / this.cell);
      const rowTop = this.height - Math.round(v.ty / this.cell) - v.h;
      for (let r = 0; r < v.h; r++) for (let c = 0; c < v.w; c++) chars[(rowTop + r) * this.width + col0 + c] = String(v.color);
    }
    let out = "";
    for (let r = cfg.height - 1; r >= 0; r--) for (let c = 0; c < cfg.width; c++) out += chars[r * this.width + c];
    this.app.canvas.setAttribute("data-view", out);
  }

  // ---- input

  private pointerDown(e: FederatedPointerEvent): void {
    if (!this.interactive || !this.falling) return;
    this.drag = { x: e.global.x, y: e.global.y, pc: this.falling.pc, moved: false, hurried: false };
  }

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
    if (d.hurried) return;
    const want = d.pc + Math.round(dx / this.cell);
    while (f.pc < want) {
      const before = f.pc;
      this.tryMove(1);
      d.moved = true;
      if (f.pc === before) break;
    }
    while (f.pc > want) {
      const before = f.pc;
      this.tryMove(-1);
      d.moved = true;
      if (f.pc === before) break;
    }
  }

  private pointerUp(e: FederatedPointerEvent): void {
    const d = this.drag;
    this.drag = null;
    this.softDrop = false;
    if (!d || !this.falling || d.hurried) return;
    const dx = e.global.x - d.x;
    const dy = e.global.y - d.y;
    if (!d.moved && Math.abs(dx) < this.cell * 0.4 && Math.abs(dy) < this.cell * 0.4) this.tryRotate(1);
  }

  private pointerCancel(): void {
    this.drag = null;
    this.softDrop = false;
  }

  /** Keyboard: left and right steer, up and X turn clockwise, down and Z the other way, space hurries while held. */
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
