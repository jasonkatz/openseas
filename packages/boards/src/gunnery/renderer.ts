import { sfx, soundsFor } from "../audio.js";
import { Application, CanvasSource, Container, Graphics, Sprite, Text, Texture, type FederatedPointerEvent } from "pixi.js";
import {
  DX,
  DY,
  turretNeeds,
  gunneryCellAt,
  parseGunneryDeck,
  predictGunneryPath,
  gunneryNextHeading,
  type Arrow,
  type TurretOutcome,
  type Dir,
  type GunneryEvent,
  type GunneryPredictedPath,
  type GunneryState,
  type ParsedDeck,
} from "@openseas/engine";
import type { GunneryContent } from "@openseas/content";
import { gunneryPieceCanvas } from "./pieces.js";
import { boardSurface } from "../surface.js";
import { FONT, MOTION, blend, ink } from "../look/tokens.js";

export interface GunneryCallbacks {
  /** The player laid an arrow (`dir` set) or lifted one (`dir` null) on a deck cell. */
  onArrow(col: number, row: number, dir: Dir | null): void;
  /** First frame drawn after a new state arrived. */
  onFrame(): void;
  /** Events newer than anything shown before, in tick order, for sound and callouts. */
  onEvents(events: readonly GunneryEvent[]): void;
}

export interface GunneryRendererOptions {
  tickMs: number;
  labels: { jammed: string; clean: string; next: string; broadside: string };
}

interface PieceView {
  s: Sprite;
  kind: number;
  fx: number;
  fy: number;
  tx: number;
  ty: number;
  /** 0..1 progress from (fx,fy) to (tx,ty). */
  k: number;
  /** Heading it last rolled in. */
  dir: Dir;
  /** The way it will roll next (turns at rails and arrows included), for the chevron. */
  next: Dir;
  /** ms since the piece left the deck; it slides to `exit` and shrinks to nothing. */
  dying: number | null;
  exit: { x: number; y: number } | null;
}

interface Popup {
  t: Text;
  life: number;
  max: number;
  y0: number;
  rise: number;
}

/** The arrow the pointer would lay (or lift) right now. */
interface Ghost {
  col: number;
  row: number;
  dir: Dir;
  lift: boolean;
}

/** Every colour the board draws, from the game's one palette (docs/BRAND.md section 2). */
const COLORS = {
  ground: ink("ground"),
  // The rails and the crates: whatever turns a piece.
  wall: ink("raised"),
  line: ink("line"),
  cream: ink("cream"),
  dim: ink("dim"),
  // The player's own: the arrows they laid, the one they are about to, the cursor, and the beat.
  amber: ink("amber"),
  // Bad: a route that will jam, and a jammed turret.
  danger: ink("danger"),
  jam: blend("ground", "danger", 0.3),
};
const DIE_MS = MOTION.clear;
const BEAT_MS = MOTION.beat;
/** Height of the queue strip above the deck, and the gap between the two, in cells. */
const QUEUE_STRIP = 0.75;
const QUEUE_GAP = 0.15;
/** How far a turret's barrel pokes out past the rail, in cells. */
const MUZZLE = 0.28;
/** How many cells ahead the lane preview looks. */
const LOOK_AHEAD = 12;

const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

/** One string that names what the deck shows: pieces by cell, turret states, arrows, the tick. Shared with the page. */
export function gunneryViewString(state: GunneryState): string {
  const pieces = [...state.pieces].sort((a, b) => a.id - b.id).map((p) => `${p.id}:${p.kind}:${p.col}:${p.row}`);
  const turrets = state.turrets.map((c) => `${c.loaded}${c.jammed ? "f" : ""}`);
  const arrows = [...state.arrows].sort((a, b) => a.row - b.row || a.col - b.col).map((a) => `${a.col}.${a.row}.${a.dir}`);
  return `t${state.tick}|${pieces.join(",")}|${turrets.join(",")}|${arrows.join(",")}`;
}

/** The arrows on deck if `ghost` were laid or lifted. */
function arrowsWith(arrows: readonly Arrow[], ghost: Ghost | null): readonly Arrow[] {
  if (!ghost) return arrows;
  const kept = arrows.filter((a) => a.col !== ghost.col || a.row !== ghost.row);
  return ghost.lift ? kept : [...kept, { col: ghost.col, row: ghost.row, dir: ghost.dir }];
}

/** Which way a point inside a cell leans: toward the nearest edge. */
function leanOf(fx: number, fy: number): Dir {
  const dx = fx - 0.5;
  const dy = fy - 0.5;
  return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 0 : 2) : dy >= 0 ? 1 : 3;
}

const isGood = (o: TurretOutcome): boolean => o === "load" || o === "loaded" || o === "clean";

/** Two touch taps on one cell within this long lift its arrow. */
const DOUBLE_TAP_MS = 350;

