import { Container, Graphics, Sprite, Text } from "pixi.js";
import {
  pactHint,
  pactMinBid,
  pactMoveIllegalReason,
  pactPlayable,
  pactRankOf,
  pactSuitOf,
  pactViewString,
  type PactCount,
  type PactEvent,
  type PactMove,
  type PactState,
} from "@openseas/engine";
import { sfx } from "../audio.js";
import { FONT, FONT_MONO, INK } from "../kit/art.js";
import { KitBoard } from "../kit/board.js";
import { MOTION, ink } from "../look/tokens.js";
import { PACT_NIL, PACT_SUITS, PACT_TRICK } from "./pieces.js";

export interface PactCallbacks {
  /** The player bid, played a card, or dealt the next hand. */
  onMove(move: PactMove): void;
  /** Another seat is to act and the board has shown everything before it: let it act. */
  onNext(): void;
  /** First settled frame after a new state. */
  onFrame(): void;
}

export interface PactLabels {
  /** The seats' names, by seat: you, left, partner, right. */
  seats: readonly [string, string, string, string];
  bidPrompt: string;
  pickBid: string;
  bidButton(bid: number): string;
  bidNilButton: string;
  nil: string;
  bidOf(bid: number): string;
  waiting(name: string): string;
  waitingBid(name: string): string;
  yourTurn: string;
  yourLead: string;
  broken: string;
  trickYou: string;
  trickPartner: string;
  trickThem(name: string): string;
  deal: string;
  lastHand: string;
  countTitle(hand: number): string;
  countPact(took: number, pact: number): string;
  made: string;
  short: string;
  nilMade: string;
  nilLost: string;
  bags(bags: number): string;
  penalty: string;
  set: string;
  added(points: number): string;
  total(total: number): string;
  us: string;
  them: string;
  calloutMade: string;
  calloutShort: string;
  calloutNil: string;
  calloutSet: string;
}

export interface PactRendererOptions {
  /** Frame a bid or card worth making after a pause. Off for recorded rounds. */
  hints: boolean;
  labels: PactLabels;
}

/** What the table shows at one moment of playing a move out: built from a state, stepped by its events. */
interface Shown {
  hand: number[];
  trick: Array<{ seat: number; card: number }>;
  bids: Array<number | null>;
  tricks: number[];
  phase: PactState["phase"];
  toAct: number;
  count: { us: PactCount; them: PactCount } | null;
}

interface CardView {
  box: Container;
  face: Sprite;
  rank: Text;
  suit: Sprite;
  w: number;
  h: number;
}

interface SeatView {
  name: Text;
  bid: Text;
  mark: Sprite;
  tricks: Text;
  /** Where the seat's label sits, and where its card lands in a trick. */
  x: number;
  y: number;
  tx: number;
  ty: number;
}

interface Hit {
  x: number;
  y: number;
  w: number;
  h: number;
}

const RANKS = "23456789TJQKA";
/** The suits left to right in the player's hand: spades, hearts, clubs, diamonds, so colours alternate. */
const SUIT_ORDER = [3, 2, 0, 1];
/** The board's own pace for another seat's card, and for its bid: long enough to see who played what. */
const TABLE_PACE = 900;
const BID_PACE = 700;
/** How long a whole trick stays on the table before it goes to its taker. */
const TRICK_HOLD = 1100;
const HINT_AFTER_MS = 6000;

/** The board's layout, in units of `u` from the board's corner (`ox`, `oy`). The smoke test reads the same numbers. */
export const PACT_LAYOUT = {
  width: 10,
  height: 14.5,
  /** The hand: two rows, the first holding the larger half, each centred. */
  handRows: [9.9, 11.8],
  cardW: 1.25,
  cardH: 1.75,
  cardPitch: 1.33,
  /** The bid buttons: three rows of five (nil and 1 to 4, 5 to 9, 10 to 13), centred. */
  bidRows: [3.25, 4.45, 5.65],
  bidW: 1.05,
  bidH: 1.0,
  bidPitch: 1.15,
  /** The one wide button at the foot: bid, or deal the next hand. */
  buttonY: 13.55,
  buttonW: 5,
  buttonH: 1.1,
} as const;

