import { Container, Graphics, Sprite, Text } from "pixi.js";
import {
  showdownBetSize,
  showdownBoardShowing,
  showdownCanRaise,
  showdownHint,
  showdownMoveIllegalReason,
  showdownOwed,
  showdownPot,
  showdownRankOf,
  showdownSuitOf,
  showdownViewString,
  type ShowdownAction,
  type ShowdownEvent,
  type ShowdownHandName,
  type ShowdownMove,
  type ShowdownState,
  type ShowdownStyle,
} from "@openseas/engine";
import { sfx } from "../audio.js";
import { FONT, FONT_MONO, INK } from "../kit/art.js";
import { KitBoard } from "../kit/board.js";
import { MOTION } from "../look/tokens.js";
import { SHOWDOWN_BACK, SHOWDOWN_BUTTON, SHOWDOWN_CHIP, SHOWDOWN_EMBLEMS, SHOWDOWN_SUITS } from "./pieces.js";

export interface ShowdownCallbacks {
  /** The player folded, called or raised, or dealt the next hand. */
  onMove(move: ShowdownMove): void;
  /** A rival is to act and the board has shown everything before it: let it act. */
  onNext(): void;
  /** First settled frame after a new state. */
  onFrame(): void;
}

export interface ShowdownLabels {
  fold: string;
  check: string;
  call(amount: number): string;
  bet(amount: number): string;
  raise(amount: number): string;
  capped: string;
  deal: string;
  you: string;
  style(style: ShowdownStyle): string;
  waiting(name: string): string;
  act(action: ShowdownAction, amount: number): string;
  blind(amount: number): string;
  pot(amount: number): string;
  hand(name: ShowdownHandName): string;
  youWin(amount: number): string;
  theyWin(name: string, amount: number): string;
  split: string;
  trap: string;
}

export interface ShowdownRendererOptions {
  /** Frame a move worth making after a pause. Off for recorded rounds. */
  hints: boolean;
  labels: ShowdownLabels;
}

/** What the table shows at one moment of playing a move out: built from a state, stepped by its events. */
interface Shown {
  button: number;
  board: number[];
  pot: number;
  toAct: number;
  phase: ShowdownState["phase"];
  seats: Array<{ style: ShowdownStyle | null; cards: number[]; folded: boolean; street: number; net: number; shown: boolean; said: string }>;
  /** Cards to lift, the ones that made the winning hand. */
  best: number[];
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
  cards: [CardView, CardView];
  emblem: Sprite;
  name: Text;
  net: Text;
  said: Text;
  chip: Sprite;
  bet: Text;
  /** Where the seat sits, where its bets lie and where its button goes. */
  x: number;
  y: number;
  bx: number;
  by: number;
  dx: number;
  dy: number;
}

interface ButtonView {
  move: "fold" | "call" | "raise" | "deal";
  x: number;
  y: number;
  w: number;
  h: number;
  label: Text;
  enabled: boolean;
}

const RANKS = "23456789TJQKA";
/** The board's own pace for a rival's turn: long enough to read what the last seat did. */
const TABLE_PACE = 750;
const HINT_AFTER_MS = 6000;
/** One step of a move played out: a seat acting, cards turning. */
const STEP = 220;

/** Draws the table and turns a tap or a key into a fold, a call, a raise or a deal. Scores nothing: every number it shows is the engine's. */
export class ShowdownRenderer extends KitBoard<ShowdownState> {
  private readonly bg = new Graphics();
  private readonly marks = new Graphics();
  private readonly table = new Container();
  private readonly buttonsLayer = new Graphics();
  private readonly hintLayer = new Graphics();
  private readonly fxLayer = new Container();
  private seats: SeatView[] = [];
  private board: CardView[] = [];
  private buttons: ButtonView[] = [];
  private pot: Text | null = null;
  private potChip: Sprite | null = null;
  private status: Text | null = null;
  private dealer: Sprite | null = null;
  private u = 10;
  private shown: Shown | null = null;
  private nextFor: ShowdownState | null = null;
  private wait = 0;
  private idle = 0;
  private hint: string | null = null;
  private hintFor: ShowdownState | null = null;
  private hints: boolean;