export class GunneryRenderer {
  readonly app = new Application();
  private readonly board = new Container();
  private readonly staticLayer = new Container();
  private readonly deckG = new Graphics();
  private readonly hoverG = new Graphics();
  private readonly pathG = new Graphics();
  private readonly arrowG = new Graphics();
  private readonly turretG = new Graphics();
  private readonly needLayer = new Container();
  private readonly turretFxG = new Graphics();
  private readonly queueLayer = new Container();
  private readonly pieceLayer = new Container();
  private readonly headG = new Graphics();
  private readonly ghostG = new Graphics();
  private readonly cursorG = new Graphics();
  private readonly beatLayer = new Graphics();
  private readonly textLayer = new Container();
  private readonly pieces = new Map<number, PieceView>();
  private readonly popups: Popup[] = [];
  private readonly textures = new Map<number, Texture>();
  private readonly styles: GunneryContent["pieces"];
  private readonly reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  private cell = 40;
  private width = 9;
  private height = 11;
  private origin = { x: 0, y: 0 };
  /** The round's deck; it never changes within a round, so it is painted once per round and per layout. */
  private deck: ParsedDeck;
  private state: GunneryState | null = null;
  private lastEventTick = -1;
  private interactive = false;
  private framePending = false;
  private destroyed = false;
  /** The beat: one amber pulse of the whole board for a big moment (docs/BRAND.md section 6). */
  private beatNow: { life: number; strength: number } | null = null;
  private cursor: { col: number; row: number } | null = null;
  private hover: { col: number; row: number; fx: number; fy: number } | null = null;
  /** The last finished touch tap, so a second one on the same cell soon after lifts its arrow. */
  private lastTap: { col: number; row: number; at: number } | null = null;
  private press: { x: number; y: number; col: number; row: number; touch: boolean; dragged: boolean; dir: Dir } | null = null;
  private ghost: Ghost | null = null;
  private paths: Array<{ id: number; kind: number; path: GunneryPredictedPath }> = [];
  /** For each turret, what the soonest piece headed into it will do, and in how many ticks. */
  private incoming: Array<{ outcome: TurretOutcome; eta: number; kind: number } | null> = [];
  private needSprites: Sprite[] = [];
  private queueSprites: Sprite[] = [];
  private nextLabel: Text | null = null;
  /** Per turret: ms since it last fired, for the barrel's kick and its charge leaving. */
  private readonly fired: number[] = [];

  constructor(
    private readonly host: HTMLElement,
    content: GunneryContent,
    private readonly cb: GunneryCallbacks,
    private readonly opts: GunneryRendererOptions,
  ) {
    this.styles = content.pieces;
    // Every deck is the same size; the round's own deck replaces this one when its first state arrives.
    this.deck = parseGunneryDeck(content.config.decks[0]!);
    this.width = this.deck.width;
    this.height = this.deck.height;
  }

  /** This puzzle's picked samples play while the board is open (ADR 0041). */
  private readonly releaseSounds = soundsFor("gunnery");

  async init(): Promise<void> {
    await this.app.init({
      resizeTo: this.host,
      backgroundAlpha: 0,
      ...boardSurface(),
      autoDensity: true,
      preference: "webgl",
    });
    // Points and callouts are drawn as text, so wait (briefly) for the webfont.
    await Promise.race([document.fonts?.ready, new Promise((r) => window.setTimeout(r, 800))]).catch(() => undefined);
    if (this.destroyed) {
      this.app.destroy(true);
      return;
    }
    // No atlas to wait for: the pieces are drawn in code (ADR 0062). The studio's thumbnails read this.
    this.app.canvas.dataset.pieces = "drawn";
    this.app.canvas.style.touchAction = "none";
    this.app.canvas.setAttribute("data-testid", "gunnery-canvas");
    this.app.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    this.app.canvas.addEventListener("pointerleave", () => {
      this.hover = null;
      if (!this.press) this.setGhost(null);
      this.drawHover();
    });
    this.host.appendChild(this.app.canvas);
    this.staticLayer.addChild(this.deckG);
    this.staticLayer.cacheAsTexture({ resolution: this.app.renderer.resolution, antialias: true });
    for (let i = 0; i < this.deck.turrets.length; i++) {
      const s = new Sprite(Texture.WHITE);
      s.anchor.set(0.5);
      this.needLayer.addChild(s);
      this.needSprites.push(s);
    }
    this.board.addChild(
      this.staticLayer,
      this.hoverG,
      this.pathG,
      this.arrowG,
      this.turretG,
      this.needLayer,
      this.turretFxG,
      this.queueLayer,
      this.pieceLayer,
      this.headG,
      this.ghostG,
      this.cursorG,
      this.beatLayer,
      this.textLayer,
    );
    this.app.stage.addChild(this.board);
    this.app.stage.eventMode = "static";
    this.app.stage.hitArea = this.app.screen;
    this.app.stage.on("pointerdown", (e) => this.pointerDown(e));
    this.app.stage.on("pointermove", (e) => this.pointerMove(e));
    this.app.stage.on("pointerup", (e) => this.pointerUp(e));
    this.app.stage.on("pointerupoutside", () => {
      this.press = null;
      this.setGhost(null);
    });
    this.app.renderer.on("resize", () => this.layout());
    this.app.ticker.add((ticker) => this.tick(Math.min(50, ticker.deltaMS)));
    this.layout();
  }

  destroy(): void {
    this.destroyed = true;
    this.releaseSounds();
    if (this.app.renderer) {
      this.app.destroy(true, { children: true });
      for (const tex of this.textures.values()) tex.destroy(true);
    }
  }

  setInteractive(on: boolean): void {
    this.interactive = on;
    if (!on) {
      this.press = null;
      this.cursor = null;
      this.hover = null;
      this.setGhost(null);
      this.drawCursor();
    }
  }

