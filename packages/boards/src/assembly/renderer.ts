import { Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import {
  ASSEMBLY_CORE,
  ASSEMBLY_POOL,
  assemblyFitIllegalReason,
  assemblyFitPoints,
  assemblyHint,
  assemblyKindChar,
  assemblySwapIllegalReason,
  assemblyTrayString,
  type AssemblyBlueprint,
  type AssemblyMove,
  type AssemblyMoveReport,
  type AssemblyPiece,
  type AssemblyState,
} from "@openseas/engine";
import { sfx } from "../audio.js";
import { MOTION } from "../look/tokens.js";
import { FONT_MONO, INK } from "../kit/art.js";
import { Grid, KitBoard } from "../kit/board.js";
import { assemblyKind } from "./pieces.js";

export interface AssemblyCallbacks {
  /** The player swapped the parts at `a` and `b`. */
  onSwap(a: number, b: number): void;
  /** The player fitted the blueprint in `slot` with the top left of its box on `cell`. */
  onFit(slot: number, cell: number): void;
  /** First settled frame after a new state. */
  onFrame(): void;
}

export interface AssemblyLabels {
  /** What the blueprint in hand would score where it is held. */
  preview(points: number): string;
  /** The blueprint in hand does not fit where it is held. */
  previewNone: string;
  chain(count: number): string;
  chainEnded: string;
  bigFit: string;
  coreFit: string;
}

export interface AssemblyRendererOptions {
  /** Pulse a move worth making after a pause. Off for recorded rounds. */
  hints: boolean;
  labels: AssemblyLabels;
}

interface PieceView {
  s: Sprite;
  kind: number;
  cell: number;
}

/** The strip over the bay, in cells: what the blueprint in hand is worth. */
const STRIP = 0.8;
/** The tray under the bay, in cells: a gap, then two rows of slots. */
const TRAY_GAP = 0.35;
const SLOT_H = 1.55;
const TRAY = TRAY_GAP + SLOT_H * 2;
/** The biggest box a blueprint in the pool is drawn on: every one fits its slot at one size. */
const POOL_W = Math.max(...ASSEMBLY_POOL.map((p) => p.width));
const POOL_H = Math.max(...ASSEMBLY_POOL.map((p) => p.height));
const HINT_AFTER_MS = 6000;
const RING_W = 0.07;
/** A drag this far, in cells, from a part swaps it that way. */
const DRAG = 0.38;
/** Past this far from a cell's middle on both axes, in cells, a drag leaving the cell goes corner to corner. */
const CORNER = 0.36;
/** A chain called out from this place; the beat from the next. */
const CALL_CHAIN = 2;
const BEAT_CHAIN = 4;

/** The eight ways a part can be dragged or keyed, as column and row steps. */
const KEY_STEPS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  a: [-1, 0],
  d: [1, 0],
  w: [0, -1],
  s: [0, 1],
  q: [-1, -1],
  e: [1, -1],
  z: [-1, 1],
  c: [1, 1],
};

type Press =
  | { kind: "bay"; cell: number; x: number; y: number; moved: boolean; armed: boolean; bumped: number | null; waitMoves: number | null }
  | { kind: "tray"; slot: number; x: number; y: number; dragging: boolean };

/**
 * Draws the parts bay and the tray of blueprints, and turns drags, taps and keys into swaps and
 * fits. Scores nothing: every number it shows is the engine's.
 */
export class AssemblyRenderer extends KitBoard<AssemblyState> {
  private readonly grid = new Grid(6, 8);
  private readonly bg = new Graphics();
  private readonly trayBg = new Graphics();
  private readonly hintLayer = new Graphics();
  private readonly pieceLayer = new Container();
  /** Keeps the bay's parts inside its edges while they move. */
  private readonly pieceMask = new Graphics();
  private readonly trayLayer = new Container();
  private readonly ghostLayer = new Graphics();
  /** The blueprint in hand drawn small over the bay: on each cell it would take, the part it wants there. */
  private readonly ghostParts = new Container();
  private readonly ghostPool: Sprite[] = [];
  private readonly selectLayer = new Graphics();
  private readonly cursorLayer = new Graphics();
  private label: Text | null = null;
  private readonly pieces = new Map<number, PieceView>();
  /** Each blueprint's minis in the tray, by blueprint id, with the slot it was drawn in. */
  private readonly minis = new Map<number, { slot: number; sprites: Sprite[]; kinds: string }>();
  private slots: Array<{ x: number; y: number; w: number; h: number }> = [];
  private mini = 12;
  /** The part picked by a tap or a key, waiting for a neighbour. */
  private held: number | null = null;
  /** The blueprint picked from the tray, and where it would go. */
  private picked: number | null = null;
  private anchor: number | null = null;
  private press: Press | null = null;
  /** The keyboard's cell. Drawn once a key has been used. */
  private cursor = 0;
  private cursorShown = false;
  private idle = 0;
  private hint: AssemblyMove | null = null;
  private hintFor: AssemblyState | null = null;
  private hints: boolean;

