import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DEFAULT_POURING_CONFIG,
  InvalidMoveError,
  POURING_DEF,
  createPouringGame,
  hashPouringState,
  pouringFits,
  pouringHint,
  pouringLegalCells,
  pouringLineValue,
  pouringOpenings,
  pouringPlace,
  pouringPourValue,
  pouringSlotValue,
  pouringViewString,
  reducePouring,
  replayPouring,
  summarizePouring,
  type PouringConfig,
  type PouringMove,
  type PouringPiece,
  type PouringState,
} from "../src/index.js";

const cfg = DEFAULT_POURING_CONFIG;

/** A legal move picked from the hand: a pour most of the time, a drink now and then or when nothing fits. */
function randomMove(state: PouringState, pick: number): PouringMove {
  const pours: PouringMove[] = [];
  state.seats[0]!.hand.forEach((_, slot) => {
    for (const cell of pouringLegalCells(state, slot)) pours.push({ type: "pour", slot, cell });
  });
  if (pours.length === 0 || pick % 9 === 0) return { type: "drink", slot: pick % state.config.offer };
  return pours[pick % pours.length]!;
}

function playRandom(seed: string, picks: readonly number[], config: PouringConfig = cfg): { moves: PouringMove[]; state: PouringState } {
  let state = createPouringGame(seed, config);
  const moves: PouringMove[] = [];
  for (const p of picks) {
    if (state.finished) break;
    const m = randomMove(state, p);
    moves.push(m);
    state = reducePouring(state, m);
  }
  return { moves, state };
}

const picksArb = fc.array(fc.nat({ max: 10_000 }), { minLength: 0, maxLength: 24 });

const drink = (id: number, glass: number, brew: number): PouringPiece => ({ id, kind: "drink", glass, brew });

/** A bar from rows of two-character squares: `..` empty, `**` ice, a letter for the glass and a digit for the brew. */
function bar(rows: readonly string[], hand: readonly PouringPiece[], over: Partial<PouringConfig> = {}): PouringState {
  const size = rows.length;
  const config: PouringConfig = { ...cfg, size, rivals: 0, ...over };
  const base = createPouringGame("t", config);
  let id = 1000;
  const cells = rows
    .join("")
    .match(/../g)!
    .map((code): PouringPiece | null => {
      if (code === "..") return null;
      if (code === "**") return { id: id++, kind: "ice", glass: -1, brew: -1 };
      return drink(id++, code.charCodeAt(0) - 97, Number(code[1]));
    });
  const seats = base.seats.map((s, i) => (i === 0 ? { ...s, hand: hand.map((piece) => ({ piece, age: 0 })) } : s));
  return { ...base, cells, rings: cells.map((c) => (c === null ? -1 : 0)), seats, nextId: id };
}

describe("pouring determinism (ADR 0003)", () => {
  it("replaying a move log gives the state play gave", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const { moves, state } = playRandom(seed, picks);
        const replayed = replayPouring(seed, cfg, moves);
        expect(hashPouringState(replayed)).toBe(hashPouringState(state));
        expect(replayed).toEqual(state);
      }),
      { numRuns: 60 },
    );
  });

  it("reduce never mutates the state it is given", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, fc.nat({ max: 10_000 }), (seed, picks, last) => {
        const { state } = playRandom(seed, picks);
        if (state.finished) return;
        const frozen = JSON.stringify(state);
        reducePouring(state, randomMove(state, last));
        expect(JSON.stringify(state)).toBe(frozen);
      }),
      { numRuns: 60 },
    );
  });

  it("different seeds deal different hands", () => {
    const hashes = new Set<string>();
    for (let i = 0; i < 20; i++) hashes.add(hashPouringState(createPouringGame(`seed-${i}`, cfg)));
    expect(hashes.size).toBe(20);
  });

  it("an untouched round ends on its first move with nothing scored", () => {
    const s = reducePouring(createPouringGame("x", cfg), { type: "end" });
    expect(s.finished).toBe(true);
    expect(summarizePouring(s)).toEqual({ score: 0, moves: 0, bestCombo: 0 });
  });

  it("every random round reaches last call within its move bound, the score never below zero", () => {
    fc.assert(
      fc.property(fc.string(), fc.array(fc.nat({ max: 10_000 }), { minLength: 40, maxLength: 40 }), (seed, picks) => {
        const { moves, state } = playRandom(seed, picks);
        expect(state.finished).toBe(true);
        expect(moves.length).toBeLessThanOrEqual(POURING_DEF.maxMoves(cfg) - 1);
        for (const seat of state.seats) {
          expect(seat.turns).toBe(cfg.lastCall);
          expect(seat.score).toBeGreaterThanOrEqual(0);
        }
        expect(state.score).toBe(state.seats[0]!.score);
      }),
      { numRuns: 30 },
    );
  });
});