  /** A new displayed state, usually one tick on. Pieces glide to their new cells over tickMs. */
  setState(state: GunneryState): void {
    if (!this.app.renderer) return;
    const reset = !this.state || state.tick < this.state.tick || state.deck !== this.state.deck;
    const comboBefore = this.state?.combo ?? 0;
    if (state.deckIndex !== this.state?.deckIndex || !this.state) {
      // A round on a different deck: repaint the rails, crates, hatches and turret ports.
      this.deck = state.deck;
      this.drawDeck();
    }
    this.state = state;
    this.framePending = true;
    if (reset) {
      this.lastEventTick = state.tick;
      for (const v of this.pieces.values()) v.s.destroy();
      this.pieces.clear();
      this.fired.length = 0;
      this.beatNow = null;
    }

    const fresh = (state.lastMove?.events ?? []).filter((e) => e.tick > this.lastEventTick);
    // Where pieces that left the deck went, so they slide into a turret or over the side.
    const exits = new Map<number, { x: number; y: number }>();
    for (const e of fresh) {
      if (e.pieceId === undefined) continue;
      if (e.turret !== undefined) {
        const c = state.turrets[e.turret]!;
        exits.set(e.pieceId, { x: this.cx(c.col), y: this.cy(c.row) });
      } else if (e.type === "exit" && e.col !== undefined && e.row !== undefined) {
        // Into the hatch it really went through: a wall may have turned it on its last step.
        exits.set(e.pieceId, { x: this.cx(e.col), y: this.cy(e.row) });
      }
    }

    const seen = new Set<number>();
    const { barrel } = state.deck;
    for (const p of state.pieces) {
      seen.add(p.id);
      const x = this.cx(p.col);
      const y = this.cy(p.row);
      let v = this.pieces.get(p.id);
      if (!v) {
        const s = new Sprite(this.textures.get(p.kind) ?? Texture.WHITE);
        s.anchor.set(0.5);
        const bx = this.cx(barrel.col);
        const by = this.cy(barrel.row);
        s.position.set(bx, by);
        s.scale.set(0.5);
        this.pieceLayer.addChild(s);
        v = { s, kind: p.kind, fx: bx, fy: by, tx: x, ty: y, k: 0, dir: p.dir, next: p.dir, dying: null, exit: null };
        this.pieces.set(p.id, v);
      } else if (v.tx !== x || v.ty !== y) {
        v.fx = v.s.x;
        v.fy = v.s.y;
        v.tx = x;
        v.ty = y;
        v.k = 0;
      }
      v.dir = p.dir;
      if (reset) {
        v.k = 1;
        v.s.position.set(x, y);
        v.s.scale.set(1);
      }
    }
    for (const [id, v] of this.pieces) {
      if (seen.has(id) || v.dying !== null) continue;
      v.dying = 0;
      v.fx = v.s.x;
      v.fy = v.s.y;
      v.exit = exits.get(id) ?? null;
    }

    if (fresh.length) {
      this.lastEventTick = Math.max(...fresh.map((e) => e.tick));
      for (const e of fresh) this.eventFx(state, e);
      // The combo meter filling is the other thing worth the beat; a broadside in the same tick outranks it.
      const cap = state.config.comboCap;
      if (cap > 0 && comboBefore < cap && state.combo >= cap) this.beat(0.5);
      this.cb.onEvents(fresh);
    }
    this.refreshPreview();
    this.drawArrows();
    this.drawQueue();
    this.app.canvas.setAttribute("data-view", gunneryViewString(state));
  }

  /**
   * What an event shows. Points pop where they were scored, a jam and a flush are named, and a shot
   * is the turret's charge leaving and its barrel kicking back. A broadside is the beat.
   */
  private eventFx(state: GunneryState, e: GunneryEvent): void {
    const s = this.cell;
    if (e.type === "broadside") {
      // Every turret has fired since the last one: the puzzle's compound move.
      this.beat(1);
      const mx = (this.width * s) / 2;
      const my = this.height * s * 0.42;
      this.word(mx, my, this.opts.labels.broadside, COLORS.cream, 0.8);
      this.points(mx, my + s * 0.95, e.points ?? 0, 0.6);
      return;
    }
    if (e.turret === undefined) return;
    const i = e.turret;
    const c = state.turrets[i]!;
    // Callouts sit on the deck beside the turret, never over it.
    const x = this.cx(c.col) + (c.col === 0 ? 1 : -1) * s * 1.3;
    const y = this.cy(c.row);
    switch (e.type) {
      case "load":
        this.points(x, y, e.points ?? 0, 0.4);
        break;
      case "loaded":
        this.points(x, y, e.points ?? 0, 0.52);
        break;
      case "fire":
        this.fired[i] = 0;
        break;
      case "jam":
        this.word(x, y, this.opts.labels.jammed, COLORS.danger, 0.44);
        break;
      case "clean":
        this.word(x, y, this.opts.labels.clean, COLORS.cream, 0.44);
        break;
      default:
        break;
    }
  }

  /** Ask for the beat. A stronger moment while one is playing takes it over; it never stacks. */
  private beat(strength: number): void {
    // The pulse and its sound are asked for together, so they cannot drift apart.
    sfx.beat(strength);
    this.beatNow = { life: 0, strength: Math.max(strength, this.beatNow?.strength ?? 0) };
  }

  // ---- preview