/** The display order of a hand: by suit (spades, hearts, clubs, diamonds), high to low. */
export function pactHandOrder(cards: readonly number[]): number[] {
  return [...cards].sort((a, b) => {
    const sa = SUIT_ORDER.indexOf(pactSuitOf(a));
    const sb = SUIT_ORDER.indexOf(pactSuitOf(b));
    return sa !== sb ? sa - sb : pactRankOf(b) - pactRankOf(a);
  });
}

/** The centre of the k-th of `n` cards in the hand, in units from the board's corner. */
export function pactCardAt(k: number, n: number): { x: number; y: number } {
  const L = PACT_LAYOUT;
  const first = Math.ceil(n / 2);
  const row = k < first ? 0 : 1;
  const inRow = row === 0 ? first : n - first;
  const i = row === 0 ? k : k - first;
  return { x: L.width / 2 + (i - (inRow - 1) / 2) * L.cardPitch, y: L.handRows[row]! };
}

/** The centre of the bid button for `bid` (0 is nil), in units from the board's corner. */
export function pactBidAt(bid: number): { x: number; y: number } {
  const L = PACT_LAYOUT;
  const row = bid < 5 ? 0 : bid < 10 ? 1 : 2;
  const i = row === 0 ? bid : row === 1 ? bid - 5 : bid - 10;
  return { x: L.width / 2 + (i - 2) * L.bidPitch, y: L.bidRows[row]! };
}

/** Draws the table and turns a tap or a key into a bid, a card or a deal. Scores nothing: every number it shows is the engine's. */
export class PactRenderer extends KitBoard<PactState> {
  private readonly bg = new Graphics();
  private readonly marks = new Graphics();
  private readonly table = new Container();
  private readonly buttonsLayer = new Graphics();
  private readonly hintLayer = new Graphics();
  private readonly fxLayer = new Container();
  private seats: SeatView[] = [];
  private hand: CardView[] = [];
  private trick: CardView[] = [];
  private bidLabels: Text[] = [];
  private bidPrompt: Text | null = null;
  private button: Text | null = null;
  private status: Text | null = null;
  private countLines: Text[] = [];
  private u = 10;
  private ox = 0;
  private oy = 0;
  private shown: Shown | null = null;
  private nextFor: PactState | null = null;
  private wait = 0;
  private idle = 0;
  private hint: PactMove | null = null;
  private hintFor: PactState | null = null;
  private hints: boolean;
  /** The bid picked and not yet made. */
  private pick: number | null = null;
  /** The keyboard's card: an index into the hand as drawn, or -1 until an arrow is pressed. */
  private cursor = -1;

  constructor(
    host: HTMLElement,
    private readonly cb: PactCallbacks,
    private readonly opts: PactRendererOptions,
  ) {
    super(host, "pact", cb.onFrame);
    this.hints = opts.hints;
  }

  setHints(on: boolean): void {
    this.hints = on;
  }

  protected build(): void {
    this.world.addChild(this.bg, this.buttonsLayer, this.marks, this.table, this.hintLayer, this.fxLayer);
  }

  private text(size: number, color: number, mono = false): Text {
    const t = new Text({ text: "", style: { fontFamily: mono ? FONT_MONO : FONT, fontSize: Math.max(10, Math.round(size)), fontWeight: "700", fill: color }, resolution: 2 });
    t.anchor.set(0.5);
    return t;
  }

  private card(w: number, h: number, parent: Container = this.table): CardView {
    const box = new Container();
    const face = new Sprite();
    face.anchor.set(0.5);
    const rank = this.text(h * 0.32, INK.cream, true);
    rank.position.set(0, -h * 0.22);
    const suit = new Sprite();
    suit.anchor.set(0.5);
    suit.position.set(0, h * 0.18);
    box.addChild(face, rank, suit);
    parent.addChild(box);
    return { box, face, rank, suit, w, h };
  }

  /** A card tile: raised, with a hairline, so it sits on the ground without a frame of its own. */
  private tile(w: number, h: number): ReturnType<KitBoard<PactState>["piece"]> {
    return this.bake(`pact:tile:${Math.round(w)}x${Math.round(h)}`, Math.ceil(Math.max(w, h)) + 2, (g) => {
      g.roundRect(-w / 2, -h / 2, w, h, Math.max(3, w * 0.12))
        .fill(INK.raised)
        .stroke({ width: 1, color: INK.line });
    });
  }