describe("pouring deal", () => {
  it("deals every pirate a full hand from one bag", () => {
    const s = createPouringGame("deal", cfg);
    expect(s.seats).toHaveLength(cfg.rivals + 1);
    const ids = s.seats.flatMap((seat) => seat.hand.map((h) => h.piece.id)).concat(s.bag.map((p) => p.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(cfg.glasses * cfg.brews + cfg.icePerBag + cfg.ragsPerBag);
    for (const seat of s.seats) expect(seat.hand).toHaveLength(cfg.offer);
  });

  it("a bag holds every glass and brew once, and its ice and rags", () => {
    const s = createPouringGame("bag", cfg);
    const all = [...s.seats.flatMap((seat) => seat.hand.map((h) => h.piece)), ...s.bag];
    const drinks = all.filter((p) => p.kind === "drink").map((p) => `${p.glass}:${p.brew}`);
    expect(new Set(drinks).size).toBe(cfg.glasses * cfg.brews);
    expect(all.filter((p) => p.kind === "ice")).toHaveLength(cfg.icePerBag);
    expect(all.filter((p) => p.kind === "rag")).toHaveLength(cfg.ragsPerBag);
  });

  it("the bar opens empty, every square clean", () => {
    const s = createPouringGame("open", cfg);
    expect(s.cells.every((c) => c === null)).toBe(true);
    expect(s.rings.every((r) => r === -1)).toBe(true);
  });
});

describe("pouring rules", () => {
  const rows5 = (...r: string[]): string[] => r;

  it("a drink suits a neighbour that shares its glass or its brew, and ice suits all", () => {
    const s = bar(rows5("....a0....", "..........", "..........", "..........", ".........."), []);
    expect(pouringFits(s.config, s.cells, drink(1, 0, 3), 1)).toBe(true); // same glass
    expect(pouringFits(s.config, s.cells, drink(1, 2, 0), 1)).toBe(true); // same brew
    expect(pouringFits(s.config, s.cells, drink(1, 2, 3), 1)).toBe(false);
    expect(pouringFits(s.config, s.cells, drink(1, 2, 3), 5)).toBe(true); // not beside it
    expect(pouringFits(s.config, s.cells, { id: 1, kind: "ice", glass: -1, brew: -1 }, 1)).toBe(true);
    expect(pouringFits(s.config, s.cells, drink(1, 0, 0), 2)).toBe(false); // taken
  });

  it("anything stands beside ice", () => {
    const s = bar(rows5("****......", "..........", "..........", "..........", ".........."), []);
    expect(pouringFits(s.config, s.cells, drink(1, 3, 3), 2)).toBe(true);
  });

  it("refuses a drink that does not suit, a slot out of hand and a rag on an empty square", () => {
    const s = bar(rows5("a0........", "..........", "..........", "..........", ".........."), [drink(1, 1, 1), { id: 2, kind: "rag", glass: -1, brew: -1 }]);
    expect(() => reducePouring(s, { type: "pour", slot: 0, cell: 1 })).toThrow(InvalidMoveError);
    expect(() => reducePouring(s, { type: "pour", slot: 2, cell: 7 })).toThrow(InvalidMoveError);
    expect(() => reducePouring(s, { type: "pour", slot: 1, cell: 7 })).toThrow(InvalidMoveError);
  });

  it("a pour scores the drink, a clean square's ring, and serves a full row", () => {
    const s = bar(rows5("a0a0a0a0..", "..........", "..........", "..........", ".........."), [drink(1, 0, 1), drink(2, 3, 3)]);
    const v = pouringPourValue(s, 0, 4);
    expect(v.legal).toBe(true);
    expect(v.clean).toBe(true);
    expect(v.lines).toHaveLength(1);
    const next = reducePouring(s, { type: "pour", slot: 0, cell: 4 });
    const a = next.lastMove!.acts[0]!;
    expect(a.points).toBe(cfg.pourPoints + cfg.ringPoints + Math.floor((pouringLineValue(cfg, 1) * cfg.cleanPercent) / 100));
    expect(next.score).toBe(a.points);
    for (let c = 0; c < 5; c++) expect(next.cells[c]).toBeNull();
    expect(next.rings.slice(0, 5).every((r) => r === 0)).toBe(true);
    expect(next.seats[0]!.lines).toBe(1);
  });

  it("a pour onto a rung square serves a line at its plain value", () => {
    const s0 = bar(rows5("a0a0a0a0..", "..........", "..........", "..........", ".........."), [drink(1, 0, 1)]);
    const s = { ...s0, rings: s0.rings.map(() => 1) };
    const v = pouringPourValue(s, 0, 4);
    expect(v.clean).toBe(false);
    expect(v.points).toBe(cfg.pourPoints + pouringLineValue(cfg, 1));
  });

  it("a row and a column served by one pour count together, k * k", () => {
    const s = bar(
      rows5("a0a0a0a0..", "........a0", "........a0", "........a0", "........a0"),
      [drink(1, 0, 0)],
    );
    const v = pouringPourValue(s, 0, 4);
    expect(v.lines).toHaveLength(2);
    expect(v.linePoints).toBe(Math.floor((cfg.linePoints * 4 * cfg.cleanPercent) / 100));
    const next = reducePouring(s, { type: "pour", slot: 0, cell: 4 });
    expect(next.bestCombo).toBe(2);
    expect(next.cells.every((c) => c === null)).toBe(true);
    expect(next.lastMove!.acts[0]!.taken).toHaveLength(9);
  });

  it("a rag wipes a drink and leaves its ring", () => {
    const s = bar(rows5("a0........", "..........", "..........", "..........", ".........."), [{ id: 1, kind: "rag", glass: -1, brew: -1 }]);
    const next = reducePouring(s, { type: "pour", slot: 0, cell: 0 });
    expect(next.cells[0]).toBeNull();
    expect(next.rings[0]).toBe(0);
    expect(next.lastMove!.acts[0]!.type).toBe("wipe");
    expect(next.score).toBe(0);
  });

  it("a drink downed scores its value; tolerance of them puts the pirate out cold for a turn", () => {
    let s = bar(rows5("..........", "..........", "..........", "..........", ".........."), [drink(1, 0, 0), drink(2, 1, 1)], { tolerance: 2, agePoints: 0 });
    s = reducePouring(s, { type: "drink", slot: 0 });
    expect(s.score).toBe(cfg.pourPoints);
    expect(s.seats[0]!.drunk).toBe(1);
    s = reducePouring(s, { type: "drink", slot: 0 });
    // The second drink put the player out: their next turn passed by itself, and they are awake again.
    const acts = s.lastMove!.acts;
    expect(acts[0]!.passedOut).toBe(true);
    expect(acts[1]!.type).toBe("sleep");
    expect(s.seats[0]!.asleep).toBe(false);
    expect(s.seats[0]!.turns).toBe(3);
    expect(s.seats[0]!.drunk).toBe(1);
  });

  it("pours walk the drink count down", () => {
    let s = bar(rows5("..........", "..........", "..........", "..........", ".........."), [drink(1, 0, 0), drink(2, 0, 0)], { soberAfter: 2, icePerBag: 0, ragsPerBag: 0 });
    s = reducePouring(s, { type: "drink", slot: 0 });
    expect(s.seats[0]!.drunk).toBe(1);
    for (let i = 0; i < 2; i++) {
      const slot = s.seats[0]!.hand.findIndex((_, k) => pouringLegalCells(s, k).length > 0);
      s = reducePouring(s, { type: "pour", slot, cell: pouringLegalCells(s, slot)[0]! });
    }
    expect(s.seats[0]!.drunk).toBe(0);
  });

  it("a drink that waits grows in value, up to ageMax", () => {
    expect(pouringSlotValue(cfg, { piece: drink(1, 0, 0), age: 0 })).toBe(cfg.pourPoints);
    expect(pouringSlotValue(cfg, { piece: drink(1, 0, 0), age: 2 })).toBe(cfg.pourPoints + 2 * cfg.agePoints);
    expect(pouringSlotValue(cfg, { piece: drink(1, 0, 0), age: 99 })).toBe(cfg.pourPoints + cfg.ageMax * cfg.agePoints);
    expect(pouringSlotValue(cfg, { piece: { id: 1, kind: "rag", glass: -1, brew: -1 }, age: 3 })).toBe(0);
  });

  it("the unused drinks in hand age a turn when one is used", () => {
    const s = createPouringGame("age", { ...cfg, rivals: 0 });
    const next = reducePouring(s, { type: "drink", slot: 0 });
    expect(next.seats[0]!.hand[0]!.age).toBe(0);
    expect(next.seats[0]!.hand[1]!.age).toBe(1);
  });

  it("rivals take their turns after the player's, from the round's own stream", () => {
    const s = createPouringGame("rivals", cfg);
    const next = reducePouring(s, randomMove(s, 1));
    const seats = next.lastMove!.acts.map((a) => a.seat);
    expect(seats).toEqual([0, 1, 2]);
    expect(next.seats.every((seat) => seat.turns === 1)).toBe(true);
  });

  it("an opening is a line one drink short", () => {
    const s = bar(rows5("a0a0a0a0..", "..........", "..........", "..........", ".........."), []);
    expect(pouringOpenings(s.config, s.cells)).toEqual([4]);
  });

  it("the hint is a legal pour, and the place counts the rivals ahead", () => {
    const s = createPouringGame("hint", cfg);
    const h = pouringHint(s);
    expect(h).not.toBeNull();
    expect(pouringPourValue(s, h!.slot, h!.cell).legal).toBe(true);
    expect(pouringPlace(s)).toBe(1);
    const ahead = { ...s, seats: s.seats.map((seat, i) => (i === 2 ? { ...seat, score: 50 } : seat)) };
    expect(pouringPlace(ahead)).toBe(2);
  });

  it("the view string is two characters a square", () => {
    const s = bar(rows5("a0**......", "..........", "..........", "..........", ".........."), []);
    expect(pouringViewString(s.cells).slice(0, 6)).toBe("a0**..");
    expect(pouringViewString(s.cells)).toHaveLength(50);
  });
});
