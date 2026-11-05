import { describe, expect, it } from "vitest";
import {
  DEFAULT_BATTLE_CONFIG,
  DEFAULT_BILGING_CONFIG,
  DEFAULT_CARPENTRY_CONFIG,
  DEFAULT_GUNNERY_CONFIG,
  DEFAULT_NAVIGATION_CONFIG,
  DEFAULT_SAILING_CONFIG,
  DEFAULT_SWORDFIGHT_CONFIG,
  PUZZLE_IDS,
  PUZZLES,
  createBilgingGame,
  hashBilgingState,
  reduceBilging,
  swapIllegalReason,
  type BilgingConfig,
  type BilgingMove,
  type BilgingState,
} from "@openseas/engine";
import { PuzzleSessionManager, type SessionManagerOptions } from "../src/puzzles/sessions.js";

function manager(now: { t: number }, overrides: Partial<SessionManagerOptions> & { bilging?: Partial<BilgingConfig> } = {}) {
  let n = 0;
  const { bilging, ...rest } = overrides;
  return new PuzzleSessionManager({
    graceMs: 1000,
    puzzles: {
      bilging: { roundMs: 60_000, config: { ...DEFAULT_BILGING_CONFIG, ...bilging } },
      sailing: { roundMs: 60_000, config: DEFAULT_SAILING_CONFIG },
      carpentry: { roundMs: 60_000, config: DEFAULT_CARPENTRY_CONFIG },
      gunnery: { roundMs: 60_000, config: DEFAULT_GUNNERY_CONFIG },
      navigation: { roundMs: 60_000, config: DEFAULT_NAVIGATION_CONFIG },
      battle: { roundMs: 60_000, config: DEFAULT_BATTLE_CONFIG },
      swordfight: { roundMs: 60_000, config: DEFAULT_SWORDFIGHT_CONFIG },
    },
    now: () => now.t,
    randomSeed: () => `seed-${n++}`,
    randomId: () => `session-${n++}`,
    ...rest,
  });
}

function firstLegal(state: BilgingState): BilgingMove {
  for (let r = 0; r < state.config.height; r++) {
    for (let c = 0; c < state.config.width - 1; c++) {
      if (swapIllegalReason(state, c, r) === null) return { type: "swap", col: c, row: r };
    }
  }
  throw new Error("no legal move");
}

