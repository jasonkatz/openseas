import { Container, Graphics, Sprite, Text } from "pixi.js";
import {
  pouringHint,
  pouringLegalCells,
  pouringPieceCode,
  pouringPourValue,
  pouringSlotValue,
  type PouringAct,
  type PouringPiece,
  type PouringSlot,
  type PouringState,
} from "@openseas/engine";
import { sfx } from "../audio.js";
import { MOTION } from "../look/tokens.js";
import { FONT_MONO, INK, drawDot } from "../kit/art.js";
import { Grid, KitBoard } from "../kit/board.js";
import { pouringPieceLook, pouringSeatRing } from "./pieces.js";

export interface PouringCallbacks {
  /** The player set hand slot `slot` down on `cell`. */
  onPour(slot: number, cell: number): void;
  /** The player downed hand slot `slot`. */
  onDrink(slot: number): void;
  /** First settled frame after a new state. */
  onFrame(): void;
}

export interface PouringLabels {
  /** What the picked drink would score on the square under the cursor, and how many lines it serves. */
  preview(points: number, lines: number): string;
  previewNoFit: string;
  previewWipe: string;
  /** What downing the picked drink would score. */
  previewDrink(points: number): string;
  served: string;
  servedClean: string;
  double: string;
  doubleClean: string;
  downed: string;
  passedOut: string;
  wiped: string;
  tossed: string;
  stolen: string;
  mustDrink: string;
  lastCall: string;
  /** A rival's name over its hand: `n` from 1. */
  rival(n: number): string;
}

export interface PouringRendererOptions {
  /** Show a pour worth making after a pause. Off for recorded rounds. */
  hints: boolean;
  labels: PouringLabels;
}

/** Rows of cells above the bar (the rivals) and below it (the preview line and the player's hand). */
const TOP = 1.25;
const BOTTOM = 2.15;
/** A rival's drinks, and the player's, as a share of a bar square. */
const RIVAL_PIECE = 0.5;
const HAND_PIECE = 1.05;
const HAND_GAP = 1.35;
/** How long each act plays for, so a rival's turn can be followed. */
const ACT_MS = 430;
const HINT_AFTER_MS = 6000;
const RING_W = 0.07;

/**
 * Draws the bar, the rings, the rivals' hands and the player's, and turns taps and keys into a pour
 * or a drink. Plays every act of a turn back in order, the rivals' included. Scores nothing: every
 * number it shows is the engine's.
 */
export class PouringRenderer extends KitBoard<PouringState> {
  private readonly grid = new Grid(6, 6);
  private readonly bg = new Graphics();
  private readonly dots = new Graphics();
  private readonly ringLayer = new Container();
  private readonly hintLayer = new Graphics();
  private readonly pieceLayer = new Container();
  private readonly handLayer = new Container();
  private readonly selectLayer = new Graphics();
  private readonly cursorLayer = new Graphics();
  private readonly textLayer = new Container();
  private label: Text | null = null;
  private readonly bar = new Map<number, { s: Sprite; cell: number; code: string }>();
  /** Each seat's hand as drawn, slot by slot. */
  private hands: Sprite[][] = [];
  private handTexts: Text[] = [];
  private rivalTexts: Text[] = [];
  private rivalRings: Sprite[] = [];
  private ringCells: Array<Sprite | null> = [];
  /** The hand slot the player has picked. */
  private slot = 0;
  /** The keyboard's square. Drawn once a key has been used. */
  private cursor = 0;
  private cursorShown = false;
  private idle = 0;
  private hint: { slot: number; cell: number } | null = null;
  private hintFor: PouringState | null = null;
  private hints: boolean;

  constructor(
    host: HTMLElement,
    private readonly cb: PouringCallbacks,
    private readonly opts: PouringRendererOptions,
  ) {
    super(host, "pouring", cb.onFrame);
    this.hints = opts.hints;
  }

  setHints(on: boolean): void {
    this.hints = on;
  }