  constructor(
    host: HTMLElement,
    private readonly cb: AssemblyCallbacks,
    private readonly opts: AssemblyRendererOptions,
  ) {
    super(host, "assembly", cb.onFrame);
    this.hints = opts.hints;
  }

  setHints(on: boolean): void {
    this.hints = on;
  }

  protected build(): void {
    this.label = new Text({ text: "", style: { fontFamily: FONT_MONO, fontSize: 16, fontWeight: "700", fill: INK.cream }, resolution: 2 });
    this.label.anchor.set(0.5);
    this.pieceLayer.mask = this.pieceMask;
    this.world.addChild(this.pieceMask, this.bg, this.trayBg, this.hintLayer, this.pieceLayer, this.trayLayer, this.ghostLayer, this.ghostParts, this.selectLayer, this.cursorLayer, this.label);
  }

  protected layout(width: number, height: number): void {
    const g = this.grid;
    if (this.state) {
      g.cols = this.state.config.width;
      g.rows = this.state.config.height;
    }
    g.fit(width, height, { top: STRIP, bottom: TRAY, margin: 8 });
    const pad = Math.max(4, g.cell * 0.12);
    const strip = g.cell * STRIP;
    this.bg.clear();
    this.paintGround(this.bg, g.ox - pad, g.oy - strip - pad, g.width + pad * 2, g.height + strip + g.cell * TRAY + pad * 2);
    this.pieceMask
      .clear()
      .rect(g.ox - pad, g.oy - pad / 2, g.width + pad * 2, g.height + pad)
      .fill({ color: INK.cream });
    if (this.label) {
      this.label.style.fontSize = Math.max(12, Math.round(g.cell * 0.34));
      this.label.position.set(g.ox + g.width / 2, g.oy - strip * 0.5);
    }
    this.layoutTray();
    this.cursor = Math.min(this.cursor, g.cols * g.rows - 1);
    this.publishGeom(g.ox, g.oy, g.cell);
    this.hold(null);
    if (this.state) {
      this.snap(this.state.cells);
      this.snapTray(this.state.tray);
    }
    this.drawCursor();
    this.drawGhost();
  }

  /** Where each slot of the tray sits: two rows under the bay, the slots of a row sharing its width. */
  private layoutTray(): void {
    const g = this.grid;
    const n = this.state?.tray.length ?? 6;
    const perRow = Math.ceil(n / 2);
    const w = g.width / perRow;
    const h = g.cell * SLOT_H;
    const top = g.oy + g.height + g.cell * TRAY_GAP;
    this.slots = [];
    for (let i = 0; i < n; i++) this.slots.push({ x: g.ox + (i % perRow) * w, y: top + Math.floor(i / perRow) * h, w, h });
    this.mini = Math.floor(Math.min((w - 8) / (POOL_W + 1), (h - 8) / (POOL_H + 0.4)));
    this.trayBg.clear();
    const inset = Math.max(2, g.cell * 0.06);
    for (const s of this.slots) this.trayBg.roundRect(s.x + inset, s.y + inset, s.w - inset * 2, s.h - inset * 2, g.cell * 0.18).fill({ color: INK.raised });
    this.app.canvas.setAttribute("data-tray-geom", this.slots.map((s) => [s.x, s.y, s.w, s.h].map((v) => Math.round(v)).join(",")).join(";"));
  }

  private texture(kind: number, size: number): Texture {
    const k = assemblyKind(kind);
    return this.piece(k.id, size, k.color, k.paint);
  }