  constructor(
    host: HTMLElement,
    private readonly cb: ShowdownCallbacks,
    private readonly opts: ShowdownRendererOptions,
  ) {
    super(host, "showdown", cb.onFrame);
    this.hints = opts.hints;
  }

  setHints(on: boolean): void {
    this.hints = on;
  }

  protected build(): void {
    this.world.addChild(this.bg, this.marks, this.buttonsLayer, this.table, this.hintLayer, this.fxLayer);
  }

  private text(size: number, color: number, mono = false): Text {
    const t = new Text({ text: "", style: { fontFamily: mono ? FONT_MONO : FONT, fontSize: Math.max(10, Math.round(size)), fontWeight: "700", fill: color }, resolution: 2 });
    t.anchor.set(0.5);
    return t;
  }

  private card(w: number, h: number): CardView {
    const box = new Container();
    const face = new Sprite();
    face.anchor.set(0.5);
    const rank = this.text(h * 0.34, INK.cream, true);
    rank.position.set(0, -h * 0.2);
    const suit = new Sprite();
    suit.anchor.set(0.5);
    suit.position.set(0, h * 0.2);
    box.addChild(face, rank, suit);
    this.table.addChild(box);
    return { box, face, rank, suit, w, h };
  }

  /** A card tile: raised, with a hairline, so it sits on the ground without a frame of its own. */
  private tile(w: number, h: number): ReturnType<KitBoard<ShowdownState>["piece"]> {
    return this.bake(`showdown:tile:${Math.round(w)}x${Math.round(h)}`, Math.ceil(Math.max(w, h)) + 2, (g) => {
      g.roundRect(-w / 2, -h / 2, w, h, Math.max(3, w * 0.12))
        .fill(INK.raised)
        .stroke({ width: 1, color: INK.line });
    });
  }

  /** Show a card face up, face down (null), or not at all (undefined). */
  private setCard(v: CardView, card: number | null | undefined, lifted = false): void {
    v.box.visible = card !== undefined;
    if (card === undefined) return;
    v.face.texture = this.tile(v.w, v.h);
    if (card === null) {
      v.rank.visible = false;
      v.suit.texture = this.piece(SHOWDOWN_BACK.id, v.w * 0.8, SHOWDOWN_BACK.color, SHOWDOWN_BACK.paint);
      v.suit.position.set(0, 0);
      v.box.alpha = 1;
      return;
    }
    const suit = SHOWDOWN_SUITS[showdownSuitOf(card)]!;
    v.rank.visible = true;
    v.rank.text = RANKS[showdownRankOf(card)]!;
    v.suit.texture = this.piece(suit.id, v.w * 0.62, suit.color, suit.paint);
    v.suit.position.set(0, v.h * 0.2);
    v.box.alpha = lifted ? 1 : v.box.alpha;
  }