  private setGhost(g: Ghost | null): void {
    const same = g === this.ghost || (g && this.ghost && g.col === this.ghost.col && g.row === this.ghost.row && g.dir === this.ghost.dir && g.lift === this.ghost.lift);
    if (same) return;
    this.ghost = g;
    this.refreshPreview();
    this.drawArrows();
  }

  /** Lanes for every piece over the arrows as they would be with the ghost laid, and what each turret has coming. */
  private refreshPreview(): void {
    const s = this.state;
    this.paths = [];
    this.incoming = [];
    if (!s) return;
    const arrows = arrowsWith(s.arrows, this.interactive ? this.ghost : null);
    for (const p of s.pieces) {
      const path = predictGunneryPath(s, p, LOOK_AHEAD, arrows);
      const v = this.pieces.get(p.id);
      if (v) v.next = gunneryNextHeading(s, p, arrows) ?? p.dir;
      this.paths.push({ id: p.id, kind: p.kind, path });
      if (path.end?.type === "turret") {
        const eta = path.cells.length + 1;
        const cur = this.incoming[path.end.turret];
        if (!cur || eta < cur.eta) this.incoming[path.end.turret] = { outcome: path.end.outcome, eta, kind: p.kind };
      }
    }
    this.drawPaths();
  }

  // ---- drawing

  private layout(): void {
    if (!this.app.renderer) return;
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    // Nothing frames the deck: it gets all of the screen but the queue above it and the barrels poking out of its sides.
    const above = QUEUE_STRIP + QUEUE_GAP;
    this.cell = Math.max(12, Math.floor(Math.min((w - 2) / (this.width + MUZZLE * 2), (h - 2) / (this.height + above))));
    const W = this.cell * this.width;
    const H = this.cell * this.height;
    this.origin = { x: Math.floor((w - W) / 2), y: Math.floor((h - H - this.cell * above) / 2 + this.cell * above) };
    this.board.pivot.set(W / 2, H / 2);
    this.board.position.set(this.origin.x + W / 2, this.origin.y + H / 2);
    // Where the grid sits on the canvas, for tests that tap a cell.
    this.app.canvas.setAttribute("data-geom", `${this.origin.x},${this.origin.y},${this.cell}`);
    this.drawDeck();
    this.bake();
    this.layoutQueue();
    this.refreshPreview();
    this.drawArrows();
    this.drawCursor();
    this.drawHover();
    if (this.state) {
      for (const p of this.state.pieces) {
        const v = this.pieces.get(p.id);
        if (!v) continue;
        v.tx = this.cx(p.col);
        v.ty = this.cy(p.row);
        v.fx = v.tx;
        v.fy = v.ty;
        v.k = 1;
        v.s.position.set(v.tx, v.ty);
      }
      this.drawQueue();
    }
  }