  /** Put exactly these parts in the bay, each on its cell, with nothing in motion. */
  private snap(cells: readonly AssemblyPiece[]): void {
    const seen = new Set<number>();
    cells.forEach((p, cell) => {
      seen.add(p.id);
      let v = this.pieces.get(p.id);
      if (!v) v = this.spawn(p, cell);
      v.cell = cell;
      v.kind = p.kind;
      v.s.texture = this.texture(p.kind, this.grid.cell);
      v.s.position.set(this.grid.x(cell), this.grid.y(cell));
      v.s.scale.set(1);
      v.s.alpha = 1;
    });
    for (const [id, v] of this.pieces) {
      if (seen.has(id)) continue;
      v.s.destroy();
      this.pieces.delete(id);
    }
    this.touchView();
  }

  private spawn(p: { id: number; kind: number }, cell: number): PieceView {
    const s = new Sprite(this.texture(p.kind, this.grid.cell));
    s.anchor.set(0.5);
    s.position.set(this.grid.x(cell), this.grid.y(cell));
    this.pieceLayer.addChild(s);
    const v: PieceView = { s, kind: p.kind, cell };
    this.pieces.set(p.id, v);
    return v;
  }

  /** The tray as the engine holds it: each blueprint's minis centred in its slot. */
  private snapTray(tray: readonly AssemblyBlueprint[]): void {
    if (this.slots.length !== tray.length) this.layoutTray();
    const seen = new Set<number>();
    tray.forEach((bp, slot) => {
      seen.add(bp.id);
      const have = this.minis.get(bp.id);
      // Ids start over in each deal, so an entry is reused only when it holds this blueprint's parts.
      if (have && have.slot === slot && have.sprites.length === bp.parts.length) {
        have.kinds = bp.parts.map((p) => p.kind).join("");
        for (const s of have.sprites) {
          s.scale.set(1);
          s.alpha = 1;
        }
        this.placeMinis(bp, slot, have.sprites);
        return;
      }
      if (have) for (const s of have.sprites) s.destroy();
      const sprites = bp.parts.map((p) => {
        const s = new Sprite(this.texture(p.kind, this.mini));
        s.anchor.set(0.5);
        this.trayLayer.addChild(s);
        return s;
      });
      this.placeMinis(bp, slot, sprites);
      this.minis.set(bp.id, { slot, sprites, kinds: bp.parts.map((p) => p.kind).join("") });
    });
    for (const [id, m] of this.minis) {
      if (seen.has(id)) continue;
      for (const s of m.sprites) s.destroy();
      this.minis.delete(id);
    }
    this.touchView();
  }

  private placeMinis(bp: AssemblyBlueprint, slot: number, sprites: Sprite[]): void {
    const box = this.slots[slot];
    if (!box) return;
    const m = this.mini;
    const x0 = box.x + box.w / 2 - (bp.width * m) / 2;
    const y0 = box.y + box.h / 2 - (bp.height * m) / 2;
    bp.parts.forEach((p, i) => {
      const s = sprites[i];
      if (!s) return;
      s.texture = this.texture(p.kind, m);
      s.position.set(x0 + (p.dc + 0.5) * m, y0 + (p.dr + 0.5) * m);
    });
  }

  protected onState(state: AssemblyState, prev: AssemblyState | null): void {
    this.hold(null);
    this.hint = null;
    this.hintLayer.clear();
    this.idle = 0;
    const g = this.grid;
    if (g.cols !== state.config.width || g.rows !== state.config.height || this.slots.length !== state.tray.length) {
      // A different bay (a lab config): lay it out afresh.
      g.cols = state.config.width;
      g.rows = state.config.height;
      this.picked = null;
      this.anchor = null;
      this.layout(this.app.screen.width, this.app.screen.height);
      return;
    }
    const r = state.lastMove;
    if (!r || !prev || !this.follows(r, prev)) {
      this.snap(state.cells);
      this.snapTray(state.tray);
      this.drawGhost();
      return;
    }
    this.play(state, r);
  }