  protected build(): void {
    this.label = new Text({ text: "", style: { fontFamily: FONT_MONO, fontSize: 16, fontWeight: "700", fill: INK.cream }, resolution: 2 });
    this.label.anchor.set(0.5);
    this.pieceLayer.sortableChildren = true;
    this.world.addChild(this.bg, this.dots, this.ringLayer, this.hintLayer, this.pieceLayer, this.handLayer, this.selectLayer, this.cursorLayer, this.textLayer, this.label);
  }

  protected layout(width: number, height: number): void {
    const g = this.grid;
    if (this.state) {
      g.cols = this.state.config.size;
      g.rows = this.state.config.size;
    }
    g.fit(width, height, { top: TOP, bottom: BOTTOM, margin: 8 });
    const pad = Math.max(4, g.cell * 0.12);
    this.bg.clear();
    this.paintGround(this.bg, g.ox - pad, g.oy - g.cell * TOP - pad, g.width + pad * 2, g.height + g.cell * (TOP + BOTTOM) + pad * 2, false);
    // The one hairline is the bar's edge: inside it is where drinks stand.
    this.bg.rect(g.ox - 0.5, g.oy - 0.5, g.width + 1, g.height + 1).stroke({ width: 1, color: INK.line });
    if (this.label) {
      this.label.style.fontSize = Math.max(12, Math.round(g.cell * 0.3));
      this.label.position.set(g.ox + g.width / 2, g.oy + g.height + g.cell * 0.32);
    }
    this.cursor = Math.min(this.cursor, g.cols * g.rows - 1);
    this.publishGeom(g.ox, g.oy, g.cell);
    if (this.state) this.snap(this.state);
    this.drawCursor();
  }

  // ---- where things are

  /** The centre of hand slot `slot` of `seat`, and the size its piece is drawn at. */
  private handAt(seat: number, slot: number): { x: number; y: number; size: number } {
    const g = this.grid;
    const offer = this.state?.config.offer ?? 2;
    if (seat === 0) {
      const size = g.cell * HAND_PIECE;
      const x = g.ox + g.width / 2 + (slot - (offer - 1) / 2) * g.cell * HAND_GAP;
      return { x, y: g.oy + g.height + g.cell * 1.2, size };
    }
    const rivals = Math.max(1, (this.state?.seats.length ?? 2) - 1);
    const w = g.width / rivals;
    const cx = g.ox + w * (seat - 1) + w / 2;
    const size = g.cell * RIVAL_PIECE;
    return { x: cx + (slot - (offer - 1) / 2) * size * 1.15 + size * 0.45, y: g.oy - g.cell * 0.78, size };
  }

  private texture(p: Pick<PouringPiece, "kind" | "glass" | "brew">, size: number) {
    const look = pouringPieceLook(p);
    return this.piece(look.key, Math.round(size), look.color, look.paint);
  }

  // ---- drawing a state

  /** Draw exactly this state, with nothing in motion. */
  private snap(state: PouringState): void {
    const g = this.grid;
    const seen = new Set<number>();
    state.cells.forEach((p, cell) => {
      if (!p) return;
      seen.add(p.id);
      let v = this.bar.get(p.id);
      if (!v) {
        const s = new Sprite();
        s.anchor.set(0.5);
        this.pieceLayer.addChild(s);
        v = { s, cell, code: pouringPieceCode(p) };
        this.bar.set(p.id, v);
      }
      v.cell = cell;
      v.code = pouringPieceCode(p);
      v.s.texture = this.texture(p, g.cell);
      v.s.position.set(g.x(cell), g.y(cell));
      v.s.scale.set(1);
      v.s.alpha = 1;
    });
    for (const [id, v] of this.bar) {
      if (seen.has(id)) continue;
      v.s.destroy();
      this.bar.delete(id);
    }
    this.drawRings(state.rings);
    for (let seat = 0; seat < state.seats.length; seat++) this.drawHand(seat, state.seats[seat]!.hand);
    this.drawRivals(state);
    this.slot = Math.min(this.slot, state.config.offer - 1);
    this.refresh();
    this.touchView();
  }