  /**
   * Everything that never changes in a round, in flat colours: bare ground with one hairline round
   * it, the rails and crates that turn a piece, a dot on every tile an arrow can lie on, the feeder
   * and the turrets' ports, and the hatches, which are gaps in the rail (docs/BRAND.md section 3).
   */
  private drawDeck(): void {
    const g = this.deckG;
    const s = this.cell;
    const W = this.width * s;
    const H = this.height * s;
    g.clear();
    // The ground is painted, not left clear, so the board is whole wherever it is shown (a thumbnail, a capture).
    g.rect(0, 0, W, H).fill(COLORS.ground).rect(-0.5, -0.5, W + 1, H + 1).stroke({ width: 1, color: COLORS.line });
    const deck = this.deck;
    const socket = (x: number, y: number): void => {
      g.roundRect(x + s * 0.08, y + s * 0.08, s * 0.84, s * 0.84, s * 0.2).fill(COLORS.ground);
    };
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        const x = col * s;
        const y = row * s;
        switch (gunneryCellAt(deck, col, row)) {
          case "deck":
            g.circle(x + s / 2, y + s / 2, Math.max(1.5, s * 0.045)).fill(COLORS.line);
            break;
          case "wall":
            g.rect(x, y, s, s).fill(COLORS.wall);
            break;
          case "crate":
            g.roundRect(x + s * 0.08, y + s * 0.08, s * 0.84, s * 0.84, s * 0.2).fill(COLORS.wall);
            break;
          case "barrel":
            // The feeder: a port in the rail with a chevron for the way pieces drop.
            g.rect(x, y, s, s).fill(COLORS.wall);
            socket(x, y);
            drawChevron(g, x + s / 2, y + s / 2, s * 0.16, deck.drop.dir, COLORS.dim, Math.max(2, s * 0.08));
            break;
          case "hatch": {
            // A gap in the rail, open to space: the hairline breaks there, and a chevron points the way out.
            const out: Dir = row === 0 ? 3 : row === this.height - 1 ? 1 : col === 0 ? 2 : 0;
            g.rect(x + DX[out]! * 2, y + DY[out]! * 2, s, s).fill(COLORS.ground);
            drawChevron(g, x + s / 2, y + s / 2, s * 0.16, out, COLORS.line, Math.max(2, s * 0.08));
            break;
          }
          case "turret":
            // The port only: the turret is drawn live, with what it wants and what it holds.
            g.rect(x, y, s, s).fill(COLORS.wall);
            socket(x, y);
            break;
        }
      }
    }
    this.staticLayer.updateCacheTexture();
  }

  /**
   * Routes only for pieces headed into a turret: cream dots when the turret wants the piece (or
   * coolant for a jammed one), danger crosses when it will jam it, so the two differ by shape as
   * well as colour. Everything else is left plain; the heading chevron on each piece is enough there.
   */
  private drawPaths(): void {
    const g = this.pathG;
    g.clear();
    if (!this.state) return;
    const s = this.cell;
    for (const { path } of this.paths) {
      if (path.end?.type !== "turret" || path.end.outcome === "splash" || path.end.outcome === "blocked") continue;
      const good = isGood(path.end.outcome);
      for (const c of path.cells) {
        const x = this.cx(c.col);
        const y = this.cy(c.row);
        if (good) g.circle(x, y, s * 0.1).fill(COLORS.cream);
        else {
          const r = s * 0.11;
          g.moveTo(x - r, y - r).lineTo(x + r, y + r).moveTo(x + r, y - r).lineTo(x - r, y + r).stroke({ width: Math.max(2, s * 0.08), color: COLORS.danger, cap: "round" });
        }
      }
    }
  }

  /** The arrows are the player's own, so they are amber: laid ones solid, the one the pointer would lay fainter. */
  private drawArrows(): void {
    const g = this.arrowG;
    g.clear();
    this.ghostG.clear();
    if (!this.state) return;
    const s = this.cell;
    for (const a of this.state.arrows) {
      // An arrow the pointer would lift or turn goes faint, to show the deck without it.
      const going = this.interactive && this.ghost && this.ghost.col === a.col && this.ghost.row === a.row;
      drawArrowGlyph(g, this.cx(a.col), this.cy(a.row), s * 0.3, a.dir, COLORS.amber, going ? 0.3 : 1);
    }
    const gh = this.interactive ? this.ghost : null;
    if (gh && !gh.lift) drawArrowGlyph(this.ghostG, this.cx(gh.col), this.cy(gh.row), s * 0.3, gh.dir, COLORS.amber, 0.6);
  }

  /** The turrets: barrel, what each wants or holds, its lamp, its load, and a ring for what is headed its way. Redrawn every frame. */
  private drawTurrets(): void {
    const g = this.turretG;
    const fx = this.turretFxG;
    g.clear();
    fx.clear();
    if (!this.state) return;
    const s = this.cell;
    const W = this.width * s;
    this.state.turrets.forEach((c, i) => {
      const x = c.col * s;
      const y = c.row * s;
      const cx = x + s / 2;
      const cy = y + s / 2;
      const outward = c.col === 0 ? -1 : 1;
      const since = this.fired[i] ?? Infinity;

      // The barrel pokes out through the rail. A shot kicks it back, and it eases home.
      const kick = this.reduced ? 0 : (1 - easeOutCubic(Math.min(1, since / MOTION.move))) * s * 0.1;
      const left = (outward > 0 ? W - s * 0.1 : -s * MUZZLE) - outward * kick;
      g.roundRect(left, cy - s * 0.11, s * (MUZZLE + 0.1), s * 0.22, s * 0.08).fill(c.jammed ? COLORS.danger : COLORS.dim);

      const port = { x: x + s * 0.08, y: y + s * 0.08, w: s * 0.84, r: s * 0.2 };
      if (c.jammed) g.roundRect(port.x, port.y, port.w, port.w, port.r).fill(COLORS.jam);

      // In the port: the piece this turret wants next, or its charge once it is full.
      const need = turretNeeds(c);
      const sprite = this.needSprites[i]!;
      sprite.visible = need !== null;
      if (need !== null) {
        sprite.texture = this.textures.get(need) ?? Texture.WHITE;
        sprite.position.set(cx, cy);
        sprite.scale.set(0.62);
      }
      // A full turret holds a cream charge until it fires; the shot is the charge shrinking to nothing.
      const leaving = this.reduced ? 1 : Math.min(1, since / MOTION.clear);
      const charge = c.firesAt !== null ? 1 : leaving < 1 ? 1 - easeOutCubic(leaving) : 0;
      if (charge > 0) {
        const h = s * 0.24 * charge;
        g.roundRect(cx - h, cy - h, h * 2, h * 2, h * 0.4).fill(COLORS.cream);
      }

      // The load, a bar of three in the rail below (above, where a hatch sits below), and the lamp on the other side.
      const below = gunneryCellAt(this.deck, c.col, c.row + 1) === "wall";
      const segW = s * 0.22;
      const segH = Math.max(3, s * 0.12);
      const gap = s * 0.06;
      const py = below ? y + s * 1.14 : y - s * 0.14 - segH;
      const px0 = x + (s - segW * 3 - gap * 2) / 2;
      for (let k = 0; k < 3; k++) g.roundRect(px0 + k * (segW + gap), py, segW, segH, segH / 2).fill(k < c.loaded ? COLORS.cream : COLORS.line);

      // The broadside lamp: a dot once the turret has fired since the last broadside, a ring until then.
      const ly = below ? y - s * 0.2 : y + s * 1.2;
      if (this.state?.firedSince[i]) g.circle(cx, ly, s * 0.1).fill(COLORS.cream);
      else g.circle(cx, ly, s * 0.085).stroke({ width: Math.max(1.5, s * 0.05), color: COLORS.line });

      // Something is on its way in: a cream ring if it is what the turret wants, a danger one if it will jam it.
      const inc = this.incoming[i];
      if (inc && inc.outcome !== "splash" && inc.outcome !== "blocked") {
        const near = Math.max(0, 1 - (inc.eta - 1) / LOOK_AHEAD);
        fx.roundRect(port.x, port.y, port.w, port.w, port.r).stroke({ width: Math.max(2, s * 0.06), color: isGood(inc.outcome) ? COLORS.cream : COLORS.danger, alpha: 0.45 + 0.55 * near });
      }
    });
  }

  /** The next pieces in the rail beside the feeder, soonest nearest. */
  private layoutQueue(): void {
    if (!this.state) return;
    const want = this.state.queue.length;
    while (this.queueSprites.length < want) {
      const sp = new Sprite(Texture.WHITE);
      sp.anchor.set(0.5);
      this.queueLayer.addChild(sp);
      this.queueSprites.push(sp);
    }
    if (!this.nextLabel) {
      this.nextLabel = new Text({ text: this.opts.labels.next, style: { fontFamily: FONT.body, fill: COLORS.dim, fontSize: 13 }, resolution: 2 });
      this.nextLabel.anchor.set(1, 0.5);
      this.queueLayer.addChild(this.nextLabel);
    }
    const { barrel } = this.deck;
    this.nextLabel.style.fontSize = Math.max(11, this.cell * 0.3);
    this.nextLabel.position.set(this.cx(barrel.col) - this.cell * 0.55, this.queueY());
  }

  /** Centre line of the queue strip above the deck. */
  private queueY(): number {
    return -this.cell * (QUEUE_GAP + QUEUE_STRIP / 2);
  }

  private drawQueue(): void {
    if (!this.state) return;
    if (this.queueSprites.length !== this.state.queue.length || !this.nextLabel) this.layoutQueue();
    const { barrel } = this.deck;
    this.state.queue.forEach((kind, i) => {
      const sp = this.queueSprites[i]!;
      sp.texture = this.textures.get(kind) ?? Texture.WHITE;
      // The next piece sits right above the feeder; the ones after it trail off to the right.
      sp.scale.set(i === 0 ? 0.86 : 0.66);
      sp.alpha = i === 0 ? 1 : 0.6;
      sp.position.set(this.cx(barrel.col) + i * this.cell * 0.8 + (i > 0 ? this.cell * 0.1 : 0), this.queueY());
    });
  }

  /** The keyboard's cursor: an amber ring round the tile. */
  private drawCursor(): void {
    const g = this.cursorG;
    g.clear();
    if (!this.cursor || !this.interactive) return;
    const s = this.cell;
    g.roundRect(this.cursor.col * s + 2, this.cursor.row * s + 2, s - 4, s - 4, s * 0.2).stroke({ width: Math.max(2, s * 0.06), color: COLORS.amber });
  }

  /** The tile under the pointer, raised a shade. */
  private drawHover(): void {
    const g = this.hoverG;
    g.clear();
    const h = this.press ?? this.hover;
    if (!h || !this.interactive || !this.isDeck(h.col, h.row)) return;
    const s = this.cell;
    g.roundRect(h.col * s + 2, h.row * s + 2, s - 4, s - 4, s * 0.2).fill(COLORS.wall);
  }

  /**
   * A chevron on each piece's leading edge pointing the way it will roll next (a turn at a rail or an
   * arrow shows before it happens).
   */
  private drawHeadings(): void {
    const g = this.headG;
    g.clear();
    const s = this.cell;
    for (const v of this.pieces.values()) {
      if (v.dying !== null) continue;
      const dx = DX[v.next]!;
      const dy = DY[v.next]!;
      const tip = s * 0.48;
      const back = s * 0.38;
      const w = s * 0.1;
      const x = v.s.x;
      const y = v.s.y;
      g.poly([x + dx * tip, y + dy * tip, x + dx * back - dy * w, y + dy * back + dx * w, x + dx * back + dy * w, y + dy * back - dx * w])
        .fill(COLORS.cream)
        .stroke({ width: Math.max(1, s * 0.04), color: COLORS.cream, join: "round" });
    }
  }

  /** Bake each kind's pictogram to a texture at the current size. */
  private bake(): void {
    const r = this.app.renderer;
    if (!r) return;
    const old = [...this.textures.values()];
    this.styles.forEach((style, kind) => {
      const canvas = gunneryPieceCanvas(this.cell, style.shape, style.color, r.resolution);
      this.textures.set(kind, new Texture({ source: new CanvasSource({ resource: canvas, resolution: r.resolution }) }));
    });
    for (const v of this.pieces.values()) v.s.texture = this.textures.get(v.kind) ?? Texture.WHITE;
    this.drawQueue();
    // The turrets' ports also hold baked piece textures; a resize can render before the next tick.
    this.drawTurrets();
    for (const tex of old) tex.destroy(true);
  }

  private cx(col: number): number {
    return (col + 0.5) * this.cell;
  }
  private cy(row: number): number {
    return (row + 0.5) * this.cell;
  }
  private local(x: number, y: number): { col: number; row: number; fx: number; fy: number } | null {
    const lx = (x - this.origin.x) / this.cell;
    const ly = (y - this.origin.y) / this.cell;
    const col = Math.floor(lx);
    const row = Math.floor(ly);
    if (col < 0 || col >= this.width || row < 0 || row >= this.height) return null;
    return { col, row, fx: lx - col, fy: ly - row };
  }

  /** Points scored, in the mono face, rising from where they were scored. */
  private points(x: number, y: number, n: number, size: number): void {
    this.popup(`+${n}`, x, y, FONT.mono, COLORS.cream, Math.max(14, this.cell * size));
  }

  /** A word for what just happened: a jam, a flush, a broadside. */
  private word(x: number, y: number, text: string, color: number, size: number): void {
    this.popup(text, x, y, FONT.body, color, Math.max(14, this.cell * size));
  }

  private popup(text: string, x: number, y: number, fontFamily: string, fill: number, fontSize: number): void {
    const t = new Text({
      text,
      // A ground edge keeps the text readable over any piece.
      style: { fontFamily, fontSize, fontWeight: "700", fill, stroke: { color: COLORS.ground, width: Math.max(3, fontSize * 0.2), join: "round" } },
      resolution: 2,
    });
    t.anchor.set(0.5);
    const margin = t.width / 2 + 4;
    t.position.set(Math.min(Math.max(x, margin), this.width * this.cell - margin), y);
    this.textLayer.addChild(t);
    this.popups.push({ t, life: 0, max: this.reduced ? 600 : 950, y0: t.y, rise: this.reduced ? 0 : this.cell * 0.7 });
  }

  // ---- per frame

  private tick(dt: number): void {
    const per = Math.max(60, this.opts.tickMs);
    for (const [id, v] of [...this.pieces]) {
      if (v.dying !== null) {
        // A piece that left the deck slides into its turret or hatch and shrinks to nothing.
        v.dying += dt;
        const k = Math.min(1, v.dying / DIE_MS);
        if (v.exit) v.s.position.set(v.fx + (v.exit.x - v.fx) * k, v.fy + (v.exit.y - v.fy) * k);
        v.s.scale.set(Math.min(v.s.scale.x, 1 - k));
        if (k >= 1) {
          v.s.destroy();
          this.pieces.delete(id);
        }
        continue;
      }
      if (v.k < 1) {
        // The roll is the round's clock, a tile a tick, so it is even, not eased.
        v.k = this.reduced ? 1 : Math.min(1, v.k + dt / per);
        v.s.position.set(v.fx + (v.tx - v.fx) * v.k, v.fy + (v.ty - v.fy) * v.k);
      }
      if (v.s.scale.x < 1) v.s.scale.set(this.reduced ? 1 : Math.min(1, v.s.scale.x + dt / (MOTION.move * 2)));
    }
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i]!;
      p.life += dt;
      const k = p.life / p.max;
      p.t.scale.set(this.reduced ? 1 : 0.6 + 0.4 * easeOutCubic(Math.min(1, p.life / MOTION.panel)));
      p.t.y = p.y0 - p.rise * easeOutCubic(Math.min(1, k));
      p.t.alpha = k < 0.7 ? 1 : Math.max(0, 1 - (k - 0.7) / 0.3);
      if (k >= 1) {
        p.t.destroy();
        this.popups.splice(i, 1);
      }
    }
    for (let i = 0; i < this.fired.length; i++) if (this.fired[i] !== undefined) this.fired[i]! += dt;
    this.drawTurrets();
    this.drawHeadings();
    this.drawBeat(dt);
    if (this.framePending) {
      this.framePending = false;
      this.cb.onFrame();
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

  // ---- input

  /** The arrow a press or hover on this cell would lay: the way it leans, or lift if that arrow is already there. */
  private ghostFor(col: number, row: number, dir: Dir, canLift: boolean): Ghost | null {
    if (!this.isDeck(col, row)) return null;
    const existing = this.state?.arrows.find((a) => a.col === col && a.row === row);
    return { col, row, dir, lift: canLift && existing?.dir === dir };
  }

  private pointerDown(e: FederatedPointerEvent): void {
    if (!this.interactive) return;
    const at = this.local(e.global.x, e.global.y);
    if (!at || !this.isDeck(at.col, at.row)) return;
    if (e.button === 2) {
      // Right click lifts the arrow under the pointer.
      if (this.state?.arrows.some((a) => a.col === at.col && a.row === at.row)) this.cb.onArrow(at.col, at.row, null);
      return;
    }
    const dir = leanOf(at.fx, at.fy);
    this.press = { x: e.global.x, y: e.global.y, col: at.col, row: at.row, touch: e.pointerType !== "mouse", dragged: false, dir };
    this.cursor = null;
    this.drawCursor();
    this.setGhost(this.ghostFor(at.col, at.row, dir, true));
    this.drawHover();
  }

  private pointerMove(e: FederatedPointerEvent): void {
    if (!this.interactive) return;
    const pr = this.press;
    if (pr) {
      const dx = e.global.x - pr.x;
      const dy = e.global.y - pr.y;
      if (Math.hypot(dx, dy) >= this.cell * 0.3) {
        pr.dragged = true;
        pr.dir = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 0 : 2) : dy > 0 ? 1 : 3;
        this.setGhost(this.ghostFor(pr.col, pr.row, pr.dir, false));
      }
      return;
    }
    if (e.pointerType !== "mouse") return;
    const at = this.local(e.global.x, e.global.y);
    const prev = this.hover;
    this.hover = at;
    if (!prev || !at || prev.col !== at.col || prev.row !== at.row) this.drawHover();
    this.setGhost(at ? this.ghostFor(at.col, at.row, leanOf(at.fx, at.fy), true) : null);
  }

  private pointerUp(e: FederatedPointerEvent): void {
    const pr = this.press;
    this.press = null;
    if (!pr || !this.interactive || !this.state) return;
    const g = this.ghost;
    if (pr.touch && !pr.dragged) {
      // Double tap lifts the arrow: the first tap laid or turned it, the second takes it away.
      const now = performance.now();
      const last = this.lastTap;
      if (last && last.col === pr.col && last.row === pr.row && now - last.at <= DOUBLE_TAP_MS) {
        this.lastTap = null;
        if (this.state.arrows.some((a) => a.col === pr.col && a.row === pr.row)) this.cb.onArrow(pr.col, pr.row, null);
        this.setGhost(null);
        this.drawHover();
        return;
      }
      this.lastTap = { col: pr.col, row: pr.row, at: now };
    } else this.lastTap = null;
    if (g && g.col === pr.col && g.row === pr.row) {
      if (g.lift) this.cb.onArrow(g.col, g.row, null);
      else {
        const existing = this.state.arrows.find((a) => a.col === g.col && a.row === g.row);
        if (existing?.dir !== g.dir) this.cb.onArrow(g.col, g.row, g.dir);
      }
    }
    // After a commit the hover ghost reflects the new arrow (a second click lifts it); touch has no hover.
    if (e.pointerType === "mouse") {
      const at = this.local(e.global.x, e.global.y);
      this.ghost = null;
      this.setGhost(at ? this.ghostFor(at.col, at.row, leanOf(at.fx, at.fy), true) : null);
    } else this.setGhost(null);
    this.drawHover();
  }

  private isDeck(col: number, row: number): boolean {
    return gunneryCellAt(this.deck, col, row) === "deck";
  }

  /** Keyboard: arrows move the cursor over deck cells; W A S D lay an arrow; Backspace, Delete or Space lifts. */
  keyboard(key: string): boolean {
    if (!this.interactive || !this.state) return false;
    const c = this.cursor ?? this.firstDeckCell();
    const moveCursor = (dcol: number, drow: number): void => {
      let col = c.col + dcol;
      let row = c.row + drow;
      // Skip over non-deck cells in the same direction.
      for (let i = 0; i < Math.max(this.width, this.height); i++) {
        if (col < 0 || col >= this.width || row < 0 || row >= this.height) return;
        if (this.isDeck(col, row)) break;
        col += dcol;
        row += drow;
      }
      if (!this.isDeck(col, row)) return;
      this.cursor = { col, row };
      this.drawCursor();
    };
    const lay = (dir: Dir): void => {
      this.cursor = c;
      this.drawCursor();
      const existing = this.state?.arrows.find((a) => a.col === c.col && a.row === c.row);
      if (existing?.dir !== dir) this.cb.onArrow(c.col, c.row, dir);
    };
    switch (key) {
      case "ArrowLeft":
        moveCursor(-1, 0);
        return true;
      case "ArrowRight":
        moveCursor(1, 0);
        return true;
      case "ArrowUp":
        moveCursor(0, -1);
        return true;
      case "ArrowDown":
        moveCursor(0, 1);
        return true;
      case "d":
      case "D":
        lay(0);
        return true;
      case "s":
      case "S":
        lay(1);
        return true;
      case "a":
      case "A":
        lay(2);
        return true;
      case "w":
      case "W":
        lay(3);
        return true;
      case " ":
      case "Backspace":
      case "Delete":
        this.cursor = c;
        this.drawCursor();
        if (this.state.arrows.some((a) => a.col === c.col && a.row === c.row)) this.cb.onArrow(c.col, c.row, null);
        return true;
      default:
        return false;
    }
  }

  /** The keyboard cursor starts on the drop cell, where the stream begins. */
  private firstDeckCell(): { col: number; row: number } {
    const { drop } = this.deck;
    return { col: drop.col, row: drop.row };
  }
}

