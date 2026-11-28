// Pouring on the new engine, shown as the state the prototype's board draws (ADR 0097, ADR 0099). The round is
// played by `@openseas/puzzle`: the bag, every pour, wipe and drink, rings and lines served, the rivals' turns and
// their picks, turns lost out cold, last call and the points. This file only turns what that round reports into the
// old shape, so the board, its sounds and its page are the prototype's, unchanged.
//
// The prototype names every piece the moment a bag is filled; the new engine names a piece only when it lands on the
// bar. So each piece is named here as it is dealt from a fresh bag, keeps that name in a hand, and the piece it lands
// as on the bar is known by it. What the new engine does not report move by move (which slot a rival used, and what
// each piece of a fresh bag is) is read off the round as the move left it, and every act is then held to it.
import { InvalidMoveError, POURING_DEF, type PouringAct, type PouringConfig, type PouringLine, type PouringMove, type PouringPiece, type PouringSeat, type PouringSlot, type PouringState, type PuzzleDef } from "@openseas/engine";
import { play, read, seedFromString, start, type AnyMove, type Cell, type Event, type Piece as Shown, type Round, type Setting } from "@openseas/puzzle";
import pouring, { type Piece, type Tavern } from "@openseas/puzzle/examples/pouring";
import { held, roundOf } from "./held.js";

/** The prototype's numbers are the new puzzle's, under the same names. */
export const pouringSettings = (c: PouringConfig): Record<string, Setting> => ({ ...c }) as unknown as Record<string, Setting>;

const BREWS_MAX = 6;
/** A piece's look on the new engine's bar, as the prototype's kind, glass and brew. */
const lookOf = (p: Shown): Piece => (p.piece === "ice" ? { kind: "ice", glass: -1, brew: -1 } : { kind: "drink", glass: Math.floor((p.state as number) / BREWS_MAX), brew: (p.state as number) % BREWS_MAX });
const same = (a: Piece, b: Piece): boolean => a.kind === b.kind && a.glass === b.glass && a.brew === b.brew;

/** The names kept beside a shown state: the bag's, in order, the next name free, and the bar's pieces by the new engine's ids. */
interface Names { readonly bag: readonly PouringPiece[]; readonly next: number; readonly bar: ReadonlyMap<number, number> }
const NAMES = new WeakMap<object, Names>();

function shown(round: Round<AnyMove>, config: PouringConfig, names: Names, cells: readonly (PouringPiece | null)[], hands: readonly (readonly PouringSlot[])[], moveCount: number, lastMove: PouringState["lastMove"], ended = false): PouringState {
  const now = read(round);
  const tavern = (now.state as { tavern: Tavern }).tavern;
  const seats: PouringSeat[] = tavern.seats.map((s, i) => ({ hand: hands[i]!, score: s.score, drunk: s.drunk, sober: s.sober, asleep: s.asleep, turns: s.turns, lines: s.lines }));
  // The round as the new engine left it, piece for piece, is what the names were laid on.
  const agrees =
    cells.every((p, i) => { const q = now.board[Math.floor(i / config.size)]![i % config.size] ?? null; return p === null ? q === null : q !== null && same(p, lookOf(q)); }) &&
    hands.every((h, i) => h.every((s, k) => same(s.piece, tavern.seats[i]!.hand[k]!.piece) && s.age === tavern.seats[i]!.hand[k]!.age)) &&
    names.bag.length === tavern.bag.length && names.bag.every((p, k) => tavern.bag[k] !== undefined && same(p, tavern.bag[k]));
  if (!agrees) throw new Error("the names laid on the round no longer fit it");
  const state: PouringState = {
    config,
    cells,
    rings: tavern.rings,
    seats,
    bag: names.bag,
    rng: round.state.streams.bag!,
    nextId: names.next,
    score: now.score,
    moveCount,
    bestCombo: (now.stats as Record<string, number>).bestCombo ?? 0,
    lastMove,
    finished: ended || tavern.seats.every((s) => s.turns >= config.lastCall) || moveCount >= config.maxMoves,
  };
  NAMES.set(state, names);
  return held(state, round);
}

/** A bag the size the settings fill, in a fixed order: what each fresh bag holds before it is shuffled. */
function fullBag(c: PouringConfig): Piece[] {
  const out: Piece[] = [];
  for (let g = 0; g < c.glasses; g++) for (let b = 0; b < c.brews; b++) out.push({ kind: "drink", glass: g, brew: b });
  for (let i = 0; i < c.icePerBag; i++) out.push({ kind: "ice", glass: -1, brew: -1 });
  for (let i = 0; i < c.ragsPerBag; i++) out.push({ kind: "rag", glass: -1, brew: -1 });
  return out;
}