  private drawRings(rings: readonly number[]): void {
    const g = this.grid;
    for (const s of this.ringCells) s?.destroy();
    this.ringCells = rings.map((seat, cell) => {
      if (seat < 0) return null;
      const r = pouringSeatRing(seat);
      const s = new Sprite(this.piece(r.key, g.cell, r.color, r.paint, 22 / 24));
      s.anchor.set(0.5);
      s.position.set(g.x(cell), g.y(cell));
      this.ringLayer.addChild(s);
      return s;
    });
  }

  private drawHand(seat: number, hand: readonly PouringSlot[]): void {
    for (const s of this.hands[seat] ?? []) s.destroy();
    this.hands[seat] = hand.map((h, slot) => {
      const at = this.handAt(seat, slot);
      const s = new Sprite(this.texture(h.piece, at.size));
      s.anchor.set(0.5);
      s.position.set(at.x, at.y);
      this.handLayer.addChild(s);
      return s;
    });
    if (seat === 0) {
      const g = this.grid;
      const cfg = this.state?.config;
      for (const t of this.handTexts) t.destroy();
      this.handTexts = hand.map((h, slot) => {
        const at = this.handAt(0, slot);
        const t = new Text({ text: cfg ? `${pouringSlotValue(cfg, h)}` : "", style: { fontFamily: FONT_MONO, fontSize: Math.max(11, Math.round(g.cell * 0.26)), fontWeight: "700", fill: INK.dim }, resolution: 2 });
        t.anchor.set(0.5);
        t.position.set(at.x, at.y + g.cell * 0.8);
        this.textLayer.addChild(t);
        return t;
      });
    }
  }

  /** Over each rival's hand: its ring, its name and its points. */
  private drawRivals(state: PouringState): void {
    const g = this.grid;
    for (const t of this.rivalTexts) t.destroy();
    for (const s of this.rivalRings) s.destroy();
    this.rivalTexts = [];
    this.rivalRings = [];
    for (let seat = 1; seat < state.seats.length; seat++) {
      const first = this.handAt(seat, 0);
      const r = pouringSeatRing(seat);
      const ring = new Sprite(this.piece(r.key, Math.round(g.cell * RIVAL_PIECE), r.color, r.paint, 22 / 24));
      ring.anchor.set(0.5);
      ring.position.set(first.x - first.size * 1.2, first.y);
      this.handLayer.addChild(ring);
      this.rivalRings.push(ring);
      const st = state.seats[seat]!;
      const t = new Text({
        text: `${this.opts.labels.rival(seat)}  ${st.score}${st.asleep ? "  z" : ""}`,
        style: { fontFamily: FONT_MONO, fontSize: Math.max(10, Math.round(g.cell * 0.22)), fontWeight: "700", fill: INK.dim },
        resolution: 2,
      });
      t.anchor.set(0.5);
      t.position.set(first.x - first.size * 1.2 + (g.width / Math.max(1, state.seats.length - 1)) * 0.36, g.oy - g.cell * 0.3);
      this.textLayer.addChild(t);
      this.rivalTexts.push(t);
    }
  }

  protected onState(state: PouringState, prev: PouringState | null): void {
    this.hint = null;
    this.hintLayer.clear();
    this.idle = 0;
    const g = this.grid;
    if (g.cols !== state.config.size || (prev && prev.seats.length !== state.seats.length) || (prev && prev.config.offer !== state.config.offer)) {
      g.cols = state.config.size;
      g.rows = state.config.size;
      this.layout(this.app.screen.width, this.app.screen.height);
      return;
    }
    const r = state.lastMove;
    const known = r !== null && prev !== null && r.acts.length > 0 && prev.moveCount + 1 === state.moveCount;
    if (!r || !known) {
      this.snap(state);
      return;
    }
    this.play(state, r.acts);
  }

  /** Play a turn back: the player's act, then each rival's, one after another, then snap to the engine's state. */
  private play(state: PouringState, acts: readonly PouringAct[]): void {
    const L = this.opts.labels;
    this.selectLayer.clear();
    this.dots.clear();
    this.setLabel("");
    let t = 0;
    acts.forEach((a) => {
      const at = t;
      this.tweens.after(at, () => this.playAct(a));
      t += a.type === "sleep" ? ACT_MS * 0.6 : a.seat === 0 ? ACT_MS : ACT_MS + 60;
    });
    if (state.finished) this.tweens.after(t, () => this.fx.say(L.lastCall, INK.dim));
    this.tweens.after(t, () => {
      this.snap(state);
      if (!state.finished && state.seats[0]!.hand.every((_, s) => pouringLegalCells(state, s).length === 0)) {
        this.fx.say(L.mustDrink, INK.dim);
      }
    });
  }