  /** Show a card face up, or nothing (undefined). */
  private setCard(v: CardView, card: number | undefined): void {
    v.box.visible = card !== undefined;
    if (card === undefined) return;
    const suit = PACT_SUITS[pactSuitOf(card)]!;
    v.face.texture = this.tile(v.w, v.h);
    v.rank.text = RANKS[pactRankOf(card)]!;
    v.rank.style.fill = ink(suit.color);
    v.suit.texture = this.piece(suit.id, v.w * 0.66, suit.color, suit.paint);
  }

  protected layout(width: number, height: number): void {
    const L = PACT_LAYOUT;
    const u = Math.max(8, Math.min(width / L.width, height / L.height));
    this.u = u;
    const ox = (width - L.width * u) / 2;
    const oy = (height - L.height * u) / 2;
    this.ox = ox;
    this.oy = oy;
    this.bg.clear();
    this.paintGround(this.bg, ox, oy, L.width * u, L.height * u, false);
    // The one hairline: the edge of the player's own seat, between the table and the hand.
    this.bg
      .moveTo(ox + u * 0.5, oy + 8.85 * u)
      .lineTo(ox + 9.5 * u, oy + 8.85 * u)
      .stroke({ width: 1, color: INK.line });
    this.table.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.fxLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.seats = [];
    this.hand = [];
    this.trick = [];
    this.bidLabels = [];
    this.countLines = [];
    const cx = ox + 5 * u;
    const P = (x: number, y: number): [number, number] => [ox + x * u, oy + y * u];

    // The seats: the player at the foot, the left rival, the partner across, the right rival. Each says its bid and its tricks.
    const where: Array<{ label: [number, number]; card: [number, number] }> = [
      { label: P(5, 8.35), card: P(5, 6.35) },
      { label: P(1.15, 4.6), card: P(3.45, 4.75) },
      { label: P(5, 1.0), card: P(5, 3.15) },
      { label: P(8.85, 4.6), card: P(6.55, 4.75) },
    ];
    where.forEach((w, i) => {
      const name = this.text(u * 0.32, i === 0 ? INK.amber : INK.cream);
      const bid = this.text(u * 0.28, INK.dim);
      const mark = new Sprite();
      mark.anchor.set(0.5);
      const tricks = this.text(u * 0.3, INK.cream, true);
      const [x, y] = w.label;
      if (i === 0) {
        // The player's own line runs across: name, bid, tricks.
        name.position.set(x - 1.9 * u, y);
        bid.position.set(x, y);
        mark.position.set(x + 1.6 * u, y);
        tricks.position.set(x + 2.1 * u, y);
      } else {
        name.position.set(x, y - 0.42 * u);
        bid.position.set(x, y);
        mark.position.set(x - 0.25 * u, y + 0.45 * u);
        tricks.position.set(x + 0.2 * u, y + 0.45 * u);
      }
      this.table.addChild(name, bid, mark, tricks);
      this.seats.push({ name, bid, mark, tricks, x, y, tx: w.card[0], ty: w.card[1] });
    });
    // The trick: one card a seat, laid toward its seat.
    for (let i = 0; i < 4; i++) {
      const c = this.card(1.2 * u, 1.65 * u);
      c.box.position.set(this.seats[i]!.tx, this.seats[i]!.ty);
      this.trick.push(c);
    }
    // The hand: thirteen tiles, placed as the hand shrinks.
    for (let k = 0; k < 13; k++) this.hand.push(this.card(L.cardW * u, L.cardH * u));
    // The bids: a prompt and fourteen buttons.
    this.bidPrompt = this.text(u * 0.32, INK.cream);
    this.bidPrompt.position.set(cx, oy + 2.4 * u);
    this.table.addChild(this.bidPrompt);
    for (let b = 0; b <= 13; b++) {
      const t = this.text(u * 0.36, INK.cream, b > 0);
      const at = pactBidAt(b);
      t.position.set(ox + at.x * u, oy + at.y * u);
      this.table.addChild(t);
      this.bidLabels.push(t);
    }
    // The count of a hand: a title and a few lines for each side.
    for (let k = 0; k < 7; k++) {
      const t = this.text(u * (k === 0 ? 0.36 : k === 1 || k === 4 ? 0.3 : 0.27), k === 0 ? INK.cream : INK.dim, k === 1 || k === 4);
      t.position.set(cx, oy + [2.2, 2.85, 3.3, 3.7, 5.05, 5.5, 5.9][k]! * u);
      this.table.addChild(t);
      this.countLines.push(t);
    }
    this.status = this.text(u * 0.3, INK.dim);
    this.status.position.set(cx, oy + 7.65 * u);
    this.button = this.text(u * 0.38, INK.cream);
    this.button.position.set(cx, oy + L.buttonY * u);
    this.table.addChild(this.status, this.button);
    // The smoke test reads the board's corner and its unit, and places the hand and the bids by PACT_LAYOUT.
    this.publishGeom(ox, oy, u);
    if (this.state) this.snap(this.state);
  }