  /** True when the move starts from what is drawn, so it can be played rather than snapped. */
  private follows(r: AssemblyMoveReport, prev: AssemblyState): boolean {
    if (r.swap) {
      const a = prev.cells[r.swap.a];
      const b = prev.cells[r.swap.b];
      return a !== undefined && b !== undefined && this.pieces.get(a.id)?.cell === r.swap.a && this.pieces.get(b.id)?.cell === r.swap.b;
    }
    if (r.fit) return r.fit.taken.every((t) => this.pieces.get(t.id)?.cell === t.cell);
    return false;
  }

  private play(state: AssemblyState, r: AssemblyMoveReport): void {
    const g = this.grid;
    const L = this.opts.labels;
    let t = 0;
    if (r.swap) {
      const { a, b } = r.swap;
      const va = [...this.pieces.values()].find((v) => v.cell === a);
      const vb = [...this.pieces.values()].find((v) => v.cell === b);
      if (va && vb) {
        va.cell = b;
        vb.cell = a;
        this.tweens.move(va.s, { x: g.x(b), y: g.y(b) });
        this.tweens.move(vb.s, { x: g.x(a), y: g.y(a) });
      }
      sfx.swap();
      if (r.chainEnded >= CALL_CHAIN) this.fx.say(L.chainEnded, INK.dim);
      t = MOTION.move;
    }
    const f = r.fit;
    if (f) {
      // The fitted parts shrink away where they stood, the blueprint leaves the tray, and its points rise.
      for (const tk of f.taken) {
        const v = this.pieces.get(tk.id);
        if (!v) continue;
        this.pieces.delete(tk.id);
        this.tweens.remove(v.s, { done: () => v.s.destroy() });
      }
      const old = this.minis.get(f.blueprint.id);
      if (old) {
        this.minis.delete(f.blueprint.id);
        for (const s of old.sprites) this.tweens.remove(s, { done: () => s.destroy() });
      }
      const cx = f.taken.reduce((acc, tk) => acc + g.x(tk.cell), 0) / f.taken.length;
      const cy = f.taken.reduce((acc, tk) => acc + g.y(tk.cell), 0) / f.taken.length;
      sfx.pop(Math.min(9, (f.place - 1) * 2 + f.taken.length - 3));
      if (f.place >= CALL_CHAIN) sfx.clear(f.place, f.taken.length);
      this.fx.popup(cx, cy - g.cell * 0.2, `+${f.points}`, INK.cream, Math.max(16, g.cell * (f.place >= CALL_CHAIN ? 0.5 : 0.42)));
      t = MOTION.clear;
      // New parts grow in where the fitted ones stood; nothing else in the bay moves.
      for (const sp of f.spawned) {
        const v = this.spawn({ id: sp.id, kind: sp.kind }, sp.cell);
        v.s.scale.set(0);
        this.tweens.run(MOTION.move, (k) => v.s.scale.set(k), { delay: t });
      }
      t += MOTION.move + 30;
      // One callout a fit: the chain, then five parts, then a core. The beat is the chain's, from its fourth fit.
      this.tweens.after(t, () => {
        if (f.place >= BEAT_CHAIN) {
          this.fx.say(L.chain(f.place));
          this.beat(Math.min(1, 0.3 + (f.place - BEAT_CHAIN) * 0.15));
        } else if (f.place >= CALL_CHAIN) this.fx.say(L.chain(f.place));
        else if (f.taken.length >= 5) {
          this.fx.say(L.bigFit);
          sfx.good();
        } else if (f.cores > 0) {
          this.fx.say(L.coreFit);
          sfx.rise();
        }
      });
    }
    // Whatever the tweens did, the bay and the tray end as the engine holds them.
    this.tweens.after(t, () => {
      this.snap(state.cells);
      this.snapTray(state.tray);
      this.drawGhost();
    });
  }

  protected view(): string {
    const g = this.grid;
    const chars = new Array<string>(g.cols * g.rows).fill(".");
    for (const v of this.pieces.values()) {
      const at = g.at(v.s.x, v.s.y);
      if (at) chars[at.index] = assemblyKindChar(v.kind);
    }
    // The tray as drawn: each slot's blueprint read back from the sprites in it.
    const tray = this.state ? this.state.tray.map((bp, slot) => (this.minis.get(bp.id)?.slot === slot ? bp : null)) : [];
    const trayView = tray.every((bp) => bp !== null) ? assemblyTrayString(tray as AssemblyBlueprint[]) : "";
    return `${chars.join("")}/${trayView}`;
  }