  /** One act as it happens: the drink flies from its hand to its square, the lines go, the hand is dealt again. */
  private playAct(a: PouringAct): void {
    const g = this.grid;
    const L = this.opts.labels;
    const mine = a.seat === 0;
    const handSprite = a.slot >= 0 ? this.hands[a.seat]?.[a.slot] : undefined;
    if (a.type === "sleep") {
      const at = this.handAt(a.seat, 0);
      this.fx.popup(at.x, at.y, "z", INK.dim, Math.max(14, g.cell * 0.3));
      if (mine) this.fx.say(L.passedOut, INK.dim);
      return;
    }
    if (a.type === "drink" || a.type === "toss") {
      if (handSprite) this.tweens.remove(handSprite, { done: () => void (handSprite.visible = false) });
      const at = this.handAt(a.seat, a.slot);
      if (a.type === "drink") {
        this.fx.popup(at.x, at.y - at.size * 0.6, `+${a.points}`, mine ? INK.cream : INK.dim, Math.max(14, g.cell * (mine ? 0.4 : 0.28)));
        sfx.rise();
        if (a.passedOut) {
          this.tweens.after(MOTION.clear, () => {
            this.fx.say(mine ? L.passedOut : `${L.rival(a.seat)}: ${L.passedOut}`, INK.dim);
            sfx.thud();
          });
        } else if (mine) this.fx.say(L.downed, INK.dim);
      } else {
        if (mine) this.fx.say(L.tossed, INK.dim);
        sfx.whoosh();
      }
      this.tweens.after(MOTION.clear + 20, () => this.drawHand(a.seat, a.hand));
      return;
    }
    // A pour or a wipe: what was in hand flies to its square.
    if (handSprite) {
      handSprite.zIndex = 10;
      this.handLayer.removeChild(handSprite);
      this.pieceLayer.addChild(handSprite);
      this.tweens.to(handSprite, { x: g.x(a.cell), y: g.y(a.cell) }, MOTION.move * 1.6);
      if (a.type === "pour") {
        this.tweens.to(handSprite, { scale: g.cell / Math.max(1, handSprite.texture.width) }, MOTION.move * 1.6);
      }
    }
    const land = MOTION.move * 1.6;
    if (a.type === "wipe") {
      this.tweens.after(land, () => {
        sfx.whoosh();
        const v = a.wiped ? this.bar.get(a.wiped.id) : undefined;
        if (v) {
          this.bar.delete(a.wiped!.id);
          this.tweens.remove(v.s, { done: () => v.s.destroy() });
        }
        if (handSprite) this.tweens.remove(handSprite, { done: () => handSprite.destroy() });
        this.hands[a.seat] = (this.hands[a.seat] ?? []).filter((s) => s !== handSprite);
        this.fx.say(mine ? L.wiped : `${L.rival(a.seat)}: ${L.wiped}`, mine ? INK.cream : INK.dim);
        this.drawHand(a.seat, a.hand);
      });
      return;
    }
    this.tweens.after(land, () => {
      // The drink is on the bar now: it becomes the square's piece.
      if (handSprite && a.piece) {
        this.hands[a.seat] = (this.hands[a.seat] ?? []).filter((s) => s !== handSprite);
        handSprite.texture = this.texture(a.piece, g.cell);
        handSprite.scale.set(1);
        handSprite.zIndex = 0;
        this.bar.set(a.piece.id, { s: handSprite, cell: a.cell, code: pouringPieceCode(a.piece) });
      }
      this.drawRings(a.rings);
      sfx.pop(Math.min(9, a.lines.length * 3 + (a.clean ? 1 : 0)));
      const k = a.lines.length;
      if (k > 0) {
        for (const tk of a.taken) {
          const v = this.bar.get(tk.id);
          if (!v) continue;
          this.bar.delete(tk.id);
          this.tweens.remove(v.s, { delay: 60, done: () => v.s.destroy() });
        }
        this.fx.popup(g.x(a.cell), g.y(a.cell) - g.cell * 0.3, `+${a.points}`, mine ? INK.cream : INK.dim, Math.max(16, g.cell * (k >= 2 ? 0.6 : 0.46)));
        if (mine) {
          if (k >= 2) {
            // The named compound move: a row and a column at once. The beat has its own sound.
            this.fx.say(a.clean ? L.doubleClean : L.double, INK.amber);
            this.beat(a.clean ? 1 : 0.7);
          } else {
            this.fx.say(a.clean ? L.servedClean : L.served);
            if (a.clean) sfx.good();
            else sfx.clear(1, a.taken.length);
          }
        } else {
          this.fx.say(`${L.rival(a.seat)}: ${L.stolen}`, INK.dim);
          sfx.bad();
        }
      } else if (mine) {
        this.fx.popup(g.x(a.cell), g.y(a.cell) - g.cell * 0.3, `+${a.points}`, INK.cream, Math.max(14, g.cell * 0.36));
      }
      this.drawHand(a.seat, a.hand);
    });
  }