  protected layout(width: number, height: number): void {
    const u = Math.max(8, Math.min(width / 10, height / 14.5));
    this.u = u;
    const ox = (width - 10 * u) / 2;
    const oy = (height - 14.5 * u) / 2;
    this.bg.clear();
    this.paintGround(this.bg, ox, oy, 10 * u, 14.5 * u, false);
    this.table.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.fxLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.seats = [];
    this.board = [];
    this.buttons = [];
    const cx = ox + 5 * u;
    const tcy = oy + 4.5 * u;
    const n = this.state ? this.state.seats.length : 4;
    // The one hairline: under the table, over the player's own seat.
    this.bg
      .moveTo(ox + u * 0.5, oy + 7.55 * u)
      .lineTo(ox + 9.5 * u, oy + 7.55 * u)
      .stroke({ width: 1, color: INK.line });

    for (let i = 0; i < n; i++) {
      if (i === 0) {
        // The player's own seat: bigger cards at the foot of the table.
        const w = 1.45 * u;
        const h = 2 * u;
        const a = this.card(w, h);
        const b = this.card(w, h);
        a.box.position.set(cx - 0.8 * u, oy + 9.55 * u);
        b.box.position.set(cx + 0.8 * u, oy + 9.55 * u);
        const emblem = new Sprite();
        emblem.visible = false;
        const name = this.text(u * 0.34, INK.amber);
        name.position.set(cx - 2.9 * u, oy + 9.25 * u);
        const net = this.text(u * 0.4, INK.cream, true);
        net.position.set(cx - 2.9 * u, oy + 9.8 * u);
        const said = this.text(u * 0.32, INK.dim);
        said.position.set(cx + 2.95 * u, oy + 9.55 * u);
        const chip = new Sprite();
        chip.anchor.set(0.5);
        const bet = this.text(u * 0.36, INK.cream, true);
        const bx = cx;
        const by = oy + 8.05 * u;
        chip.position.set(bx - 0.45 * u, by);
        bet.position.set(bx + 0.2 * u, by);
        this.table.addChild(emblem, name, net, said, chip, bet);
        this.seats.push({ cards: [a, b], emblem, name, net, said, chip, bet, x: cx, y: oy + 9.55 * u, bx, by, dx: cx + 1.1 * u, dy: by });
        continue;
      }
      const theta = ((270 - (360 * i) / n) * Math.PI) / 180;
      const x = cx + 3.75 * u * Math.cos(theta);
      const y = tcy - 3.05 * u * Math.sin(theta) - 0.3 * u;
      const w = 0.72 * u;
      const h = 1 * u;
      const a = this.card(w, h);
      const b = this.card(w, h);
      a.box.position.set(x - 0.39 * u, y - 0.35 * u);
      b.box.position.set(x + 0.39 * u, y - 0.35 * u);
      const emblem = new Sprite();
      emblem.anchor.set(0.5);
      emblem.position.set(x - 0.62 * u, y + 0.5 * u);
      const name = this.text(u * 0.3, INK.cream);
      name.anchor.set(0, 0.5);
      name.position.set(x - 0.3 * u, y + 0.5 * u);
      const net = this.text(u * 0.32, INK.dim, true);
      net.position.set(x, y + 0.92 * u);
      const said = this.text(u * 0.28, INK.dim);
      said.position.set(x, y + 1.3 * u);
      // Bets lie between the seat and a point over the middle cards, never on them.
      const k = 0.45;
      const bx = x + (cx - x) * k;
      const by = Math.min(tcy - 0.4 * u, Math.max(y + 1.8 * u, y + (tcy - 0.6 * u - y) * k + 0.2 * u));
      const chip = new Sprite();
      chip.anchor.set(0.5);
      chip.position.set(bx - 0.32 * u, by);
      const bet = this.text(u * 0.32, INK.cream, true);
      bet.position.set(bx + 0.18 * u, by);
      this.table.addChild(emblem, name, net, said, chip, bet);
      // The button lies beside the seat's cards, never over them.
      this.seats.push({ cards: [a, b], emblem, name, net, said, chip, bet, x, y, bx, by, dx: x + 1.05 * u, dy: y - 0.35 * u });
    }
    // The middle: five cards, and the pot under them.
    for (let k = 0; k < 5; k++) {
      const c = this.card(0.9 * u, 1.3 * u);
      c.box.position.set(cx + (k - 2) * 1.0 * u, tcy + 0.9 * u);
      this.board.push(c);
    }
    this.potChip = new Sprite();
    this.potChip.anchor.set(0.5);
    this.potChip.position.set(cx - 0.75 * u, tcy + 2.05 * u);
    this.potChip.texture = this.piece(SHOWDOWN_CHIP.id, u * 0.42, SHOWDOWN_CHIP.color, SHOWDOWN_CHIP.paint);
    this.pot = this.text(u * 0.36, INK.cream, true);
    this.pot.anchor.set(0, 0.5);
    this.pot.position.set(cx - 0.45 * u, tcy + 2.05 * u);
    this.dealer = new Sprite(this.piece(SHOWDOWN_BUTTON.id, u * 0.42, SHOWDOWN_BUTTON.color, SHOWDOWN_BUTTON.paint));
    this.dealer.anchor.set(0.5);
    this.status = this.text(u * 0.32, INK.dim);
    this.status.position.set(cx, oy + 11.3 * u);
    this.table.addChild(this.potChip, this.pot, this.dealer, this.status);
    // The player's buttons, three across, or one to deal.
    const bw = 2.95 * u;
    const bh = 1.15 * u;
    const by = oy + 12.75 * u;
    const pitch = 3.15 * u;
    (["fold", "call", "raise"] as const).forEach((move, k) => {
      const label = this.text(u * 0.38, INK.cream);
      label.position.set(cx + (k - 1) * pitch, by);
      this.table.addChild(label);
      this.buttons.push({ move, x: cx + (k - 1) * pitch - bw / 2, y: by - bh / 2, w: bw, h: bh, label, enabled: false });
    });
    const deal = this.text(u * 0.38, INK.cream);
    deal.position.set(cx, by);
    this.table.addChild(deal);
    this.buttons.push({ move: "deal", x: cx - pitch - bw / 2, y: by - bh / 2, w: pitch * 2 + bw, h: bh, label: deal, enabled: false });
    // The smoke test reads the buttons' row: the first's left edge, the row's top, and the pitch.
    this.publishGeom(cx - pitch - pitch / 2, by - pitch / 2, pitch);
    if (this.state) this.snap(this.state);
  }