  protected override update(dt: number): void {
    // A move worth making pulses after a pause, in rounds that allow hints.
    if (!this.interactive || !this.hints || !this.state || this.state.finished || this.press || this.busy) {
      this.idle = 0;
      if (this.hint !== null) {
        this.hint = null;
        this.hintLayer.clear();
      }
      return;
    }
    this.idle += dt;
    if (this.idle < HINT_AFTER_MS) return;
    if (this.hintFor !== this.state) {
      this.hintFor = this.state;
      this.hint = assemblyHint(this.state);
    }
    this.hintLayer.clear();
    const h = this.hint;
    if (!h) return;
    // A hint is cream, never amber: it is the board's advice, not the player's own hand.
    const pulse = this.reduced ? 0.8 : 0.55 + 0.4 * Math.sin(this.time / 240);
    const g = this.grid;
    const w = Math.max(2, g.cell * RING_W);
    if (h.type === "swap") {
      for (const c of [h.a, h.b]) this.hintLayer.circle(g.x(c), g.y(c), g.cell * 0.45).stroke({ width: w, color: INK.cream, alpha: pulse });
    } else if (h.type === "fit") {
      const box = this.slots[h.slot];
      if (box) this.hintLayer.roundRect(box.x + 2, box.y + 2, box.w - 4, box.h - 4, g.cell * 0.18).stroke({ width: w, color: INK.cream, alpha: pulse });
      this.frameCells(this.hintLayer, this.cellsOf(h.slot, h.cell), INK.cream, pulse);
    }
  }

  /** The bay cells a blueprint covers with its box's top left on `cell`. */
  private cellsOf(slot: number, cell: number): number[] {
    const bp = this.state?.tray[slot];
    if (!bp) return [];
    const g = this.grid;
    const col = cell % g.cols;
    const row = Math.floor(cell / g.cols);
    return bp.parts.map((p) => (row + p.dr) * g.cols + col + p.dc);
  }

  private frameCells(l: Graphics, cells: readonly number[], color: number, alpha = 1): void {
    const g = this.grid;
    const pad = g.cell * 0.06;
    for (const c of cells) {
      l.roundRect(g.x(c) - g.cell / 2 + pad, g.y(c) - g.cell / 2 + pad, g.cell - pad * 2, g.cell - pad * 2, g.cell * 0.2).stroke({ width: Math.max(2, g.cell * RING_W), color, alpha });
    }
  }

  // ---- the blueprint in hand

  /** Pick a blueprint from the tray, or put it back. */
  private pick(slot: number | null): void {
    const state = this.state;
    if (slot !== null && (!state || slot >= state.tray.length)) return;
    this.hold(null);
    this.picked = slot;
    if (slot === null) this.anchor = null;
    else if (this.anchor === null && this.cursorShown) this.anchor = this.clampAnchor(slot, this.cursor % this.grid.cols, Math.floor(this.cursor / this.grid.cols));
    if (slot !== null) sfx.pop(0);
    this.drawGhost();
  }

  /** The top left a blueprint's box may sit at nearest (`col`, `row`), kept inside the bay. */
  private clampAnchor(slot: number, col: number, row: number): number {
    const bp = this.state!.tray[slot]!;
    const g = this.grid;
    const c = Math.max(0, Math.min(g.cols - bp.width, col));
    const r = Math.max(0, Math.min(g.rows - bp.height, row));
    return r * g.cols + c;
  }

  /** The anchor that centres the blueprint in hand on a point. */
  private anchorAt(slot: number, x: number, y: number): number {
    const bp = this.state!.tray[slot]!;
    const g = this.grid;
    return this.clampAnchor(slot, Math.round((x - g.ox) / g.cell - bp.width / 2), Math.round((y - g.oy) / g.cell - bp.height / 2));
  }