  protected view(): string {
    const g = this.grid;
    const chars = new Array<string>(g.cols * g.rows).fill("..");
    for (const v of this.bar.values()) {
      const at = g.at(v.s.x, v.s.y);
      if (at) chars[at.index] = v.code;
    }
    return chars.join("");
  }

  // ---- the picked drink, its squares and the preview

  /** Mark the squares the picked drink may go on, frame it in hand, and say what the cursor's square is worth. */
  private refresh(): void {
    const state = this.state;
    const g = this.grid;
    this.dots.clear();
    this.selectLayer.clear();
    if (!state) return;
    const legal = new Set(state.finished ? [] : pouringLegalCells(state, this.slot));
    const rag = state.seats[0]!.hand[this.slot]?.piece.kind === "rag";
    state.cells.forEach((p, cell) => {
      if (p === null) {
        if (legal.has(cell)) this.dots.circle(g.x(cell), g.y(cell), g.cell * 0.11).fill({ color: INK.cream, alpha: 0.75 });
        else drawDot(this.dots, g.x(cell), g.y(cell), g.cell);
      } else if (rag && legal.has(cell)) {
        this.dots.circle(g.x(cell), g.y(cell), g.cell * 0.46).stroke({ width: 1, color: INK.cream, alpha: 0.5 });
      }
    });
    if (!state.finished && this.interactive) {
      const at = this.handAt(0, this.slot);
      // The picked drink is the player's: an amber frame round it.
      this.selectLayer.roundRect(at.x - at.size * 0.6, at.y - at.size * 0.6, at.size * 1.2, at.size * 1.2, at.size * 0.2).stroke({ width: Math.max(2, g.cell * RING_W), color: INK.amber });
    }
    this.refreshPreview();
  }

  private refreshPreview(): void {
    const state = this.state;
    const L = this.opts.labels;
    if (!state || state.finished) {
      this.setLabel("");
      return;
    }
    if (!this.cursorShown) {
      // Before the keyboard is used, the line says what downing the picked drink would score.
      const held = state.seats[0]!.hand[this.slot];
      this.setLabel(held && held.piece.kind !== "rag" && this.interactive ? L.previewDrink(pouringSlotValue(state.config, held)) : "", INK.dim);
      return;
    }
    const v = pouringPourValue(state, this.slot, this.cursor);
    const piece = state.seats[0]!.hand[this.slot]?.piece;
    if (!v.legal) this.setLabel(L.previewNoFit, INK.dim);
    else if (piece?.kind === "rag") this.setLabel(L.previewWipe, INK.cream);
    else this.setLabel(L.preview(v.points, v.lines.length), INK.cream);
  }

  private setLabel(text: string, color: number = INK.cream): void {
    if (!this.label) return;
    this.label.text = text;
    this.label.style.fill = color;
  }

  protected override onInteractive(): void {
    this.refresh();
  }