  private fromState(state: PactState): Shown {
    return {
      hand: pactHandOrder(state.seats[0]!.cards),
      trick: [...state.trick],
      bids: state.seats.map((s) => s.bid),
      tricks: state.seats.map((s) => s.tricks),
      phase: state.phase,
      toAct: state.toAct,
      count: state.count,
    };
  }

  /** Put exactly the engine's table on the board, with nothing in motion. */
  private snap(state: PactState): void {
    this.shown = this.fromState(state);
    if (this.cursor >= this.shown.hand.length) this.cursor = this.shown.hand.length - 1;
    this.draw();
    this.touchView();
  }

  private unit(x: number, y: number): { x: number; y: number } {
    return { x: this.ox + x * this.u, y: this.oy + y * this.u };
  }

  /** Draw `this.shown`. */
  private draw(): void {
    const v = this.shown;
    const state = this.state;
    if (!v || !state || this.seats.length !== 4) return;
    const u = this.u;
    const L = this.opts.labels;
    this.marks.clear();
    const live = v.phase === state.phase && !state.finished;
    const legal = new Set(live && v.phase === "play" ? pactPlayable(state) : []);

    // The seats.
    this.seats.forEach((view, i) => {
      view.name.text = L.seats[i as 0 | 1 | 2 | 3];
      const bid = v.bids[i];
      view.bid.text = bid === null || bid === undefined ? "" : bid === 0 ? L.nil : L.bidOf(bid);
      const nil = bid === 0;
      const p = nil ? PACT_NIL : PACT_TRICK;
      view.mark.texture = this.piece(p.id, u * 0.38, p.color, p.paint);
      view.mark.visible = bid !== null && bid !== undefined;
      view.tricks.visible = view.mark.visible;
      view.tricks.text = String(v.tricks[i] ?? 0);
      // The seat to act: an amber ring round its label. Amber is the active thing.
      if (v.toAct === i && v.phase !== "over") {
        const w = i === 0 ? 6.2 * u : 1.95 * u;
        const h = i === 0 ? 0.7 * u : 1.55 * u;
        const y = i === 0 ? view.y : view.y + 0.02 * u;
        this.marks.roundRect(view.x - w / 2, y - h / 2, w, h, 0.22 * u).stroke({ width: Math.max(2, u * 0.06), color: INK.amber });
      }
    });

    // The trick on the table.
    this.trick.forEach((c, seat) => {
      this.setCard(c, v.trick.find((t) => t.seat === seat)?.card);
      c.box.position.set(this.seats[seat]!.tx, this.seats[seat]!.ty);
      c.box.alpha = 1;
      c.box.scale.set(1);
    });

    // The hand.
    const n = v.hand.length;
    this.hand.forEach((c, k) => {
      const card = v.hand[k];
      this.setCard(c, card);
      if (card === undefined) return;
      const at = pactCardAt(k, n);
      const ok = legal.has(card);
      // A card that can be played stands a little proud; the rest dim while the player is to play.
      c.box.position.set(this.ox + at.x * u, this.oy + (at.y - (ok && this.interactive ? 0.12 : 0)) * u);
      c.box.alpha = live && v.phase === "play" && !ok ? 0.4 : 1;
      c.box.scale.set(1);
      if (k === this.cursor && live && v.phase === "play" && this.interactive) {
        const pad = 0.08 * u;
        this.marks.roundRect(c.box.x - c.w / 2 - pad, c.box.y - c.h / 2 - pad, c.w + pad * 2, c.h + pad * 2, 0.22 * u).stroke({ width: Math.max(2, u * 0.06), color: INK.amber });
      }
    });

    // The bids, while the player is to bid.
    const bidding = live && v.phase === "bid";
    const min = pactMinBid(state.config);
    if (this.bidPrompt) {
      this.bidPrompt.visible = bidding;
      this.bidPrompt.text = L.bidPrompt;
    }
    this.bidLabels.forEach((t, b) => {
      t.visible = bidding;
      t.text = b === 0 ? L.nil : String(b);
      t.style.fill = b < min ? INK.dim : b === this.pick ? INK.ground : INK.cream;
    });

    // The count, between hands.
    const c = v.phase === "over" ? v.count : null;
    const lines = c ? this.countText(c, state) : [];
    this.countLines.forEach((t, k) => {
      t.visible = lines[k] !== undefined;
      t.text = lines[k] ?? "";
    });
    if (c) {
      this.countLines[1]!.style.fill = INK.amber;
      this.countLines[4]!.style.fill = INK.cream;
    }
    this.drawButtons();
  }