  private fromState(state: ShowdownState): Shown {
    const best: number[] = [];
    const win = state.phase === "over" ? state.lastMove?.events.find((e) => e.kind === "win") : undefined;
    if (win && win.kind === "win") for (const s of win.shown) if (win.winners.includes(s.seat)) best.push(...s.best);
    const said = (seat: number): string => {
      const x = win && win.kind === "win" ? win.shown.find((s) => s.seat === seat) : undefined;
      return x ? this.opts.labels.hand(x.hand) : "";
    };
    return {
      button: state.button,
      board: showdownBoardShowing(state),
      pot: showdownPot(state),
      toAct: state.toAct,
      phase: state.phase,
      seats: state.seats.map((s, i) => ({
        style: s.style,
        cards: i === 0 || s.shown ? [...s.cards] : [],
        folded: s.folded,
        street: s.street,
        net: s.net,
        shown: s.shown,
        said: said(i),
      })),
      best,
    };
  }

  /** Put exactly the engine's table on the board, with nothing in motion. */
  private snap(state: ShowdownState): void {
    const keep = this.shown?.seats.map((s) => s.said) ?? [];
    const shown = this.fromState(state);
    // What each seat last did stays under it until the street moves on.
    if (this.shown && this.shown.board.length === shown.board.length && state.phase !== "over") shown.seats.forEach((s, i) => (s.said = keep[i] ?? ""));
    this.shown = shown;
    this.draw();
    this.touchView();
  }