describe("PuzzleSessionManager", () => {
  it("accepts an honest client's moves and scores the round", () => {
    const now = { t: 1000 };
    const m = manager(now);
    const s = m.start("p1", "bilging");
    // The client mirrors the engine from the seed the server issued.
    let client = createBilgingGame(s.seed, s.config as BilgingConfig);
    for (let i = 0; i < 10; i++) {
      const move = firstLegal(client);
      client = reduceBilging(client, move);
      expect(m.move(s, i, move, hashBilgingState(client))).toEqual({ ok: true, seq: i });
    }
    const r = m.finish(s, hashBilgingState(client));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.summary.moves).toBe(10);
      expect(r.summary.score).toBe(client.score);
      expect(r.moves.length).toBe(10);
    }
    expect(m.size).toBe(0);
  });

  it("rejects a divergent hash on the move it happens", () => {
    const now = { t: 0 };
    const m = manager(now);
    const s = m.start("p1", "bilging");
    const client = createBilgingGame(s.seed, s.config as BilgingConfig);
    const move = firstLegal(client);
    const r = m.move(s, 0, move, "00000000");
    expect(r).toEqual({ ok: false, reason: "divergence", atSeq: 0 });
    expect(m.get(s.id)).toBeUndefined();
  });

  it("rejects a client that claims a different final state", () => {
    const now = { t: 0 };
    const m = manager(now);
    const s = m.start("p1", "bilging");
    const r = m.finish(s, "ffffffff");
    expect(r).toEqual({ ok: false, reason: "divergence" });
  });

  it("rejects out-of-order sequence numbers", () => {
    const now = { t: 0 };
    const m = manager(now);
    const s = m.start("p1", "bilging");
    const client = createBilgingGame(s.seed, s.config as BilgingConfig);
    const move = firstLegal(client);
    expect(m.move(s, 1, move, hashBilgingState(reduceBilging(client, move)))).toMatchObject({ ok: false, reason: "bad_sequence" });
  });

  it("rejects illegal moves", () => {
    const now = { t: 0 };
    const m = manager(now);
    const s = m.start("p1", "bilging");
    expect(m.move(s, 0, { type: "swap", col: 5, row: 0 }, "00000000")).toMatchObject({ ok: false, reason: "illegal_move" });
  });

  it("rejects moves after the deadline plus grace, and lists the session as expired", () => {
    const now = { t: 0 };
    const m = manager(now);
    const s = m.start("p1", "bilging");
    const client = createBilgingGame(s.seed, s.config as BilgingConfig);
    const move = firstLegal(client);
    now.t = 60_000 + 500; // inside grace
    expect(m.move(s, 0, move, hashBilgingState(reduceBilging(client, move)))).toEqual({ ok: true, seq: 0 });
    now.t = 60_000 + 1001;
    expect(m.expired().map((x) => x.id)).toEqual([s.id]);
    const next = firstLegal(reduceBilging(client, move));
    expect(m.move(s, 1, next, "00000000")).toMatchObject({ ok: false, reason: "deadline" });
  });

  it("drives every registered engine through an honest round", () => {
    for (const id of PUZZLE_IDS) {
      const now = { t: 0 };
      const m = manager(now);
      const s = m.start("p1", id);
      const def = PUZZLES[id];
      // A client that only ever sends "end" is honest, if dull: every engine accepts it.
      const client = def.reduce(def.create(s.seed, s.config), { type: "end", tick: 0 });
      expect(m.move(s, 0, { type: "end", tick: 0 }, def.hash(client))).toEqual({ ok: true, seq: 0 });
      const r = m.finish(s, def.hash(client));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.summary).toEqual({ score: 0, moves: 0, bestCombo: 0 });
    }
  });

  it("rejects a timed move that claims a tick ahead of the wall clock", () => {
    const now = { t: 0 };
    const m = manager(now);
    const s = m.start("p1", "gunnery");
    const def = PUZZLES.gunnery;
    // 10 ticks of 220ms claimed 1s in: fine. 100 ticks (22s) claimed 1s in: a lie.
    now.t = 1000;
    const okMove = { type: "wait", tick: 4 };
    expect(m.move(s, 0, okMove, def.hash(def.reduce(s.state, okMove)))).toEqual({ ok: true, seq: 0 });
    const lie = { type: "wait", tick: 100 };
    expect(m.move(s, 1, lie, def.hash(def.reduce(s.state, lie)))).toMatchObject({ ok: false, reason: "illegal_move" });
  });

  it("a melee board logs only the wrack the server announced, in order, and never its own win", () => {
    const now = { t: 0 };
    const m = manager(now);
    const def = PUZZLES.swordfight;
    const config = { ...DEFAULT_SWORDFIGHT_CONFIG, foes: [] };
    const s = m.start("p1", "swordfight", null, null, { config, roundMs: 60_000 }, { shipId: "ship-1", voyageId: "v-1", tierId: "cutpurse" });
    let client = def.create(s.seed, config);
    const log = (seq: number, move: unknown) => {
      const next = def.reduce(client, move);
      const r = m.move(s, seq, move, def.hash(next));
      if (r.ok) client = next;
      return r;
    };
    now.t = 1000;
    // Nothing announced: incoming is refused and the round is closed.
    expect(log(0, { type: "incoming", board: 0, wrack: 3, blade: 0, tick: 2 })).toMatchObject({ ok: false, reason: "illegal_move" });
    const s2 = m.start("p1", "swordfight", null, null, { config, roundMs: 60_000 }, { shipId: "ship-1", voyageId: "v-1", tierId: "cutpurse" });
    client = def.create(s2.seed, config);
    s2.meleeIncoming.push({ wrack: 3, blade: 1 }, { wrack: 5, blade: 0 });
    const log2 = (seq: number, move: unknown) => {
      const next = def.reduce(client, move);
      const r = m.move(s2, seq, move, def.hash(next));
      if (r.ok) client = next;
      return r;
    };
    // The announced wrack, in order; a different amount, blade or board is a lie.
    expect(log2(0, { type: "wait", tick: 1 })).toEqual({ ok: true, seq: 0 });
    expect(log2(1, { type: "incoming", board: 0, wrack: 3, blade: 1, tick: 2 })).toEqual({ ok: true, seq: 1 });
    expect(s2.meleeIncoming).toEqual([{ wrack: 5, blade: 0 }]);
    expect(log2(2, { type: "incoming", board: 0, wrack: 5, blade: 0, tick: 3 })).toEqual({ ok: true, seq: 2 });
    expect(s2.meleeIncoming).toEqual([]);
    // A win over foes outside the board is the server's word, never the client's.
    expect(log2(3, { type: "end", won: true, tick: 4 })).toMatchObject({ ok: false, reason: "illegal_move" });
    // The server writes that end itself and the log still replays.
    const s3 = m.start("p1", "swordfight", null, null, { config, roundMs: 60_000 }, { shipId: "ship-1", voyageId: "v-1", tierId: "cutpurse" });
    expect(m.inject(s3, { type: "end", won: true, tick: 2 })).toBe(true);
    expect(s3.moves).toEqual([{ type: "end", won: true, tick: 2 }]);
    const r = m.finish(s3, null);
    expect(r.ok && r.summary.score).toBe(config.winPoints);
  });

  it("caps the move count at the configured maximum", () => {
    const now = { t: 0 };
    const m = manager(now, { bilging: { maxMoves: 2 } });
    const s = m.start("p1", "bilging");
    let client = createBilgingGame(s.seed, s.config as BilgingConfig);
    for (let i = 0; i < 2; i++) {
      const move = firstLegal(client);
      client = reduceBilging(client, move);
      expect(m.move(s, i, move, hashBilgingState(client))).toEqual({ ok: true, seq: i });
    }
    // The engine itself marks the game finished, so a third move is illegal; either way it is rejected.
    const r = m.move(s, 2, { type: "end" }, "00000000");
    expect(r.ok).toBe(false);
  });
});
