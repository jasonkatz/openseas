import { Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import {
  TRACTOR_CACHE,
  tractorHint,
  tractorKindChar,
  tractorSwapIllegalReason,
  tractorSwapValue,
  type TractorMark,
  type TractorMoveReport,
  type TractorPiece,
  type TractorState,
} from "@openseas/engine";
import { sfx } from "../audio.js";
import { MOTION } from "../look/tokens.js";
import { FONT_MONO, INK } from "../kit/art.js";
import { Grid, KitBoard } from "../kit/board.js";
import { TRACTOR_CACHE_COLOR, TRACTOR_CACHE_PAINT, tractorBeaconPaint, tractorKind } from "./pieces.js";

export interface TractorCallbacks {
  /** The player swapped the piece at `cell` with the one under it. */
  onSwap(cell: number): void;
  /** First settled frame after a new state. */
  onFrame(): void;
}

export interface TractorLabels {
  /** The pair the cursor holds: what swapping it is worth at once, and the caches it hauls. */
  preview(points: number, caches: number): string;
  /** The pair the cursor holds makes no run. */
  previewDud: string;
  wave(count: number): string;
  longRun: string;
  cross: string;
  saltire: string;
  chain: string;
  caches(count: number): string;
  scrambled: string;
}

export interface TractorRendererOptions {
  /** Pulse a swap worth making after a pause. Off for recorded rounds. */
  hints: boolean;
  labels: TractorLabels;
}

interface PieceView {
  s: Sprite;
  kind: number;
  mark: TractorMark | undefined;
  cell: number;
}

/** The strip over the field, in cells: what the pair in hand is worth. */
const STRIP = 0.95;
const HINT_AFTER_MS = 6000;
/** A run this long is called out, and is one of the beat's two rare things. */
const LONG = 5;
const MIGHTY = 6;
/** Waves called out from this many in one swap. */
const WAVES = 3;
/** The pair's frame: 2 units off its pieces. */
const PAIR_PAD = 0.06;
const RING_W = 0.07;
/** A drag this far, in cells, up or down a piece swaps it. */
const DRAG = 0.38;

/** Draws the tractor field and turns a drag, two taps or a key into a swap. Scores nothing: every number it shows is the engine's. */
export class TractorRenderer extends KitBoard<TractorState> {
  private readonly grid = new Grid(6, 9);
  private readonly bg = new Graphics();
  private readonly hintLayer = new Graphics();
  private readonly pieceLayer = new Container();
  /** Loot drifting in from below is hidden until it is inside the field. */
  private readonly pieceMask = new Graphics();
  private readonly selectLayer = new Graphics();
  private readonly cursorLayer = new Graphics();
  private label: Text | null = null;
  private readonly pieces = new Map<number, PieceView>();
  /** The piece picked by a tap, waiting for a tap on the piece above or below it. */
  private selected: number | null = null;
  private drag: { cell: number; x: number; y: number } | null = null;
  /** The keyboard's pair: its top cell. Drawn once a key has been used. */
  private cursor = 0;
  private cursorShown = false;
  private idle = 0;
  private hint: number | null = null;
  private hintFor: TractorState | null = null;
  private hints: boolean;

  constructor(
    host: HTMLElement,
    private readonly cb: TractorCallbacks,
    private readonly opts: TractorRendererOptions,
  ) {
    super(host, "tractor", cb.onFrame);
    this.hints = opts.hints;
  }

  setHints(on: boolean): void {
    this.hints = on;
  }

  protected build(): void {
    this.label = new Text({ text: "", style: { fontFamily: FONT_MONO, fontSize: 16, fontWeight: "700", fill: INK.cream }, resolution: 2 });
    this.label.anchor.set(0.5);
    this.pieceLayer.sortableChildren = true;
    this.pieceLayer.mask = this.pieceMask;
    this.world.addChild(this.pieceMask, this.bg, this.hintLayer, this.pieceLayer, this.selectLayer, this.cursorLayer, this.label);
  }

  protected layout(width: number, height: number): void {
    const g = this.grid;
    if (this.state) {
      g.cols = this.state.config.width;
      g.rows = this.state.config.height;
    }
    g.fit(width, height, { top: STRIP, margin: 8 });
    const pad = Math.max(4, g.cell * 0.12);
    const strip = g.cell * STRIP;
    // Bare ground under the strip and the field. The field is always full, so no cell needs a dot,
    // and the one hairline is the edge that matters: the hatch over the top row, where a cache is hauled.
    this.bg.clear();
    this.paintGround(this.bg, g.ox - pad, g.oy - strip - pad, g.width + pad * 2, g.height + strip + pad * 2, false);
    const hatch = g.oy - pad / 2;
    this.bg
      .moveTo(g.ox, hatch)
      .lineTo(g.ox + g.width, hatch)
      .stroke({ width: 1, color: INK.line });
    this.pieceMask
      .clear()
      .rect(g.ox - pad, g.oy - pad, g.width + pad * 2, g.height + pad)
      .fill({ color: INK.cream });
    if (this.label) {
      this.label.style.fontSize = Math.max(12, Math.round(g.cell * 0.34));
      this.label.position.set(g.ox + g.width / 2, g.oy - strip * 0.5);
    }
    this.cursor = Math.min(this.cursor, g.cols * (g.rows - 1) - 1);
    this.publishGeom(g.ox, g.oy, g.cell);
    this.select(null);
    if (this.state) this.snap(this.state.cells);
    this.drawCursor();
  }

  /** A piece's picture: its outline says which kind of loot it is, or that it is a cache; a beacon wears its mark. */
  private texture(kind: number, mark?: TractorMark): Texture {
    const cell = this.grid.cell;
    if (kind === TRACTOR_CACHE) return this.piece("cache", cell, TRACTOR_CACHE_COLOR, TRACTOR_CACHE_PAINT);
    const k = tractorKind(kind);
    if (mark !== undefined) return this.piece(`beacon:${k.id}:${mark}`, cell, k.color, tractorBeaconPaint(k, mark));
    return this.piece(`loot:${k.id}`, cell, k.color, k.paint);
  }

  /** Put exactly these pieces on the field, each on its cell, with nothing in motion. */
  private snap(cells: readonly TractorPiece[]): void {
    const seen = new Set<number>();
    cells.forEach((p, cell) => {
      seen.add(p.id);
      let v = this.pieces.get(p.id);
      if (!v) v = this.spawn(p, cell);
      v.cell = cell;
      v.kind = p.kind;
      v.mark = p.mark;
      v.s.texture = this.texture(p.kind, p.mark);
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

  private spawn(p: { id: number; kind: number; mark?: TractorMark }, cell: number): PieceView {
    const s = new Sprite(this.texture(p.kind, p.mark));
    s.anchor.set(0.5);
    s.position.set(this.grid.x(cell), this.grid.y(cell));
    this.pieceLayer.addChild(s);
    const v: PieceView = { s, kind: p.kind, mark: p.mark, cell };
    this.pieces.set(p.id, v);
    return v;
  }

  protected onState(state: TractorState, prev: TractorState | null): void {
    this.select(null);
    this.hint = null;
    this.hintLayer.clear();
    this.idle = 0;
    const g = this.grid;
    if (g.cols !== state.config.width || g.rows !== state.config.height) {
      // A different field (a lab config): lay it out afresh.
      g.cols = state.config.width;
      g.rows = state.config.height;
      this.layout(this.app.screen.width, this.app.screen.height);
      return;
    }
    const r = state.lastMove;
    const a = r ? r.swapped[r.below] : undefined;
    const b = r ? r.swapped[r.cell] : undefined;
    const known = r !== null && prev !== null && a !== undefined && b !== undefined && this.pieces.get(a.id)?.cell === r.cell && this.pieces.get(b.id)?.cell === r.below;
    if (!r || !known) {
      this.snap(state.cells);
      this.refreshPreview();
      return;
    }
    this.play(state, r);
  }

  /** Play a swap out: the two pieces trade places, then each wave goes, fires and settles, then the caches come aboard. */
  private play(state: TractorState, r: TractorMoveReport): void {
    const g = this.grid;
    const L = this.opts.labels;
    const scoring = r.waves.length > 0;

    /** A piece that goes shrinks to nothing where it is. */
    const take = (id: number, delay: number): void => {
      const v = this.pieces.get(id);
      if (!v) return;
      this.pieces.delete(id);
      this.tweens.remove(v.s, { delay, done: () => v.s.destroy() });
    };

    // The swap: each piece slides to the other's cell.
    const up = r.swapped[r.cell]!;
    const down = r.swapped[r.below]!;
    for (const [p, to] of [
      [up, r.cell],
      [down, r.below],
    ] as const) {
      const v = this.pieces.get(p.id);
      if (!v) continue;
      v.cell = to;
      this.tweens.move(v.s, { y: g.y(to) });
    }
    this.tweens.after(0, () => (scoring ? sfx.swap() : sfx.swapQuiet()));
    let t = MOTION.move;
    let longest = 0;
    let fired = 0;
    const marks = new Set<TractorMark>();

    r.waves.forEach((w, wi) => {
      const runCells = w.runs.flatMap((run) => run.cells);
      for (const run of w.runs) longest = Math.max(longest, run.cells.length);
      fired += w.fired.length;
      for (const f of w.fired) marks.add(f.mark);
      // The runs go together, each wave a step higher than the last.
      const runIds = new Set<number>();
      for (const h of w.cleared) if (!w.swept.some((s) => s.id === h.id)) runIds.add(h.id);
      for (const id of runIds) take(id, t);
      const at = t;
      this.tweens.after(at, () => {
        sfx.pop(Math.min(9, wi * 2 + runCells.length - 3));
        if (wi > 0) sfx.clear(wi + 1, runIds.size);
        const cx = runCells.reduce((a, c) => a + g.x(c), 0) / Math.max(1, runCells.length);
        const cy = runCells.reduce((a, c) => a + g.y(c), 0) / Math.max(1, runCells.length);
        this.fx.popup(cx, cy - g.cell * 0.2, `+${w.points}`, INK.cream, Math.max(16, g.cell * (wi > 0 ? 0.5 : 0.44)));
      });
      t += MOTION.clear;
      // Each beacon fires along its lines, and what it sweeps goes after it, nearest first.
      if (w.fired.length > 0) {
        w.fired.forEach((f, fi) => {
          const fat = t + fi * 90;
          this.tweens.after(fat, () => {
            for (const [x0, y0, x1, y1] of this.markLines(f.cell, f.mark)) this.fx.beam([x0, y0, x1, y1], INK.cream, Math.max(2, g.cell * RING_W), 260);
            sfx.zap();
          });
          const sweptHere = new Set(f.swept);
          for (const h of [...w.swept, ...w.caches]) if (sweptHere.has(h.cell)) take(h.id, fat + 60);
        });
        t += w.fired.length * 90 + MOTION.clear;
      }
      for (const st of w.settles) {
        if (st.topped.length > 0) {
          const tat = t;
          for (const h of st.topped) take(h.id, tat);
          this.tweens.after(tat, () => sfx.thud());
          t += MOTION.clear + 40;
        }
        for (const ri of st.rises) {
          const v = this.pieces.get(ri.id);
          if (!v) continue;
          v.cell = ri.to;
          this.tweens.move(v.s, { y: g.y(ri.to) }, { delay: t });
        }
        for (const sp of st.spawned) {
          const v = this.spawn(sp.mark === undefined ? { id: sp.id, kind: sp.kind } : { id: sp.id, kind: sp.kind, mark: sp.mark }, sp.cell);
          // It starts below the field, behind the mask, and rises in.
          v.s.y = g.y(sp.cell) + sp.rise * g.cell;
          this.tweens.move(v.s, { y: g.y(sp.cell) }, { delay: t });
        }
        t += MOTION.move + 30;
      }
    });

    // One callout a swap, and the beat for the two rare things: caches brought aboard together,
    // stronger for each, and a mighty run.
    const k = r.caches.length;
    if (scoring || k > 0) {
      this.tweens.after(t, () => {
        if (k > 0) {
          this.fx.popup(g.ox + g.width / 2, g.oy + g.cell * 0.4, `+${r.cachePoints}`, INK.cream, Math.max(18, g.cell * (k >= 2 ? 0.62 : 0.5)));
          this.fx.say(L.caches(k));
          // The beat has one sound of its own, so caches together play no cue over it.
          if (k >= 2) this.beat(Math.min(1, 0.3 + k * 0.2));
          else sfx.rise();
        } else if (longest >= MIGHTY) {
          this.fx.say(L.longRun);
          this.beat(0.55);
        } else if (fired >= 2) {
          this.fx.say(L.chain);
          sfx.good();
        } else if (fired === 1) this.fx.say(marks.has("cross") ? L.cross : L.saltire);
        else if (longest >= LONG) this.fx.say(L.longRun);
        else if (r.waves.length >= WAVES) this.fx.say(L.wave(r.waves.length));
      });
    }

    if (r.shuffled) {
      this.tweens.after(t, () => {
        this.fx.say(L.scrambled, INK.dim);
        sfx.whoosh();
      });
      t += 120;
    }
    // Whatever the tweens did, the field ends as the engine holds it.
    this.tweens.after(t, () => {
      this.snap(state.cells);
      this.refreshPreview();
    });
  }

  /** The lines a beacon fires along, from its centre to the field's edge, as segments in pixels. */
  private markLines(cell: number, mark: TractorMark): Array<[number, number, number, number]> {
    const g = this.grid;
    const col = cell % g.cols;
    const row = Math.floor(cell / g.cols);
    const dirs =
      mark === "cross"
        ? [
            [0, -1],
            [1, 0],
            [0, 1],
            [-1, 0],
          ]
        : [
            [1, -1],
            [1, 1],
            [-1, 1],
            [-1, -1],
          ];
    const out: Array<[number, number, number, number]> = [];
    for (const [dc, dr] of dirs) {
      let c = col;
      let r = row;
      while (c + dc! >= 0 && c + dc! < g.cols && r + dr! >= 0 && r + dr! < g.rows) {
        c += dc!;
        r += dr!;
      }
      if (c !== col || r !== row) out.push([g.cx(col), g.cy(row), g.cx(c), g.cy(r)]);
    }
    return out;
  }

  protected view(): string {
    const g = this.grid;
    const chars = new Array<string>(g.cols * g.rows).fill(".");
    for (const v of this.pieces.values()) {
      const at = g.at(v.s.x, v.s.y);
      if (at) chars[at.index] = tractorKindChar(v.kind, v.mark);
    }
    return chars.join("");
  }

  protected override update(dt: number): void {
    // A swap worth making pulses after a pause, in rounds that allow hints.
    if (!this.interactive || !this.hints || !this.state || this.state.finished || this.drag || this.busy) {
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
      this.hint = tractorHint(this.state);
    }
    this.hintLayer.clear();
    if (this.hint === null) return;
    // A hint is cream, never amber: it is the board's advice, not the player's own pair.
    const pulse = this.reduced ? 0.8 : 0.55 + 0.4 * Math.sin(this.time / 240);
    this.framePair(this.hintLayer, this.hint, INK.cream, pulse);
  }

  /** A rounded frame round the pair whose top cell is `cell`. */
  private framePair(l: Graphics, cell: number, color: number, alpha = 1): void {
    const g = this.grid;
    const pad = g.cell * PAIR_PAD;
    const x = g.x(cell) - g.cell / 2 + pad;
    const y = g.y(cell) - g.cell / 2 + pad;
    l.roundRect(x, y, g.cell - pad * 2, g.cell * 2 - pad * 2, g.cell * 0.22).stroke({ width: Math.max(2, g.cell * RING_W), color, alpha });
  }

  // ---- the swap

  private trySwap(cell: number): void {
    const state = this.state;
    if (!state || state.finished) return;
    if (this.busy) this.tweens.flush();
    this.select(null);
    this.idle = 0;
    if (tractorSwapIllegalReason(state, cell) !== null) {
      sfx.bump();
      return;
    }
    this.cb.onSwap(cell);
  }

  private select(cell: number | null): void {
    this.selected = cell;
    this.selectLayer.clear();
    if (cell === null) return;
    const g = this.grid;
    // The picked piece is the player's: an amber ring round it.
    this.selectLayer.circle(g.x(cell), g.y(cell), g.cell * 0.45).stroke({ width: Math.max(2, g.cell * RING_W), color: INK.amber });
  }

  /** The strip says what the keyboard's pair is worth, once the keyboard is in use. */
  private refreshPreview(): void {
    const state = this.state;
    if (!state || !this.cursorShown || state.finished) {
      this.setLabel("");
      return;
    }
    const L = this.opts.labels;
    if (tractorSwapIllegalReason(state, this.cursor) !== null) {
      this.setLabel("");
      return;
    }
    const v = tractorSwapValue(state, this.cursor);
    if (!v.scores) this.setLabel(L.previewDud, INK.dim);
    else this.setLabel(L.preview(v.points, v.caches.length), INK.cream);
  }

  private setLabel(text: string, color: number = INK.cream): void {
    if (!this.label) return;
    this.label.text = text;
    this.label.style.fill = color;
  }

  // ---- pointer

  protected override pointerDown(x: number, y: number): void {
    if (!this.interactive || !this.state || this.state.finished) return;
    const at = this.grid.at(x, y);
    if (!at) return;
    this.cursorShown = false;
    this.drawCursor();
    this.refreshPreview();
    this.drag = { cell: at.index, x, y };
  }

  protected override pointerMove(x: number, y: number): void {
    const d = this.drag;
    if (!d) return;
    const dy = y - d.y;
    if (Math.abs(dy) < this.grid.cell * DRAG || Math.abs(dy) < Math.abs(x - d.x)) return;
    this.drag = null;
    // A drag up swaps with the piece above; a drag down with the piece below.
    const top = dy < 0 ? d.cell - this.grid.cols : d.cell;
    if (top < 0) {
      sfx.bump();
      return;
    }
    this.trySwap(top);
  }

  protected override pointerUp(x: number, y: number): void {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const at = this.grid.at(x, y);
    if (!at || at.index !== d.cell) return;
    // A tap picks a piece; a tap on the piece above or below it swaps the two.
    const s = this.selected;
    const cols = this.grid.cols;
    if (s !== null && (at.index === s - cols || at.index === s + cols)) {
      this.trySwap(Math.min(s, at.index));
      return;
    }
    if (s === at.index) {
      this.select(null);
      return;
    }
    if (this.state?.cells[at.index]?.kind === TRACTOR_CACHE) {
      sfx.bump();
      this.select(null);
      return;
    }
    sfx.pop(0);
    this.select(at.index);
  }

  protected override pointerCancel(): void {
    this.drag = null;
  }

  // ---- keyboard

  private drawCursor(): void {
    const g = this.grid;
    this.cursorLayer.clear();
    this.app.canvas.setAttribute("data-cursor", `${this.cursor % g.cols},${Math.floor(this.cursor / g.cols)}`);
    if (!this.cursorShown) return;
    // The keyboard's pair is the player's selection: an amber frame round both pieces.
    this.framePair(this.cursorLayer, this.cursor, INK.amber);
  }

  /** Arrows or WASD move the pair the cursor holds, a cell at a time. Space or enter swaps it. */
  override keyboard(key: string): boolean {
    if (!this.interactive || !this.state) return false;
    const g = this.grid;
    const k = key.length === 1 ? key.toLowerCase() : key;
    const steps: Record<string, readonly [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      a: [-1, 0],
      d: [1, 0],
      w: [0, -1],
      s: [0, 1],
    };
    const step = steps[k];
    if (step) {
      const col = (this.cursor % g.cols) + step[0];
      const row = Math.floor(this.cursor / g.cols) + step[1];
      this.cursorShown = true;
      if (col >= 0 && col < g.cols && row >= 0 && row < g.rows - 1) this.cursor = row * g.cols + col;
      else sfx.bump();
      this.idle = 0;
      this.select(null);
      this.drawCursor();
      this.refreshPreview();
      return true;
    }
    if (k === " " || k === "Enter") {
      this.cursorShown = true;
      this.drawCursor();
      this.trySwap(this.cursor);
      return true;
    }
    if (k === "Escape" && this.selected !== null) {
      this.select(null);
      return true;
    }
    return false;
  }
}