/** A V pointing `dir`, for the feeder's drop and a hatch's way out. */
function drawChevron(g: Graphics, x: number, y: number, r: number, dir: Dir, color: number, width: number): void {
  const dx = DX[dir]!;
  const dy = DY[dir]!;
  const tipX = x + dx * r * 0.5;
  const tipY = y + dy * r * 0.5;
  const backX = x - dx * r * 0.5;
  const backY = y - dy * r * 0.5;
  g.moveTo(backX - dy * r, backY + dx * r)
    .lineTo(tipX, tipY)
    .lineTo(backX + dy * r, backY - dx * r)
    .stroke({ width, color, cap: "round", join: "round" });
}

/** An arrow on a deck tile: a shaft and a head, round at every end. */
export function drawArrowGlyph(g: Graphics, x: number, y: number, r: number, dir: Dir, color: number, alpha: number): void {
  const dx = DX[dir]!;
  const dy = DY[dir]!;
  const tx = x - dx * r;
  const ty = y - dy * r;
  const hx = x + dx * r;
  const hy = y + dy * r;
  const width = Math.max(3, r * 0.42);
  const w = r * 0.7;
  // One path, so a faint arrow is the same faint all over.
  g.moveTo(tx, ty)
    .lineTo(hx, hy)
    .moveTo(hx - dx * w - dy * w, hy - dy * w + dx * w)
    .lineTo(hx, hy)
    .lineTo(hx - dx * w + dy * w, hy - dy * w - dx * w)
    .stroke({ width, color, alpha, cap: "round", join: "round" });
}