  /** Draw `this.shown`. */
  private draw(): void {
    const v = this.shown;
    const state = this.state;
    if (!v || !state || this.seats.length !== v.seats.length) return;
    const u = this.u;
    const L = this.opts.labels;
    this.marks.clear();
    v.seats.forEach((s, i) => {
      const view = this.seats[i]!;
      const out = s.folded;
      view.cards.forEach((c, k) => {
        const card = s.cards[k];
        // A rival's cards show face down until it shows them; a folded seat has thrown them away.
        if (out && i !== 0) this.setCard(c, undefined);
        else this.setCard(c, card ?? (i === 0 && s.cards.length === 0 ? undefined : null));
        c.box.alpha = out ? 0.35 : v.best.length > 0 && card !== undefined && !v.best.includes(card) ? 0.45 : 1;
      });
      if (i === 0) {
        view.name.text = L.you;
        view.net.text = signed(s.net);
      } else {
        const style = s.style!;
        const em = SHOWDOWN_EMBLEMS[style];
        view.emblem.texture = this.piece(em.id, u * 0.5, em.color, em.paint);
        view.emblem.alpha = out ? 0.4 : 1;
        view.name.text = L.style(style);
        view.name.style.fill = out ? INK.dim : INK.cream;
        view.net.text = signed(s.net);
      }
      view.said.text = s.said;
      view.chip.visible = s.street > 0;
      view.chip.texture = this.piece(SHOWDOWN_CHIP.id, u * 0.36, SHOWDOWN_CHIP.color, SHOWDOWN_CHIP.paint);
      view.bet.visible = s.street > 0;
      view.bet.text = String(s.street);
      // The seat to act: an amber ring round it. Amber is the active thing.
      if (v.toAct === i && v.phase !== "over") {
        if (i === 0) this.marks.roundRect(view.x - 1.75 * u, view.y - 1.15 * u, 3.5 * u, 2.3 * u, 0.25 * u).stroke({ width: Math.max(2, u * 0.07), color: INK.amber });
        else this.marks.roundRect(view.x - 1.05 * u, view.y - 0.95 * u, 2.1 * u, 1.75 * u, 0.22 * u).stroke({ width: Math.max(2, u * 0.07), color: INK.amber });
      }
    });
    this.board.forEach((c, k) => {
      const card = v.board[k];
      this.setCard(c, card);
      c.box.alpha = card !== undefined && v.best.length > 0 && !v.best.includes(card) ? 0.45 : 1;
    });
    if (this.pot) this.pot.text = L.pot(v.pot);
    if (this.dealer) {
      const d = this.seats[v.button];
      if (d) this.dealer.position.set(d.dx, d.dy);
    }
    this.drawButtons();
  }

  private drawButtons(): void {
    const state = this.state;
    const g = this.buttonsLayer;
    g.clear();
    if (!state || !this.shown) return;
    // Whose turn it is, for the smoke test: act, table or over.
    this.app.canvas.setAttribute("data-phase", state.finished ? "finished" : state.phase);
    const L = this.opts.labels;
    const live = this.shown.phase === state.phase && !state.finished && this.interactive;
    const over = state.phase === "over";
    const due = showdownOwed(state);
    const raise = showdownCanRaise(state);
    const size = showdownBetSize(state);
    for (const b of this.buttons) {
      const shownHere = over ? b.move === "deal" : b.move !== "deal";
      b.label.visible = shownHere && !state.finished;
      if (!b.label.visible) {
        b.enabled = false;
        continue;
      }
      if (b.move === "deal") {
        b.label.text = L.deal;
        b.enabled = live;
      } else if (b.move === "fold") {
        b.label.text = L.fold;
        b.enabled = live && state.phase === "act" && due > 0;
      } else if (b.move === "call") {
        b.label.text = due > 0 ? L.call(due) : L.check;
        b.enabled = live && state.phase === "act";
      } else {
        b.label.text = !raise ? L.capped : state.bets === 0 ? L.bet(size) : L.raise(due + size);
        b.enabled = live && state.phase === "act" && raise;
      }
      b.label.style.fill = b.enabled ? INK.cream : INK.dim;
      g.roundRect(b.x, b.y, b.w, b.h, this.u * 0.22).fill(b.enabled ? INK.raised : INK.ground);
      if (b.enabled) g.roundRect(b.x, b.y, b.w, b.h, this.u * 0.22).stroke({ width: 1, color: INK.line });
    }
    if (this.status) {
      if (state.phase === "table" && !state.seats[0]!.folded) {
        const style = state.seats[state.toAct]?.style;
        this.status.text = style ? L.waiting(L.style(style)) : "";
      } else this.status.text = "";
    }
  }

  protected override onInteractive(): void {
    this.drawButtons();
  }