  /** The blueprint in hand drawn where it would go, amber, and what it would score in the strip. */
  private drawGhost(): void {
    this.ghostLayer.clear();
    const state = this.state;
    const box = this.picked !== null ? this.slots[this.picked] : undefined;
    this.selectLayer.clear();
    if (box) {
      const g = this.grid;
      // The picked blueprint is the player's: an amber ring round its slot.
      this.selectLayer.roundRect(box.x + 2, box.y + 2, box.w - 4, box.h - 4, g.cell * 0.18).stroke({ width: Math.max(2, g.cell * RING_W), color: INK.amber });
    }
    if (this.held !== null) {
      const g = this.grid;
      this.selectLayer.circle(g.x(this.held), g.y(this.held), g.cell * 0.45).stroke({ width: Math.max(2, g.cell * RING_W), color: INK.amber });
    }
    if (!state || this.picked === null || this.anchor === null || state.finished) {
      this.ghostPool.forEach((s) => (s.visible = false));
      this.setLabel("");
      return;
    }
    const ok = assemblyFitIllegalReason(state, this.picked, this.anchor) === null;
    this.frameCells(this.ghostLayer, this.cellsOf(this.picked, this.anchor), ok ? INK.amber : INK.dim, ok ? 1 : 0.8);
    this.drawGhostParts(state, this.picked, this.anchor, ok ? INK.amber : INK.dim);
    const L = this.opts.labels;
    if (ok) this.setLabel(L.preview(assemblyFitPoints(state, this.picked, this.anchor)), INK.cream);
    else this.setLabel(L.previewNone, INK.dim);
  }

  /**
   * On each cell the blueprint in hand would take, the part it wants there, small in the cell's top
   * right corner on a raised disc, so a player reads the match on the bay without looking back at
   * the tray. A cell that already holds what it wants (or a core) shows its part faded.
   */
  private drawGhostParts(state: AssemblyState, slot: number, anchor: number, ring: number): void {
    const bp = state.tray[slot];
    const cells = bp ? this.cellsOf(slot, anchor) : [];
    const g = this.grid;
    const r = g.cell * 0.27;
    const size = Math.max(8, Math.round(r * 1.5));
    for (let i = 0; i < Math.max(cells.length, this.ghostPool.length); i++) {
      let s = this.ghostPool[i];
      const cell = cells[i];
      const part = bp?.parts[i];
      if (cell === undefined || !part) {
        if (s) s.visible = false;
        continue;
      }
      if (!s) {
        s = new Sprite();
        s.anchor.set(0.5);
        this.ghostPool.push(s);
        this.ghostParts.addChild(s);
      }
      const x = g.x(cell) + g.cell * 0.5 - r + g.cell * 0.02;
      const y = g.y(cell) - g.cell * 0.5 + r - g.cell * 0.02;
      const have = state.cells[cell]?.kind;
      const met = have === part.kind || have === ASSEMBLY_CORE;
      this.ghostLayer.circle(x, y, r).fill({ color: INK.raised, alpha: met ? 0.7 : 0.95 }).stroke({ width: Math.max(1, g.cell * 0.03), color: ring, alpha: met ? 0.5 : 1 });
      s.texture = this.texture(part.kind, size);
      s.position.set(x, y);
      s.alpha = met ? 0.45 : 1;
      s.visible = true;
    }
  }

  private setLabel(text: string, color: number = INK.cream): void {
    if (!this.label) return;
    this.label.text = text;
    this.label.style.fill = color;
  }

  private tryFit(slot: number, cell: number): void {
    const state = this.state;
    if (!state || state.finished) return;
    if (this.busy) this.tweens.flush();
    this.idle = 0;
    if (assemblyFitIllegalReason(state, slot, cell) !== null) {
      sfx.bump();
      return;
    }
    this.picked = null;
    this.anchor = null;
    this.cb.onFit(slot, cell);
  }

  // ---- the swap

  private trySwap(a: number, b: number): void {
    const state = this.state;
    if (!state || state.finished) return;
    if (this.busy) this.tweens.flush();
    this.hold(null);
    this.idle = 0;
    if (b < 0 || b >= state.cells.length || assemblySwapIllegalReason(state, a, b) !== null) {
      sfx.bump();
      return;
    }
    this.cb.onSwap(a, b);
  }

  /** Hold a part, waiting for the neighbour it swaps with. */
  private hold(cell: number | null): void {
    this.held = cell;
    this.drawGhost();
  }