  /** The count of a hand as lines: a title, then for each side its points, its pact and what else it scored. */
  private countText(c: { us: PactCount; them: PactCount }, state: PactState): string[] {
    const L = this.opts.labels;
    const side = (name: string, s: PactCount): [string, string, string] => {
      const pact = s.pact > 0 ? `${L.countPact(s.took, s.pact)}: ${s.took >= s.pact ? L.made : L.short}` : "";
      const extra: string[] = [];
      for (const n of s.nils) extra.push(n.made ? L.nilMade : L.nilLost);
      if (s.bags > 0) extra.push(L.bags(s.bags));
      if (s.penalty > 0) extra.push(L.penalty);
      if (s.setPoints > 0) extra.push(L.set);
      return [`${name}  ${L.added(s.added)}  ·  ${L.total(s.total)}`, pact, extra.join("  ·  ")];
    };
    return [L.countTitle(state.hand), ...side(L.us, c.us), ...side(L.them, c.them)];
  }

  private drawButtons(): void {
    const state = this.state;
    const g = this.buttonsLayer;
    g.clear();
    if (!state || !this.shown) return;
    // Whose turn it is, for the smoke test: bid, play, table, over or finished.
    this.app.canvas.setAttribute("data-phase", state.finished ? "finished" : state.phase);
    const u = this.u;
    const L = this.opts.labels;
    const live = this.shown.phase === state.phase && !state.finished && this.interactive;
    const bidding = this.shown.phase === "bid" && state.phase === "bid" && !state.finished;
    const min = pactMinBid(state.config);
    if (bidding) {
      for (let b = 0; b <= 13; b++) {
        const r = this.bidRect(b);
        const on = live && b >= min;
        g.roundRect(r.x, r.y, r.w, r.h, u * 0.2).fill(b === this.pick ? INK.amber : on ? INK.raised : INK.ground);
        if (on && b !== this.pick) g.roundRect(r.x, r.y, r.w, r.h, u * 0.2).stroke({ width: 1, color: INK.line });
      }
    }
    // The wide button: bid what is picked, or deal the next hand.
    const over = state.phase === "over" && this.shown.phase === "over" && !state.finished;
    const showButton = bidding || over;
    if (this.button) {
      this.button.visible = showButton;
      if (bidding) this.button.text = this.pick === null ? L.pickBid : this.pick === 0 ? L.bidNilButton : L.bidButton(this.pick);
      else if (over) this.button.text = L.deal;
      const enabled = live && (over || this.pick !== null);
      this.button.style.fill = enabled ? INK.cream : INK.dim;
      if (showButton) {
        const r = this.buttonRect();
        g.roundRect(r.x, r.y, r.w, r.h, u * 0.22).fill(enabled ? INK.raised : INK.ground);
        if (enabled) g.roundRect(r.x, r.y, r.w, r.h, u * 0.22).stroke({ width: 1, color: INK.line });
      }
    }
    if (this.status) {
      const s = this.shown;
      const name = (seat: number) => L.seats[seat as 0 | 1 | 2 | 3];
      if (state.finished || s.phase === "over" || s.phase === "bid") this.status.text = "";
      else if (s.phase === "play") this.status.text = s.trick.length === 0 ? L.yourLead : L.yourTurn;
      else if (s.toAct >= 0) this.status.text = s.bids[s.toAct] === null ? L.waitingBid(name(s.toAct)) : L.waiting(name(s.toAct));
      else this.status.text = "";
    }
  }

