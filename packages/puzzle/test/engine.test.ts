import { describe, expect, test } from "vitest";
import { applyChanges, checkPuzzle, engine, judge, Refused, replay, type Board, type Entry, type PuzzleDoc, type Rules } from "../src/index.js";
import { SCALE } from "./helpers.js";

/**
 * A small puzzle of the engine's own, to run the parts of the guide Swap does not use: a ticking
 * tempo, a move budget, a stock, a fail, a bag, a pick, a zone, a flat payout, a capped payout
 * and a multiplier sized by a percent. It is no game: each move takes the piece in a tray and sets
 * it on a cell, and the tray is dealt again from a bag.
 */
const DOC: PuzzleDoc = {
  id: "tally",
  version: "0.1",
  history: [{ version: "0.1", line: "First version" }],
  mechanic: "Set the piece in the tray on a cell",
  verb: "set",
  round: { tempo: { kind: "ticking", tickMs: 100 }, ends: [{ by: "budget", setting: "sets" }, { by: "stock", setting: "stock" }, { by: "fail", event: "crash" }], logLimit: 50 },
  board: { shape: "grid", width: 3, height: "height", touch: 4, rim: false },
  terrain: [],
  zones: [{ id: "tray", holds: 1, player: "takes" }],
  settings: [
    { id: "height", type: "whole", default: 2, min: 1, max: 4, line: "rows on the board", group: "board", unit: "cells" },
    { id: "sets", type: "whole", default: 4, min: 1, max: 20, line: "pieces a round sets", group: "tempo", unit: "moves" },
    { id: "stock", type: "whole", default: 3, min: 1, max: 20, line: "bags a round works through", group: "deal" },
    { id: "kinds", type: "whole", default: 3, min: 2, max: 8, line: "kinds in a bag", group: "deal" },
    { id: "setPoints", type: "whole", default: 10, min: 0, max: 100, line: "points for a piece, times its kind", group: "scoring", unit: "points" },
    { id: "setCap", type: "whole", default: 2, min: 1, max: 8, line: "the kind past which a piece pays no more", group: "scoring" },
    { id: "tickPoints", type: "whole", default: 1, min: 0, max: 100, line: "points for each tick a piece waits", group: "scoring", unit: "points" },
    { id: "cornerPercent", type: "percent", default: 150, min: 100, max: 500, line: "what a corner multiplies a piece by", group: "scoring" },
    { id: "bonus", type: "list", default: [5, 7], min: 0, max: 100, line: "a bonus picked for the round", group: "scoring", entries: { count: 2 } },
  ],
  relations: [{ is: "at-most", a: "setCap", b: "kinds" }, { is: "fits", a: "sets", b: "board" }],
  deal: {
    draws: [
      { id: "tray", line: "the kind of the next piece", gives: "kind", by: "bag", when: "refill", reads: ["kinds"] },
      { id: "bonus", line: "which bonus the round pays", gives: "number", by: "pick", when: "start", reads: ["bonus"] },
    ],
    checks: [],
    bounds: [],
    secrets: [],
  },
  layers: [
    { id: "base", rule: "a piece pays by its kind", brings: {} },
    { id: "waiting", rule: "a piece pays for each tick it waits", brings: { events: ["waited"], settings: ["tickPoints"], payouts: ["wait"] } },
  ],
  ladder: [{ stage: "base", adds: ["base"], advance: { measure: "rounds-played", threshold: 2 } }, { stage: "full", adds: ["waiting"] }],
  evaluation: { tierStarts: { steady: 10, sharp: 20, masterful: 40, legendary: 80 }, paceWindowSeconds: 1 },
  signals: { in: [{ id: "crash", type: "flag", when: "on-change" }], out: [] },
  pieces: [{ id: "kind", family: "kinds" }],
  moves: [{ id: "set", line: "set the tray's piece on a cell", gesture: "drag", fields: { at: "place" } }],
  controls: [],
  events: [
    { id: "set", line: "a piece was set", fields: { at: "place", kind: "number", points: "points" }, changes: ["leave", "arrive"] },
    { id: "dealt", line: "the tray was dealt again", fields: {}, changes: ["arrive"] },
    { id: "waited", line: "the tray's piece waited a tick", fields: { points: "points" } },
    { id: "crash", line: "the round cannot go on", fields: {} },
  ],
  moment: { event: "set", when: "kind >= 3", size: "kind", most: "kinds" },
  payouts: [
    { id: "set", line: "a piece pays by its kind", on: ["set"], counts: "kind", growth: "linear", cap: "setCap", reads: ["setPoints"] },
    { id: "wait", line: "a waiting piece pays each tick", on: ["waited"], growth: "flat", reads: ["tickPoints"] },
  ],
  multipliers: [{ id: "corner", line: "a corner multiplies", scales: ["set"], on: "a piece set on a corner", by: { percent: "cornerPercent" } }],
  tasks: [],
  gauges: [{ id: "left", line: "pieces left to set", most: "sets" }],
  stats: [{ id: "bags", line: "bags worked through" }],
  texts: [{ key: "name" }, { key: "how_to" }, { key: "stage.base" }, { key: "stage.base_intro" }, { key: "stage.full" }, { key: "stage.full_intro" }, ...Array.from({ length: 8 }, (_, i) => ({ key: `piece.kind_${i + 1}` })), { key: "stat.bags" }, { key: "gauge.left" }],
  teaching: { preview: false, hint: false },
};