  /** The neighbour of `cell` one step (`dc`, `dr`) away, or -1 off the bay. */
  private step(cell: number, dc: number, dr: number): number {
    const g = this.grid;
    const c = (cell % g.cols) + dc;
    const r = Math.floor(cell / g.cols) + dr;
    return c >= 0 && c < g.cols && r >= 0 && r < g.rows ? r * g.cols + c : -1;
  }

  // ---- pointer

  private slotAt(x: number, y: number): number | null {
    const i = this.slots.findIndex((s) => x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h);
    return i >= 0 ? i : null;
  }

  protected override pointerDown(x: number, y: number): void {
    if (!this.interactive || !this.state || this.state.finished) return;
    this.cursorShown = false;
    this.drawCursor();
    const slot = this.slotAt(x, y);
    if (slot !== null) {
      this.press = { kind: "tray", slot, x, y, dragging: false };
      return;
    }
    const at = this.grid.at(x, y);
    if (at) this.press = { kind: "bay", cell: at.index, x, y, moved: false, armed: false, bumped: null, waitMoves: null };
  }

  protected override pointerMove(x: number, y: number): void {
    const p = this.press;
    const g = this.grid;
    if (!p) {
      // A blueprint in hand follows the pointer over the bay.
      if (this.picked !== null && this.interactive && g.at(x, y)) {
        const anchor = this.anchorAt(this.picked, x, y);
        if (anchor !== this.anchor) {
          this.anchor = anchor;
          this.drawGhost();
        }
      }
      return;
    }
    const dx = x - p.x;
    const dy = y - p.y;
    const far = Math.hypot(dx, dy) >= g.cell * DRAG;
    if (p.kind === "tray") {
      if (!p.dragging && far) {
        p.dragging = true;
        this.pick(p.slot);
      }
      if (p.dragging && g.at(x, y)) {
        this.anchor = this.anchorAt(p.slot, x, y);
        this.drawGhost();
      }
      return;
    }
    if (this.picked !== null) {
      this.anchor = this.anchorAt(this.picked, x, y);
      this.drawGhost();
      return;
    }
    this.dragBay(p, x, y, far);
  }

  /**
   * A drag carries its part: each time the pointer passes into a neighbour's side of the part's
   * cell (one of eight, by the angle), the two swap and the drag goes on from the new cell. A
   * neighbour it cannot swap with bumps once, and the part stays.
   */
  private dragBay(p: Extract<Press, { kind: "bay" }>, x: number, y: number, far: boolean): void {
    const state = this.state;
    const g = this.grid;
    if (!state || state.finished) return;
    // The last swap has not come back yet: the bay as held is not the one the part is on.
    if (p.waitMoves !== null) {
      if (state.moveCount === p.waitMoves) return;
      p.waitMoves = null;
    }
    let next: number;
    if (!p.moved) {
      // The first step: a flick the drag's own length, its neighbour by the angle, one of eight.
      if (!far) return;
      const oct = Math.round(Math.atan2(y - p.y, x - p.x) / (Math.PI / 4));
      next = this.step(p.cell, Math.round(Math.cos(oct * (Math.PI / 4))), Math.round(Math.sin(oct * (Math.PI / 4))));
    } else {
      // After it, the part follows the pointer out of its cell: across a side to that neighbour, or
      // through a corner to the one corner to corner. It steps again only once the pointer has been
      // inside the cell the part came to, so a corner step never turns back on itself.
      const ux = (x - g.x(p.cell)) / g.cell;
      const uy = (y - g.y(p.cell)) / g.cell;
      const out = Math.max(Math.abs(ux), Math.abs(uy)) > 0.5;
      if (!out) {
        p.armed = true;
        return;
      }
      if (!p.armed) return;
      const corner = Math.abs(ux) > CORNER && Math.abs(uy) > CORNER;
      const dc = corner || Math.abs(ux) >= Math.abs(uy) ? Math.sign(ux) : 0;
      const dr = corner || Math.abs(uy) > Math.abs(ux) ? Math.sign(uy) : 0;
      next = this.step(p.cell, dc, dr);
    }
    if (next < 0 || next === p.bumped) return;
    p.moved = true;
    if (assemblySwapIllegalReason(state, p.cell, next) !== null) {
      p.bumped = next;
      sfx.bump();
      return;
    }
    const before = state.moveCount;
    this.trySwap(p.cell, next);
    p.cell = next;
    p.armed = false;
    p.bumped = null;
    p.waitMoves = before;
  }