  private bidRect(bid: number): Hit {
    const L = PACT_LAYOUT;
    const at = pactBidAt(bid);
    const c = this.unit(at.x, at.y);
    return { x: c.x - (L.bidW * this.u) / 2, y: c.y - (L.bidH * this.u) / 2, w: L.bidW * this.u, h: L.bidH * this.u };
  }

  private buttonRect(): Hit {
    const L = PACT_LAYOUT;
    const c = this.unit(L.width / 2, L.buttonY);
    return { x: c.x - (L.buttonW * this.u) / 2, y: c.y - (L.buttonH * this.u) / 2, w: L.buttonW * this.u, h: L.buttonH * this.u };
  }

  protected override onInteractive(): void {
    this.draw();
  }

  protected onState(state: PactState, prev: PactState | null): void {
    this.hint = null;
    this.hintLayer.clear();
    this.idle = 0;
    this.wait = 0;
    if (state.phase !== "bid") this.pick = null;
    if (!prev || this.seats.length !== 4) {
      this.layout(this.app.screen.width, this.app.screen.height);
      return;
    }
    const r = state.lastMove;
    if (!r || prev.logLength + 1 !== state.logLength || !this.shown || r.events.length === 0) {
      this.snap(state);
      return;
    }
    let t = 0;
    for (const e of r.events) {
      this.tweens.after(t, () => this.play(e, state));
      t += e.kind === "deal" ? MOTION.move * 3 : e.kind === "card" ? MOTION.move + 40 : e.kind === "trick" ? TRICK_HOLD + MOTION.clear * 2 : 0;
    }
    // Whatever was played, the table ends as the engine holds it.
    this.tweens.after(t + MOTION.clear, () => this.snap(state));
  }