interface Tally {
  readonly dealt: number;
  readonly bonus: number;
}

const RULES: Rules<Tally> = {
  id: "tally",
  version: "0.1",
  knows: {
    layers: ["base", "waiting"],
    settings: ["height", "sets", "stock", "kinds", "setPoints", "setCap", "tickPoints", "cornerPercent", "bonus"],
    terrain: [],
    zones: ["tray"],
    pieces: ["kind"],
    moves: ["set"],
    controls: [],
    events: ["set", "dealt", "waited", "crash"],
    gauges: ["left"],
    payouts: ["set", "wait"],
    multipliers: ["corner"],
    tasks: [],
    draws: ["tray", "bonus"],
    checks: [],
    secrets: [],
    signals: ["crash"],
    stats: ["bags"],
  },
  start(ctx) {
    ctx.place({ piece: "kind", kind: ctx.draw.bag("tray", ctx.settings.number("kinds")) + 1 }, { zone: "tray", spot: 0 });
    return { dealt: 1, bonus: ctx.settings.list("bonus")[ctx.draw.pick("bonus", 2)]! };
  },
  allows(view, move) {
    return typeof move.at === "number" && view.board.cells[move.at] === null ? null : "that cell is taken";
  },
  play(ctx, move) {
    const tray = ctx.board.zones["tray"]![0]!;
    const at = move.at as number;
    const { width, height } = ctx.board;
    const corner = (at % width === 0 || at % width === width - 1) && (at < width || at >= width * (height - 1));
    ctx.emit("set", { at, kind: tray.kind! }, (e) => {
      e.leave(tray.id, { zone: "tray", spot: 0 });
      e.arrive({ piece: "kind", kind: tray.kind! }, at, { zone: "tray", spot: 0 });
      e.pay("set");
      if (corner) e.scale("corner");
    });
    const kinds = ctx.settings.number("kinds");
    const dealt = ctx.state.dealt + 1;
    if (Math.floor(ctx.state.dealt / kinds) >= ctx.settings.number("stock")) ctx.spent();
    else ctx.emit("dealt", {}, (e) => void e.arrive({ piece: "kind", kind: ctx.draw.bag("tray", kinds) + 1 }, { zone: "tray", spot: 0 }, "in-place"));
    return { ...ctx.state, dealt };
  },
  signal(ctx) {
    ctx.emit("crash", {});
    return ctx.state;
  },
  tick(ctx) {
    if (ctx.settings.has("waiting")) ctx.emit("waited", {}, (e) => e.pay("wait"));
    return ctx.state;
  },
  gauges: (view) => ({ left: view.settings.number("sets") - view.moves }),
  stats: (view) => ({ bags: Math.floor(view.state.dealt / view.settings.number("kinds")) }),
};

const tally = engine(DOC, RULES, { scale: SCALE });
const set = (at: number, time: number): Entry => ({ at: time, move: { id: "set", at } });