const lineOf = (c: PouringConfig, bar: readonly (PouringPiece | null)[], cell: number): PouringLine[] => {
  const n = c.size;
  const [row, col] = [Math.floor(cell / n), cell % n];
  const rowCells = Array.from({ length: n }, (_, k) => row * n + k);
  const colCells = Array.from({ length: n }, (_, k) => k * n + col);
  return [
    ...(rowCells.every((x) => x === cell || bar[x] !== null) ? [{ axis: "row" as const, index: row, cells: rowCells }] : []),
    ...(colCells.every((x) => x === cell || bar[x] !== null) ? [{ axis: "col" as const, index: col, cells: colCells }] : []),
  ];
};
const slotValue = (c: PouringConfig, s: PouringSlot): number => (s.piece.kind === "rag" ? 0 : c.pourPoints + c.agePoints * Math.min(s.age, c.ageMax));

/** A move's events, an act a group: each pour, wipe, drink, toss or lost turn, with the ring and the serve that follow a pour. */
function actsOf(events: readonly Event[]): Event[][] {
  const out: Event[][] = [];
  for (const e of events) {
    if (["pour", "wipe", "drink", "toss", "sleep"].includes(e.event)) out.push([e]);
    else if ((e.event === "ring" || e.event === "serve") && out.length > 0) out.at(-1)!.push(e);
  }
  return out;
}

