import { describe, expect, it } from "vitest";
import { PUZZLES } from "@openseas/engine";
import { VouchedMoves } from "../src/puzzles/vouched.js";

const heat = (row: number) => ({ type: "heat", row });
const supply = (left: number, hull = 0) => ({ type: "supply", left, forward: 2, right: 1, turrets: 3, hull });
const incoming = (scrap: number, blade = 0, tick = 0, board = 0) => ({ type: "incoming", board, scrap, blade, tick });

describe("VouchedMoves", () => {
  it("the ship's heat stands: the latest depth wins, and the board may log it again until the next", () => {
    const v = new VouchedMoves(PUZZLES.cooling);
    // Nothing said yet: no depth is the ship's word.
    expect(v.admits(heat(3))).toBe(false);
    expect(v.vouch(heat(3))).toBe(true);
    expect(v.admits(heat(3))).toBe(true);
    expect(v.admits(heat(4))).toBe(false);
    v.logged(heat(3));
    expect(v.admits(heat(3))).toBe(true);
    // The same depth again is no news to the board.
    expect(v.vouch(heat(3))).toBe(false);
    expect(v.vouch(heat(5))).toBe(true);
    expect(v.admits(heat(3))).toBe(false);
    expect(v.admits(heat(5))).toBe(true);
    expect(v.pending()).toEqual([heat(5)]);
    // The pirate's own moves are theirs.
    expect(v.admits({ type: "swap", col: 0, row: 0 })).toBe(true);
  });

  it("the battle's supply: the latest deal wins, and it is logged once", () => {
    const v = new VouchedMoves(PUZZLES.battle);
    expect(v.admits(supply(1))).toBe(false);
    expect(v.vouch(supply(1))).toBe(true);
    // A new turn's deal replaces one the board has not logged, even an equal one, and is news each time.
    expect(v.vouch(supply(2))).toBe(true);
    expect(v.admits(supply(1))).toBe(false);
    expect(v.admits(supply(2, 1))).toBe(false);
    expect(v.admits(supply(2))).toBe(true);
    expect(v.pending()).toEqual([supply(2)]);
    v.logged(supply(2));
    expect(v.admits(supply(2))).toBe(false);
    expect(v.pending()).toEqual([]);
    expect(v.vouch(supply(2))).toBe(true);
    expect(v.admits(supply(2))).toBe(true);
    expect(v.admits({ type: "commit", segments: [], grapple: false })).toBe(true);
  });

  it("a melee's incoming scrap: first in, first out, each logged once, at the board's own tick", () => {
    const v = new VouchedMoves(PUZZLES.swordfight);
    expect(v.admits(incoming(3))).toBe(false);
    expect(v.vouch(incoming(3, 1, 10))).toBe(true);
    expect(v.vouch(incoming(5, 0, 12))).toBe(true);
    expect(v.vouch(incoming(5, 0, 12))).toBe(true);
    expect(v.pending()).toEqual([incoming(3, 1, 10), incoming(5, 0, 12), incoming(5, 0, 12)]);
    // Only the oldest, as said: a later one, another amount, blade or board is a lie. The tick is the board's.
    expect(v.admits(incoming(5, 0))).toBe(false);
    expect(v.admits(incoming(4, 1))).toBe(false);
    expect(v.admits(incoming(3, 0))).toBe(false);
    expect(v.admits(incoming(3, 1, 10, 1))).toBe(false);
    expect(v.admits(incoming(3, 1, 99))).toBe(true);
    v.logged(incoming(3, 1, 99));
    expect(v.admits(incoming(3, 1))).toBe(false);
    expect(v.admits(incoming(5, 0))).toBe(true);
    v.logged(incoming(5, 0));
    v.logged(incoming(5, 0));
    expect(v.pending()).toEqual([]);
    expect(v.admits(incoming(5, 0))).toBe(false);
    expect(v.admits({ type: "wait", tick: 4 })).toBe(true);
  });

  it("a win over foes outside the board is the server's own move: never vouched for, never admitted", () => {
    const v = new VouchedMoves(PUZZLES.swordfight);
    expect(v.admits({ type: "end", won: true, tick: 4 })).toBe(false);
    expect(() => v.vouch({ type: "end", won: true, tick: 4 })).toThrow();
    // Yielding is the pirate's own.
    expect(v.admits({ type: "end", tick: 4 })).toBe(true);
    expect(v.admits({ type: "end", won: false, tick: 4 })).toBe(true);
  });

  it("refuses to vouch for a pirate's own move, or on a puzzle with no vouched moves", () => {
    expect(() => new VouchedMoves(PUZZLES.cooling).vouch({ type: "swap", col: 0, row: 0 })).toThrow();
    const engines = new VouchedMoves(PUZZLES.engines);
    expect(() => engines.vouch(heat(3))).toThrow();
    expect(engines.admits({ type: "end" })).toBe(true);
  });
});