  /** Show one event on `this.shown` and draw it. */
  private play(e: PactEvent, state: PactState): void {
    const v = this.shown;
    if (!v) return;
    const L = this.opts.labels;
    const u = this.u;
    switch (e.kind) {
      case "deal": {
        v.hand = pactHandOrder(e.cards);
        v.trick = [];
        v.bids = [null, null, null, null];
        v.tricks = [0, 0, 0, 0];
        v.phase = "table";
        v.toAct = -1;
        v.count = null;
        this.cursor = -1;
        this.draw();
        // The cards come in from the middle of the table, one after another.
        const from = this.unit(5, 4.75);
        this.hand.forEach((c, k) => {
          if (!c.box.visible) return;
          const x = c.box.x;
          const y = c.box.y;
          c.box.position.set(from.x, from.y);
          this.tweens.to(c.box, { x, y }, MOTION.move * 2, { delay: k * 18 });
        });
        sfx.swapQuiet();
        break;
      }
      case "bid": {
        v.bids[e.seat] = e.bid;
        v.toAct = -1;
        this.draw();
        const seat = this.seats[e.seat]!;
        this.fx.popup(seat.bid.x, seat.bid.y - u * 0.3, e.bid === 0 ? L.nil : String(e.bid), e.seat === 0 ? INK.amber : INK.cream, Math.max(14, u * 0.42));
        sfx.pop(1);
        break;
      }
      case "card": {
        const seat = this.seats[e.seat]!;
        // The card leaves the hand it was played from: the player's own tile, or the seat's label.
        let from = { x: seat.x, y: seat.y };
        if (e.seat === 0) {
          const k = v.hand.indexOf(e.card);
          const tile = this.hand[k];
          if (tile) from = { x: tile.box.x, y: tile.box.y };
          v.hand = v.hand.filter((c) => c !== e.card);
        }
        v.trick = [...v.trick, { seat: e.seat, card: e.card }];
        v.toAct = -1;
        if (v.phase !== "table") v.phase = "table";
        this.draw();
        const c = this.trick[e.seat]!;
        c.box.position.set(from.x, from.y);
        this.tweens.to(c.box, { x: seat.tx, y: seat.ty }, MOTION.move + 40);
        sfx.swapQuiet();
        if (e.broke) {
          this.fx.popup(seat.tx, seat.ty - u * 1.1, L.broken, INK.cream, Math.max(13, u * 0.34));
          sfx.pop(3);
        }
        break;
      }
      case "trick": {
        // The whole trick stays a moment, the winning card lit, then goes to its taker.
        const winner = e.winner;
        const card = e.cards.find((x) => x.seat === winner)!.card;
        this.trick.forEach((c, seat) => {
          if (seat !== winner) c.box.alpha = 0.55;
        });
        const top = this.trick[winner]!;
        this.fx.ring(top.box.x, top.box.y, winner % 2 === 0 ? INK.amber : INK.cream, u * 0.9, u * 1.2, MOTION.clear * 2);
        void card;
        this.tweens.after(TRICK_HOLD, () => {
          const to = this.seats[winner]!;
          this.trick.forEach((c) => {
            this.tweens.to(c.box, { x: to.x, y: to.y, alpha: 0 }, MOTION.clear * 2);
          });
          v.tricks = [...e.tricks];
          v.trick = [];
          if (winner % 2 === 0) sfx.tick(false);
          else sfx.whoosh();
          const s = this.seats[winner]!;
          s.tricks.text = String(e.tricks[winner]);
          this.fx.popup(s.tx, s.ty, winner === 0 ? L.trickYou : winner === 2 ? L.trickPartner : L.trickThem(L.seats[winner as 1 | 3]), winner % 2 === 0 ? INK.amber : INK.dim, Math.max(13, u * 0.32));
        });
        break;
      }
      case "count": {
        v.count = { us: e.us, them: e.them };
        v.phase = "over";
        v.toAct = -1;
        v.trick = [];
        this.draw();
        const us = e.us;
        const me = this.seats[0]!;
        this.fx.popup(me.tricks.x + 0.9 * u, me.y, L.added(us.added), INK.amber, Math.max(16, u * 0.5));
        const nilMade = us.nils.some((n) => n.seat === 0 && n.made);
        if (nilMade) {
          // The named compound move: the player's nil, made.
          this.fx.say(L.calloutNil);
          this.beat(1);
        } else if (e.them.pact > 0 && e.them.took < e.them.pact) {
          this.fx.say(L.calloutSet);
          sfx.good();
        } else if (us.pact > 0 && us.took >= us.pact) {
          this.fx.say(L.calloutMade);
          sfx.good();
        } else if (us.pact > 0) {
          this.fx.say(L.calloutShort, INK.dim);
          sfx.bad();
        }
        break;
      }
    }
  }

  protected view(): string {
    if (!this.state) return "";
    return pactViewString(this.state);
  }

  protected override update(dt: number): void {
    const state = this.state;
    if (!state) return;
    // Another seat's turn: once the table has settled, give it a breath, then let it act.
    if (this.interactive && state.phase === "table" && !state.finished && !this.busy && this.nextFor !== state) {
      this.wait += dt;
      const bidding = state.seats[state.toAct]?.bid === null;
      if (this.wait >= (bidding ? BID_PACE : TABLE_PACE)) {
        this.nextFor = state;
        this.wait = 0;
        this.cb.onNext();
      }
    }
    // A move worth making pulses after a pause, in rounds that allow hints.
    if (!this.interactive || !this.hints || state.finished || state.phase === "table" || this.busy) {
      this.idle = 0;
      if (this.hint !== null) {
        this.hint = null;
        this.hintLayer.clear();
      }
      return;
    }
    this.idle += dt;
    if (this.idle < HINT_AFTER_MS) return;
    if (this.hintFor !== state) {
      this.hintFor = state;
      this.hint = state.phase === "over" ? { type: "deal" } : pactHint(state);
    }
    this.hintLayer.clear();
    const h = this.hint;
    if (!h) return;
    let r: Hit | null = null;
    if (h.type === "deal") r = this.buttonRect();
    else if (h.type === "bid") r = this.bidRect(h.bid);
    else if (h.type === "play") {
      const k = this.shown?.hand.indexOf(h.card) ?? -1;
      const c = this.hand[k];
      if (c) r = { x: c.box.x - c.w / 2, y: c.box.y - c.h / 2, w: c.w, h: c.h };
    }
    if (!r) return;
    // A hint is cream, never amber: it is the board's advice, not the player's own.
    const pulse = this.reduced ? 0.8 : 0.55 + 0.4 * Math.sin(this.time / 240);
    const pad = this.u * 0.08;
    this.hintLayer.roundRect(r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2, this.u * 0.24).stroke({ width: Math.max(2, this.u * 0.07), color: INK.cream, alpha: pulse });
  }