function reduceMove(state: PouringState, move: Exclude<PouringMove, { type: "end" }>): PouringState {
  const c = state.config;
  const round = roundOf(state);
  const next = play(round, move.type === "pour" ? { move: "pour", slot: move.slot, at: { x: move.cell % c.size, y: Math.floor(move.cell / c.size) } } : { move: "drink", slot: move.slot });
  if (next.last.refused) throw new InvalidMoveError(next.last.refused, move);
  const after = (read(next).state as { tavern: Tavern }).tavern;
  const groups = actsOf(next.last.events);
  const names = NAMES.get(state)!;

  // Which slot each act used. The player's is the move's. A rival's is read off its hand as the move left it: the
  // slot it used last holds a drink dealt this move and never aged; one it used before that has aged once since.
  const slots: number[] = [];
  const bySeat = new Map<number, number[]>();
  groups.forEach((g, i) => g[0]!.event !== "sleep" && bySeat.set(g[0]!.fields.seat as number, [...(bySeat.get(g[0]!.fields.seat as number) ?? []), i]));
  for (const [seat, acts] of bySeat) {
    const ages = after.seats[seat]!.hand.map((s) => s.age);
    if (acts.length > 2) throw new Error("a pirate took more than two turns in one move");
    const last = ages.indexOf(0);
    slots[acts.at(-1)!] = seat === 0 ? move.slot : last;
    if (acts.length === 2) slots[acts[0]!] = ages.includes(1) ? ages.indexOf(1) : last;
  }

  // Every act played over the bar, the rings, the hands and the bag, each piece by its name.
  const cells = state.cells.slice();
  const rings = state.rings.slice();
  const hands = state.seats.map((s) => s.hand.slice());
  let bag = names.bag.slice();
  let nextName = names.next;
  const bar = new Map(names.bar);
  // Pieces from a bag filled this move: what each is, as far as the move shows it.
  const fresh: { piece: { -readonly [K in keyof PouringPiece]: PouringPiece[K] }; known: Piece | null; batch: number }[] = [];
  let batch = -1;
  const deal = (): PouringPiece => {
    if (bag.length === 0) {
      batch++;
      bag = fullBag(c).map(() => {
        const piece = { id: nextName++, kind: "drink" as PouringPiece["kind"], glass: -1, brew: -1 };
        fresh.push({ piece, known: null, batch });
        return piece;
      });
    }
    return bag.shift()!;
  };
  const learn = (p: PouringPiece, what: Piece): void => {
    const f = fresh.find((x) => x.piece === p);
    if (f) f.known = what;
  };
  const acts: PouringAct[] = groups.map((g, i): PouringAct => {
    const [head] = g;
    const seat = head!.fields.seat as number;
    if (head!.event === "sleep") {
      return { seat, type: "sleep", slot: -1, piece: null, cell: -1, wiped: null, clean: false, lines: [], taken: [], drinkPoints: 0, ringPoints: 0, linePoints: 0, points: 0, passedOut: false, hand: hands[seat]!.slice(), cells: cells.slice(), rings: rings.slice() };
    }
    const slot = slots[i]!;
    const used = hands[seat]![slot]!;
    const at = head!.fields.at as Cell | undefined;
    const cell = at ? at.y * c.size + at.x : -1;
    let [wiped, clean, lines, drinkPoints, ringPoints, linePoints] = [null as PouringPiece | null, false, [] as PouringLine[], 0, 0, 0];
    const taken: { cell: number; id: number }[] = [];
    if (head!.event === "wipe" || head!.event === "toss") learn(used.piece, { kind: "rag", glass: -1, brew: -1 });
    if (head!.event === "wipe") (wiped = cells[cell]!), (cells[cell] = null);
    if (head!.event === "drink") drinkPoints = slotValue(c, used);
    if (head!.event === "pour") {
      const arrived = head!.changes.find((ch) => ch.change === "arrive");
      if (arrived?.change === "arrive") (bar.set(arrived.piece.id, used.piece.id), learn(used.piece, lookOf(arrived.piece)));
      clean = g.some((e) => e.event === "ring");
      lines = lineOf(c, cells, cell);
      cells[cell] = used.piece;
      if (clean) (rings[cell] = seat), (ringPoints = c.ringPoints);
      drinkPoints = slotValue(c, used);
      const base = c.linePoints * lines.length * lines.length;
      linePoints = clean ? Math.floor((base * c.cleanPercent) / 100) : base;
      for (const x of new Set(lines.flatMap((l) => l.cells))) taken.push({ cell: x, id: cells[x]!.id });
      for (const t of taken) cells[t.cell] = null;
    }
    hands[seat] = hands[seat]!.map((s, k) => (k === slot ? { piece: deal(), age: 0 } : { piece: s.piece, age: s.age + 1 }));
    const passedOut = head!.event === "drink" && head!.fields.out === true;
    return { seat, type: head!.event as PouringAct["type"], slot, piece: used.piece, cell, wiped, clean, lines, taken, drinkPoints, ringPoints, linePoints, points: drinkPoints + ringPoints + linePoints, passedOut, hand: hands[seat]!.slice(), cells: cells.slice(), rings: rings.slice() };
  });

  // What each piece of a fresh bag is: the ones still in a hand or the bag say so, as do the ones poured or thrown;
  // a drink downed the moment it was dealt is the one piece of its bag left over.
  hands.forEach((h, seat) => h.forEach((s, k) => learn(s.piece, after.seats[seat]!.hand[k]!.piece)));
  bag.forEach((p, k) => learn(p, after.bag[k]!));
  for (let b = 0; b <= batch; b++) {
    const mine = fresh.filter((f) => f.batch === b);
    const left = fullBag(c);
    for (const f of mine) if (f.known) left.splice(left.findIndex((p) => same(p, f.known!)), 1);
    const unknown = mine.filter((f) => !f.known);
    if (unknown.length > 0 && !left.every((p) => same(p, left[0]!))) throw new Error("a fresh bag's pieces cannot all be told");
    unknown.forEach((f) => (f.known = left[0]!));
    for (const f of mine) Object.assign(f.piece, f.known);
  }
  // A piece that has left the bar is never named again.
  const standing = new Set(read(next).board.flatMap((row) => row.flatMap((p) => (p ? [p.id] : []))));
  for (const id of bar.keys()) if (!standing.has(id)) bar.delete(id);
  return shown(next, c, { bag, next: nextName, bar }, cells, hands, state.moveCount + 1, { move, acts });
}

export const POURING_MIRROR: PuzzleDef<PouringState, PouringMove, PouringConfig> = {
  ...POURING_DEF,
  create: (seed, config) => {
    POURING_DEF.validateConfig(config);
    const round = start(pouring, { seed, settings: pouringSettings(config), streams: { bag: seedFromString(seed) } }) as unknown as Round<AnyMove>;
    const tavern = (read(round).state as { tavern: Tavern }).tavern;
    // The opening hands and what is left of the first bag, named in the order they were dealt from it.
    let next = 1;
    const hands = tavern.seats.map((s) => s.hand.map((slot) => ({ piece: { id: next++, ...slot.piece }, age: slot.age })));
    const bag = tavern.bag.map((p) => ({ id: next++, ...p }));
    return shown(round, config, { bag, next, bar: new Map() }, new Array(config.size * config.size).fill(null), hands, 0, null);
  },
  reduce: (state, move) => {
    if (state.finished) throw new InvalidMoveError("the round is over", move);
    // Ending early is the host's.
    if (move.type === "end") return shown(roundOf(state), state.config, NAMES.get(state)!, state.cells, state.seats.map((s) => s.hand), state.moveCount, { move, acts: [] }, true);
    return reduceMove(state, move);
  },
};