  protected override update(dt: number): void {
    if (!this.interactive || !this.hints || !this.state || this.state.finished || this.busy) {
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
      this.hint = pouringHint(this.state);
    }
    this.hintLayer.clear();
    if (this.hint === null) return;
    // A hint is cream, never amber: it is the board's advice, not the player's own pick.
    const g = this.grid;
    const pulse = this.reduced ? 0.8 : 0.55 + 0.4 * Math.sin(this.time / 240);
    const hs = this.handAt(0, this.hint.slot);
    this.hintLayer.circle(g.x(this.hint.cell), g.y(this.hint.cell), g.cell * 0.44).stroke({ width: Math.max(2, g.cell * RING_W), color: INK.cream, alpha: pulse });
    this.hintLayer.circle(hs.x, hs.y, hs.size * 0.56).stroke({ width: Math.max(2, g.cell * RING_W), color: INK.cream, alpha: pulse });
  }

  // ---- input

  private pick(slot: number): void {
    const state = this.state;
    if (!state || state.finished) return;
    if (this.busy) this.tweens.flush();
    if (slot === this.slot) {
      // A second tap on the picked drink downs it.
      this.drink();
      return;
    }
    this.slot = slot;
    this.idle = 0;
    sfx.pop(0);
    this.refresh();
  }

  private drink(): void {
    const state = this.state;
    if (!state || state.finished) return;
    if (this.busy) this.tweens.flush();
    this.idle = 0;
    this.cb.onDrink(this.slot);
  }

  private pour(cell: number): void {
    const state = this.state;
    if (!state || state.finished) return;
    if (this.busy) this.tweens.flush();
    this.idle = 0;
    if (!pouringPourValue(state, this.slot, cell).legal) {
      sfx.bump();
      return;
    }
    this.cb.onPour(this.slot, cell);
  }

  /** The hand slot under a point, or -1. */
  private slotAt(x: number, y: number): number {
    const state = this.state;
    if (!state) return -1;
    for (let s = 0; s < state.config.offer; s++) {
      const at = this.handAt(0, s);
      if (Math.abs(x - at.x) <= at.size * 0.62 && Math.abs(y - at.y) <= at.size * 0.62) return s;
    }
    return -1;
  }

  protected override pointerUp(x: number, y: number): void {
    if (!this.interactive || !this.state || this.state.finished) return;
    this.cursorShown = false;
    this.drawCursor();
    const slot = this.slotAt(x, y);
    if (slot >= 0) {
      this.pick(slot);
      return;
    }
    const at = this.grid.at(x, y);
    if (at) this.pour(at.index);
  }

  private drawCursor(): void {
    const g = this.grid;
    this.cursorLayer.clear();
    this.app.canvas.setAttribute("data-cursor", `${this.cursor % g.cols},${Math.floor(this.cursor / g.cols)}`);
    this.app.canvas.setAttribute("data-slot", `${this.slot}`);
    if (!this.cursorShown) return;
    this.cursorLayer.roundRect(g.x(this.cursor) - g.cell * 0.46, g.y(this.cursor) - g.cell * 0.46, g.cell * 0.92, g.cell * 0.92, g.cell * 0.18).stroke({ width: Math.max(2, g.cell * RING_W), color: INK.amber });
  }

  /** Arrows or WASD move the cursor on the bar; 1 to 3 pick a drink; space or enter pours it; X downs it. */
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
      if (col >= 0 && col < g.cols && row >= 0 && row < g.rows) this.cursor = row * g.cols + col;
      else sfx.bump();
      this.idle = 0;
      this.drawCursor();
      this.refreshPreview();
      return true;
    }
    if (k >= "1" && k <= "3") {
      const slot = Number(k) - 1;
      if (slot < this.state.config.offer && slot !== this.slot) {
        this.slot = slot;
        sfx.pop(0);
        this.refresh();
        this.drawCursor();
      }
      return true;
    }
    if (k === "x") {
      this.drink();
      return true;
    }
    if (k === " " || k === "Enter") {
      this.cursorShown = true;
      this.drawCursor();
      this.pour(this.cursor);
      return true;
    }
    return false;
  }
}