  protected override pointerUp(x: number, y: number): void {
    const p = this.press;
    this.press = null;
    if (!p || !this.state) return;
    const g = this.grid;
    if (p.kind === "tray") {
      if (p.dragging) {
        // A blueprint dragged onto the bay is fitted where it is dropped.
        if (g.at(x, y)) this.tryFit(p.slot, this.anchorAt(p.slot, x, y));
        else this.pick(null);
        return;
      }
      if (this.slotAt(x, y) === p.slot) this.pick(this.picked === p.slot ? null : p.slot);
      return;
    }
    if (p.moved) return;
    const at = g.at(x, y);
    if (!at) return;
    if (this.picked !== null) {
      // A blueprint in hand is fitted where the bay is tapped.
      this.tryFit(this.picked, this.anchorAt(this.picked, x, y));
      return;
    }
    if (at.index !== p.cell) return;
    // A tap holds a part; a tap on a neighbour swaps the two.
    const h = this.held;
    if (h !== null && h !== at.index && Math.abs((h % g.cols) - (at.index % g.cols)) <= 1 && Math.abs(Math.floor(h / g.cols) - Math.floor(at.index / g.cols)) <= 1) {
      this.trySwap(h, at.index);
      return;
    }
    if (h === at.index) {
      this.hold(null);
      return;
    }
    sfx.pop(0);
    this.hold(at.index);
  }

  protected override pointerCancel(): void {
    this.press = null;
  }

  // ---- keyboard

  private drawCursor(): void {
    const g = this.grid;
    this.cursorLayer.clear();
    this.app.canvas.setAttribute("data-cursor", `${this.cursor % g.cols},${Math.floor(this.cursor / g.cols)}`);
    if (!this.cursorShown) return;
    const pad = g.cell * 0.04;
    this.cursorLayer
      .roundRect(g.x(this.cursor) - g.cell / 2 + pad, g.y(this.cursor) - g.cell / 2 + pad, g.cell - pad * 2, g.cell - pad * 2, g.cell * 0.22)
      .stroke({ width: Math.max(2, g.cell * RING_W * 0.6), color: INK.amber, alpha: 0.7 });
  }

  /**
   * Arrows or WASD move the cursor. Space or enter holds the part under it; then an arrow, or Q, E,
   * Z or C for a corner, swaps it that way. Number keys pick a blueprint, whose box then sits at the
   * cursor; space or enter fits it. Escape lets go.
   */
  override keyboard(key: string): boolean {
    if (!this.interactive || !this.state) return false;
    const g = this.grid;
    const k = key.length === 1 ? key.toLowerCase() : key;
    if (/^[1-8]$/.test(k)) {
      const slot = Number(k) - 1;
      if (slot >= this.state.tray.length) return false;
      this.cursorShown = true;
      this.drawCursor();
      this.anchor = null;
      this.pick(this.picked === slot ? null : slot);
      return true;
    }
    const step = KEY_STEPS[k];
    if (step) {
      this.cursorShown = true;
      this.idle = 0;
      if (this.held !== null) {
        const from = this.held;
        const to = this.step(from, step[0], step[1]);
        this.cursor = to >= 0 ? to : from;
        this.drawCursor();
        this.trySwap(from, to);
        return true;
      }
      const next = this.step(this.cursor, step[0], step[1]);
      if (next >= 0) this.cursor = next;
      else sfx.bump();
      this.drawCursor();
      if (this.picked !== null) {
        this.anchor = this.clampAnchor(this.picked, this.cursor % g.cols, Math.floor(this.cursor / g.cols));
        this.drawGhost();
      }
      return true;
    }
    if (k === " " || k === "Enter") {
      this.cursorShown = true;
      this.drawCursor();
      if (this.picked !== null) {
        this.tryFit(this.picked, this.anchor ?? this.clampAnchor(this.picked, this.cursor % g.cols, Math.floor(this.cursor / g.cols)));
        return true;
      }
      this.hold(this.held === this.cursor ? null : this.cursor);
      return true;
    }
    if (k === "Escape" && (this.held !== null || this.picked !== null)) {
      this.hold(null);
      this.pick(null);
      return true;
    }
    return false;
  }
}