  protected onState(state: ShowdownState, prev: ShowdownState | null): void {
    this.hint = null;
    this.hintLayer.clear();
    this.idle = 0;
    this.wait = 0;
    if (!prev || this.seats.length !== state.seats.length) {
      this.layout(this.app.screen.width, this.app.screen.height);
      return;
    }
    const r = state.lastMove;
    if (!r || prev.logLength + 1 !== state.logLength || !this.shown || r.events.length === 0) {
      this.snap(state);
      return;
    }
    // The rest of a hand the player has folded out of plays quicker: it is only to be seen.
    const quick = prev.seats[0]!.folded;
    const step = quick ? STEP / 2 : STEP;
    let t = 0;
    for (const e of r.events) {
      this.tweens.after(t, () => this.play(e, state));
      t += e.kind === "deal" ? STEP * 2 : e.kind === "win" ? 0 : step;
    }
    // Whatever was played, the table ends as the engine holds it.
    this.tweens.after(t + MOTION.clear, () => this.snap(state));
  }

  /** Show one event on `this.shown` and draw it. */
  private play(e: ShowdownEvent, state: ShowdownState): void {
    const v = this.shown;
    if (!v) return;
    const L = this.opts.labels;
    const u = this.u;
    switch (e.kind) {
      case "deal": {
        v.button = e.button;
        v.board = [];
        v.best = [];
        v.phase = "table";
        v.toAct = -1;
        v.seats.forEach((s, i) => {
          s.folded = false;
          s.shown = false;
          s.cards = i === 0 ? [...e.cards] : [];
          s.street = i === e.small ? state.config.smallBlind : i === e.big ? state.config.bigBlind : 0;
          s.said = i === e.small ? L.blind(state.config.smallBlind) : i === e.big ? L.blind(state.config.bigBlind) : "";
        });
        v.pot = state.config.smallBlind + state.config.bigBlind;
        this.draw();
        // The cards go out from the middle, one seat at a time.
        this.seats.forEach((seat, i) => {
          seat.cards.forEach((c, k) => {
            const x = c.box.x;
            const y = c.box.y;
            c.box.position.set(this.board[2]!.box.x, this.board[2]!.box.y);
            this.tweens.to(c.box, { x, y }, MOTION.move * 2, { delay: (i * 2 + k) * 30 });
          });
        });
        sfx.swapQuiet();
        break;
      }
      case "act": {
        const s = v.seats[e.seat]!;
        s.street += e.paid;
        s.folded = e.action === "fold";
        s.said = L.act(e.action, e.paid);
        v.pot = e.pot;
        v.toAct = -1;
        this.draw();
        const seat = this.seats[e.seat]!;
        if (e.paid > 0) {
          // The chips go in from the seat.
          const chip = new Sprite(this.piece(SHOWDOWN_CHIP.id, u * 0.36, SHOWDOWN_CHIP.color, SHOWDOWN_CHIP.paint));
          chip.anchor.set(0.5);
          chip.position.set(seat.x, seat.y);
          this.fxLayer.addChild(chip);
          this.tweens.to(chip, { x: seat.chip.x, y: seat.chip.y }, MOTION.move, { done: () => chip.destroy() });
        }
        if (e.action === "fold") sfx.whoosh();
        else if (e.action === "check") sfx.bump();
        else if (e.action === "call") sfx.tick(false);
        else sfx.pop(Math.min(8, state.config.raiseCap));
        break;
      }
      case "street": {
        v.board = [...v.board, ...e.cards];
        v.seats.forEach((s) => {
          s.street = 0;
          s.said = s.folded ? s.said : "";
        });
        this.draw();
        e.cards.forEach((card, k) => {
          const c = this.board[v.board.length - e.cards.length + k];
          if (!c) return;
          c.box.alpha = 0;
          this.tweens.to(c.box, { alpha: 1 }, MOTION.move, { delay: k * 60 });
        });
        sfx.swapQuiet();
        break;
      }
      case "win": {
        for (const x of e.shown) {
          const s = v.seats[x.seat]!;
          s.cards = [...x.cards];
          s.shown = true;
          s.said = L.hand(x.hand);
        }
        v.best = [];
        for (const x of e.shown) if (e.winners.includes(x.seat)) v.best.push(...x.best);
        if (e.shown.length > 0) v.board = state.board.slice(0, 5);
        v.phase = "over";
        v.toAct = -1;
        this.draw();
        e.winners.forEach((w, k) => {
          const seat = this.seats[w]!;
          this.fx.popup(seat.x, seat.y - u * 0.9, `+${e.amounts[k]}`, w === 0 ? INK.amber : INK.cream, Math.max(14, u * 0.45));
        });
        const mine = e.winners.includes(0);
        const name = (seat: number): string => {
          const style = v.seats[seat]?.style;
          return style ? L.style(style) : L.you;
        };
        if (e.trap) {
          // The named compound move: a check-raise that took the pot.
          this.fx.say(L.trap);
          this.beat(Math.min(1, 0.35 + e.pot / 120));
        } else if (e.winners.length > 1) this.fx.say(L.split, INK.dim);
        else if (mine) this.fx.say(L.youWin(e.pot));
        else this.fx.say(L.theyWin(name(e.winners[0]!), e.pot), INK.dim);
        if (!e.trap) {
          if (mine) sfx.good();
          else if (!state.seats[0]!.folded && e.shown.length > 0) sfx.bad();
        }
        break;
      }
    }
  }