  // ---- input

  private send(m: PactMove): void {
    const state = this.state;
    if (!state || state.finished || !this.interactive) return;
    if (this.busy) this.tweens.flush();
    this.idle = 0;
    if (pactMoveIllegalReason(state, m) !== null) {
      sfx.bump();
      return;
    }
    this.cb.onMove(m);
  }

  private choose(bid: number): void {
    const state = this.state;
    if (!state || state.phase !== "bid" || bid < pactMinBid(state.config) || bid > 13) return;
    this.pick = bid;
    this.idle = 0;
    sfx.swapQuiet();
    this.draw();
  }

  protected override pointerUp(x: number, y: number): void {
    const state = this.state;
    if (!this.interactive || !state || state.finished) return;
    const inside = (r: Hit) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    if (state.phase === "over") {
      if (inside(this.buttonRect())) this.send({ type: "deal" });
      return;
    }
    if (state.phase === "bid") {
      for (let b = 0; b <= 13; b++) if (inside(this.bidRect(b))) return this.choose(b);
      if (inside(this.buttonRect()) && this.pick !== null) this.send({ type: "bid", bid: this.pick });
      return;
    }
    if (state.phase !== "play" || !this.shown) return;
    // The topmost card under the finger: the hand's tiles do not overlap, so the first that holds the point.
    for (let k = 0; k < this.shown.hand.length; k++) {
      const c = this.hand[k]!;
      if (inside({ x: c.box.x - c.w / 2, y: c.box.y - c.h / 2, w: c.w, h: c.h })) {
        this.cursor = k;
        this.send({ type: "play", card: this.shown.hand[k]! });
        return;
      }
    }
  }

  /**
   * Left and right pick a card or a bid; space or enter plays it, bids it, or deals the next hand.
   * Number keys pick a bid: 0 is nil.
   */
  override keyboard(key: string): boolean {
    const state = this.state;
    if (!this.interactive || !state || state.finished) return false;
    if (state.phase === "over") {
      if (key === " " || key === "Enter") {
        this.send({ type: "deal" });
        return true;
      }
      return false;
    }
    if (state.phase === "bid") {
      const min = pactMinBid(state.config);
      if (/^[0-9]$/.test(key)) {
        this.choose(Number(key));
        return true;
      }
      if (key === "ArrowRight" || key === "ArrowUp") {
        this.choose(this.pick === null ? Math.max(min, 3) : Math.min(13, this.pick + 1));
        return true;
      }
      if (key === "ArrowLeft" || key === "ArrowDown") {
        this.choose(this.pick === null ? Math.max(min, 3) : Math.max(min, this.pick - 1));
        return true;
      }
      if ((key === " " || key === "Enter") && this.pick !== null) {
        this.send({ type: "bid", bid: this.pick });
        return true;
      }
      return false;
    }
    if (state.phase !== "play" || !this.shown) return false;
    const hand = this.shown.hand;
    const ok = new Set(pactPlayable(state));
    const step = (dir: number) => {
      if (this.busy) this.tweens.flush();
      const n = hand.length;
      let k = this.cursor < 0 ? (dir > 0 ? -1 : n) : this.cursor;
      for (let i = 0; i < n; i++) {
        k = (k + dir + n) % n;
        if (ok.has(hand[k]!)) break;
      }
      this.cursor = k;
      this.idle = 0;
      this.draw();
    };
    if (key === "ArrowRight" || key === "ArrowDown") {
      step(1);
      return true;
    }
    if (key === "ArrowLeft" || key === "ArrowUp") {
      step(-1);
      return true;
    }
    if (key === " " || key === "Enter") {
      if (this.cursor < 0 || !ok.has(hand[this.cursor]!)) step(1);
      const card = hand[this.cursor];
      if (card !== undefined) this.send({ type: "play", card });
      return true;
    }
    return false;
  }
}