describe("the engine, on a puzzle of its own", () => {
  test("the puzzle is ready", () => {
    expect(checkPuzzle(DOC)).toEqual([]);
  });

  test("a bag deals every kind once before any again, whatever the seed", () => {
    for (const seed of ["a", "b", "c", "d"]) {
      let round = tally.start(seed, tally.settings({ stage: "base", values: { height: 4, sets: 12, stock: 9 } }));
      const kinds: number[] = [];
      for (let i = 0; i < 9; i++) {
        kinds.push(round.board.zones["tray"]![0]!.kind!);
        round = tally.play(round, set(i, i)).round;
      }
      for (let b = 0; b < 3; b++) expect(kinds.slice(b * 3, b * 3 + 3).sort()).toEqual([1, 2, 3]);
    }
  });

  test("a linear payout stops growing at its cap, and a percent multiplies the payouts it scales", () => {
    const round = tally.start("cap", tally.settings({ stage: "base" }));
    const kind = round.board.zones["tray"]![0]!.kind!;
    const middle = tally.play(round, set(1, 0)).events[0]!;
    expect(middle.points).toBe(10 * Math.min(kind, 2));
    const corner = tally.play(round, set(0, 0)).events[0]!;
    expect(corner.points).toBe(Math.floor((10 * Math.min(kind, 2) * 150) / 100));
  });

  test("a piece set from the tray leaves its spot and arrives on its cell, and the events alone redraw the board", () => {
    let round = tally.start("zones", tally.settings({ stage: "base" }));
    let drawn: Board = round.board;
    for (let i = 0; i < 3; i++) {
      const played = tally.play(round, set(i, i));
      for (const e of played.events) drawn = applyChanges(drawn, e.changes);
      round = played.round;
      expect(drawn).toEqual(round.board);
    }
    expect(round.board.cells.slice(0, 3).every((p) => p !== null)).toBe(true);
    expect(() => tally.play(round, set(0, 9))).toThrow(Refused);
  });

  test("ticks fall due as time passes, between entries and at the final time mark", () => {
    const round = tally.start("ticks", tally.settings());
    const waited = tally.mark(round, 350);
    expect(waited.events.map((e) => [e.id, e.step, e.points])).toEqual([["waited", 0, 1], ["waited", 0, 1], ["waited", 0, 1]]);
    expect(waited.round).toMatchObject({ at: 350, ticks: 3, score: 3 });
    // The ticks that fell due before an entry are played before it, and reported with it.
    const played = tally.play(round, set(1, 250));
    expect(played.events.map((e) => e.id)).toEqual(["waited", "waited", "set", "dealt"]);
    expect(played.round.ticks).toBe(2);
    // A stage without the layer ticks and pays nothing.
    expect(tally.mark(tally.start("ticks", tally.settings({ stage: "base" })), 350).round).toMatchObject({ ticks: 3, score: 0 });
  });

  test("the move budget ends the round on its last move", () => {
    let round = tally.start("budget", tally.settings({ stage: "base" }));
    for (let i = 0; i < 4; i++) round = tally.play(round, set(i, i)).round;
    expect(round.ended).toEqual({ by: "budget", at: 3 });
    expect(tally.read(round).gauges["left"]).toEqual({ value: 0, most: 4 });
    expect(() => tally.play(round, set(4, 5))).toThrow(Refused);
  });

  test("the stock ends the round once it is worked through", () => {
    let round = tally.start("stock", tally.settings({ stage: "base", values: { stock: 1, sets: 6 } }));
    for (let i = 0; i < 3; i++) round = tally.play(round, set(i, i)).round;
    expect(round.ended).toEqual({ by: "stock", at: 2 });
    expect(tally.read(round).stats).toEqual({ bags: 1 });
  });

  test("a fail ends the round on the event that names it, and the first ending met is the one that ends it", () => {
    const round = tally.start("fail", tally.settings({ stage: "base" }));
    const crashed = tally.play(round, { at: 5, signal: { id: "crash", value: true } });
    expect(crashed.round.ended).toEqual({ by: "fail", at: 5 });
    expect(tally.mark(crashed.round, 99).round.at).toBe(5);
  });

  test("a round is judged only once it has ended, from a replay of its log", () => {
    const settings = tally.settings({ stage: "base" });
    const from = { seed: "judge", layers: settings.layers, settings: settings.values };
    const entries = [0, 1, 2, 3].map((i) => set(i, i * 10));
    expect(() => judge(tally, { ...from, log: { entries: entries.slice(0, 2), end: 500 } })).toThrow(/has not ended/);
    const stored = judge(tally, { ...from, log: { entries, end: 30 } });
    expect(stored).toMatchObject({ puzzle: "tally", version: "0.1", seed: "judge", layers: ["base"] });
    // Every setting the round has is kept, and none it does not: the layer that is off brings none.
    expect(Object.keys(stored.settings).sort()).toEqual(["bonus", "cornerPercent", "height", "kinds", "setCap", "setPoints", "sets", "stock"]);
    expect(stored.score).toBe(replay(tally, { ...from, log: { entries, end: 30 } }).round.score);
    expect(stored.tier).not.toBeNull();
  });

  test("the rules cannot pay, report, draw or deal what the puzzle does not declare", () => {
    const broken = (over: Partial<Rules<Tally>>): (() => unknown) => {
      const e = engine(DOC, { ...RULES, ...over }, { scale: SCALE });
      return () => e.play(e.start("x", e.settings()), set(1, 0));
    };
    expect(broken({ play: (ctx) => (ctx.emit("boom", {}), ctx.state) })).toThrow(/not a declared event/);
    expect(broken({ play: (ctx) => (ctx.emit("set", { at: 1, kind: 1 }, (e) => e.pay("wait")), ctx.state) })).toThrow(/not declared to pay on set/);
    expect(broken({ play: (ctx) => (ctx.emit("set", { at: 1 }), ctx.state) })).toThrow(/set.kind must be a number/);
    expect(broken({ play: (ctx) => (ctx.emit("set", { at: 1, kind: 1, points: 99 }), ctx.state) })).toThrow(/not a field the rules may set/);
    expect(broken({ play: (ctx) => (ctx.emit("waited", {}, (e) => e.travel(1, 0, 1)), ctx.state) })).toThrow(/not declared to carry travel/);
    expect(broken({ play: (ctx) => (ctx.draw.even("tray", 3), ctx.state) })).toThrow(/declared bag/);
    expect(broken({ play: (ctx) => (ctx.draw.even("luck", 3), ctx.state) })).toThrow(/not a declared draw/);
    expect(broken({ play: (ctx) => (ctx.settings.number("speed"), ctx.state) })).toThrow(/does not have/);
    expect(broken({ play: (ctx) => (ctx.emit("dealt", {}, (e) => void e.arrive({ piece: "kind", kind: 9 }, 1, "in-place")), ctx.state) })).toThrow(/needs a kind/);
    expect(broken({ play: (ctx) => (ctx.emit("dealt", {}, (e) => void e.arrive({ piece: "kind", kind: 1 }, { zone: "tray", spot: 0 }, "in-place")), ctx.state) })).toThrow(/taken twice/);
    // A layer that is off brings nothing: its event cannot be reported and its setting cannot be read.
    const base = engine(DOC, { ...RULES, tick: (ctx) => (ctx.emit("waited", {}), ctx.state) }, { scale: SCALE });
    expect(() => base.mark(base.start("x", base.settings({ stage: "base" })), 100)).toThrow(/whose layer is off/);
  });

  test("an engine is not made from rules that know more or less than the puzzle declares, or for another major", () => {
    expect(() => engine(DOC, { ...RULES, knows: { ...RULES.knows, events: ["set", "dealt", "waited"] } }, { scale: SCALE })).toThrow(/do not know the events entry crash/);
    expect(() => engine(DOC, { ...RULES, knows: { ...RULES.knows, draws: ["tray", "bonus", "luck"] } }, { scale: SCALE })).toThrow(/which the puzzle does not declare/);
    expect(() => engine(DOC, { ...RULES, version: "1.0" }, { scale: SCALE })).toThrow(/written for version 1.0/);
    expect(() => engine({ ...DOC, version: "0.7" }, RULES, { scale: SCALE })).toThrow(/history has no line/);
    expect(() => engine({ ...DOC, opponents: { sides: 2 } }, RULES, { scale: SCALE })).toThrow(/between sides/);
  });
});