  protected view(): string {
    if (!this.state) return "";
    return showdownViewString(this.state);
  }

  protected override update(dt: number): void {
    const state = this.state;
    if (!state) return;
    // A rival's turn: once the table has settled, give it a breath, then let it act.
    if (this.interactive && state.phase === "table" && !state.finished && !this.busy && this.nextFor !== state) {
      this.wait += dt;
      if (this.wait >= (state.seats[0]!.folded ? TABLE_PACE / 3 : TABLE_PACE)) {
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
      this.hint = state.phase === "over" ? "deal" : showdownHint(state);
    }
    this.hintLayer.clear();
    const b = this.buttons.find((x) => x.move === this.hint && x.enabled);
    if (!b) return;
    // A hint is cream, never amber: it is the board's advice, not the player's own.
    const pulse = this.reduced ? 0.8 : 0.55 + 0.4 * Math.sin(this.time / 240);
    const pad = this.u * 0.08;
    this.hintLayer.roundRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2, this.u * 0.28).stroke({ width: Math.max(2, this.u * 0.07), color: INK.cream, alpha: pulse });
  }

  // ---- input

  private press(move: ShowdownButtonMove): void {
    const state = this.state;
    if (!state || state.finished || !this.interactive) return;
    if (this.busy) this.tweens.flush();
    this.idle = 0;
    const m: ShowdownMove = { type: move };
    if (showdownMoveIllegalReason(state, m) !== null) {
      sfx.bump();
      return;
    }
    this.cb.onMove(m);
  }

  protected override pointerUp(x: number, y: number): void {
    if (!this.interactive || !this.state) return;
    const b = this.buttons.find((k) => k.label.visible && x >= k.x && x <= k.x + k.w && y >= k.y && y <= k.y + k.h);
    if (b) this.press(b.move);
  }

  /** F folds, C calls or checks, R raises or bets; 1, 2 and 3 press the buttons left to right; space or enter deals. */
  override keyboard(key: string): boolean {
    if (!this.interactive || !this.state) return false;
    const k = key.length === 1 ? key.toLowerCase() : key;
    const map: Record<string, ShowdownButtonMove> = { f: "fold", c: "call", r: "raise", "1": "fold", "2": "call", "3": "raise", " ": "deal", Enter: "deal" };
    const move = map[k];
    if (!move) return false;
    this.press(move);
    return true;
  }
}

type ShowdownButtonMove = "fold" | "call" | "raise" | "deal";

/** A net with its sign, in mono: +12, -4, 0. */
function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}
