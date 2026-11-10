import { describe, expect, it } from "vitest";
import {
  DEFAULT_BATTLE_CONFIG,
  DEFAULT_COOLING_CONFIG,
  DEFAULT_PLATING_CONFIG,
  DEFAULT_GUNNERY_CONFIG,
  DEFAULT_NAVIGATION_CONFIG,
  DEFAULT_ENGINES_CONFIG,
  DEFAULT_SHIP_RULES,
  DEFAULT_SWORDFIGHT_CONFIG,
  PROTOTYPE_PUZZLE_IDS,
  PUZZLE_IDS,
  PUZZLES,
  createCoolingGame,
  hashCoolingState,
  reduceCooling,
  swapIllegalReason,
  type CoolingConfig,
  type CoolingMove,
  type CoolingState,
} from "@openseas/engine";
import { PRACTICE } from "../src/puzzles/binding.js";
import { MAX_RESYNCS, PuzzleSessionManager, type SessionManagerOptions } from "../src/puzzles/sessions.js";

function manager(now: { t: number }, overrides: Partial<SessionManagerOptions> & { cooling?: Partial<CoolingConfig> } = {}) {
  let n = 0;
  const { cooling, ...rest } = overrides;
  return new PuzzleSessionManager({
    graceMs: 1000,
    puzzles: {
      cooling: { roundMs: 60_000, config: { ...DEFAULT_COOLING_CONFIG, ...cooling } },
      engines: { roundMs: 60_000, config: DEFAULT_ENGINES_CONFIG },
      plating: { roundMs: 60_000, config: DEFAULT_PLATING_CONFIG },
      gunnery: { roundMs: 60_000, config: DEFAULT_GUNNERY_CONFIG },
      navigation: { roundMs: 60_000, config: DEFAULT_NAVIGATION_CONFIG },
      battle: { roundMs: 60_000, config: DEFAULT_BATTLE_CONFIG },
      swordfight: { roundMs: 60_000, config: DEFAULT_SWORDFIGHT_CONFIG },
      // Prototype puzzles (ADR 0036) play on their engines' own defaults.
      ...(Object.fromEntries(PROTOTYPE_PUZZLE_IDS.map((id) => [id, { roundMs: 60_000, config: PUZZLES[id].defaultConfig }])) as Record<(typeof PROTOTYPE_PUZZLE_IDS)[number], { roundMs: number; config: unknown }>),
    },
    now: () => now.t,
    randomSeed: () => `seed-${n++}`,
    randomId: () => `session-${n++}`,
    ...rest,
  });
}

function firstLegal(state: CoolingState): CoolingMove {
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
    const s = m.start("p1", "cooling");
    // The client mirrors the engine from the seed the server issued.
    let client = createCoolingGame(s.seed, s.config as CoolingConfig);
    for (let i = 0; i < 10; i++) {
      const move = firstLegal(client);
      client = reduceCooling(client, move);
      expect(m.move(s, i, move, hashCoolingState(client))).toEqual({ ok: true, seq: i });
    }
    const r = m.finish(s, hashCoolingState(client));
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
    const s = m.start("p1", "cooling");
    const client = createCoolingGame(s.seed, s.config as CoolingConfig);
    const move = firstLegal(client);
    const r = m.move(s, 0, move, "00000000");
    expect(r).toEqual({ ok: false, reason: "divergence", atSeq: 0 });
    expect(m.get(s.id)).toBeUndefined();
  });

  it("rejects a client that claims a different final state", () => {
    const now = { t: 0 };
    const m = manager(now);
    const s = m.start("p1", "cooling");
    const r = m.finish(s, "ffffffff");
    expect(r).toEqual({ ok: false, reason: "divergence" });
  });

  it("rejects out-of-order sequence numbers", () => {
    const now = { t: 0 };
    const m = manager(now);
    const s = m.start("p1", "cooling");
    const client = createCoolingGame(s.seed, s.config as CoolingConfig);
    const move = firstLegal(client);
    expect(m.move(s, 1, move, hashCoolingState(reduceCooling(client, move)))).toMatchObject({ ok: false, reason: "bad_sequence" });
  });

  it("rejects illegal moves", () => {
    const now = { t: 0 };
    const m = manager(now);
    const s = m.start("p1", "cooling");
    expect(m.move(s, 0, { type: "swap", col: 5, row: 0 }, "00000000")).toMatchObject({ ok: false, reason: "illegal_move" });
  });

  it("rejects moves after the deadline plus grace, and lists the session as expired", () => {
    const now = { t: 0 };
    const m = manager(now);
    const s = m.start("p1", "cooling");
    const client = createCoolingGame(s.seed, s.config as CoolingConfig);
    const move = firstLegal(client);
    now.t = 60_000 + 500; // inside grace
    expect(m.move(s, 0, move, hashCoolingState(reduceCooling(client, move)))).toEqual({ ok: true, seq: 0 });
    now.t = 60_000 + 1001;
    expect(m.expired().map((x) => x.id)).toEqual([s.id]);
    const next = firstLegal(reduceCooling(client, move));
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

  it("hands a ship's board back after a missing move, drops the old board's moves, and gives up after a few", () => {
    const now = { t: 1000 };
    const m = manager(now);
    const def = PUZZLES.swordfight;
    const config = { ...DEFAULT_SWORDFIGHT_CONFIG, foes: [] };
    const melee = { kind: "melee", shipId: "ship-1", voyageId: "v-1", tierId: "junker" } as const;
    const s = m.start("p1", "swordfight", { binding: melee, override: { config, roundMs: 60_000 } });
    let server = def.create(s.seed, config);
    now.t = 30_000;
    let tick = 0;
    const wait = () => ({ type: "wait", tick: ++tick });
    const send = (seq: number, move: unknown, state = server) => m.move(s, seq, move, def.hash(def.reduce(state, move)));
    const accept = (seq: number) => {
      const move = wait();
      const r = send(seq, move);
      if (r.ok === true) server = def.reduce(server, move);
      return r;
    };
    expect(accept(0)).toEqual({ ok: true, seq: 0 });
    // Move 1 never arrived: move 2 gets the board handed back, and the round stays open.
    expect(send(2, wait())).toEqual({ ok: "resync", atSeq: 2, handBack: true });
    expect(m.get(s.id)).toBe(s);
    // The old board's moves still in flight are dropped without another hand-back, and so is its finish.
    expect(send(3, wait())).toEqual({ ok: "resync", atSeq: 3, handBack: false });
    expect(m.staleFinish(s, "ffffffff")).toBe(true);
    expect(m.staleFinish(s, def.hash(server))).toBe(false);
    expect(s.moves.length).toBe(1);
    // The rebuilt board speaks at the right number and play goes on.
    expect(accept(1)).toEqual({ ok: true, seq: 1 });
    expect(s.resyncing).toBe(false);
    expect(m.staleFinish(s, "ffffffff")).toBe(false);
    // A few hand-backs, then the next missing move throws the round out.
    for (let i = 1; i < MAX_RESYNCS; i++) {
      expect(send(9, wait())).toMatchObject({ ok: "resync", handBack: true });
      expect(accept(s.moves.length)).toMatchObject({ ok: true });
    }
    expect(send(99, wait())).toEqual({ ok: false, reason: "bad_sequence", atSeq: 99 });
    expect(m.get(s.id)).toBeUndefined();
  });

  it("a melee board logs only the scrap the server announced, in order, and never its own win", () => {
    const now = { t: 0 };
    const m = manager(now);
    const def = PUZZLES.swordfight;
    const config = { ...DEFAULT_SWORDFIGHT_CONFIG, foes: [] };
    const melee = { kind: "melee", shipId: "ship-1", voyageId: "v-1", tierId: "junker" } as const;
    const s = m.start("p1", "swordfight", { binding: melee, override: { config, roundMs: 60_000 } });
    let client = def.create(s.seed, config);
    const log = (seq: number, move: unknown) => {
      const next = def.reduce(client, move);
      const r = m.move(s, seq, move, def.hash(next));
      if (r.ok) client = next;
      return r;
    };
    now.t = 1000;
    // Nothing announced: incoming is refused and the round is closed.
    expect(log(0, { type: "incoming", board: 0, scrap: 3, blade: 0, tick: 2 })).toMatchObject({ ok: false, reason: "illegal_move" });
    const s2 = m.start("p1", "swordfight", { binding: melee, override: { config, roundMs: 60_000 } });
    client = def.create(s2.seed, config);
    s2.vouched.vouch({ type: "incoming", board: 0, scrap: 3, blade: 1, tick: 0 });
    s2.vouched.vouch({ type: "incoming", board: 0, scrap: 5, blade: 0, tick: 0 });
    const log2 = (seq: number, move: unknown) => {
      const next = def.reduce(client, move);
      const r = m.move(s2, seq, move, def.hash(next));
      if (r.ok) client = next;
      return r;
    };
    // The announced scrap, in order, each at the board's own tick.
    expect(log2(0, { type: "wait", tick: 1 })).toEqual({ ok: true, seq: 0 });
    expect(log2(1, { type: "incoming", board: 0, scrap: 3, blade: 1, tick: 2 })).toEqual({ ok: true, seq: 1 });
    expect(s2.vouched.pending()).toEqual([{ type: "incoming", board: 0, scrap: 5, blade: 0, tick: 0 }]);
    expect(log2(2, { type: "incoming", board: 0, scrap: 5, blade: 0, tick: 3 })).toEqual({ ok: true, seq: 2 });
    expect(s2.vouched.pending()).toEqual([]);
    // A win over foes outside the board is the server's word, never the client's.
    expect(log2(3, { type: "end", won: true, tick: 4 })).toMatchObject({ ok: false, reason: "illegal_move" });
    // The server writes that end itself and the log still replays.
    const s3 = m.start("p1", "swordfight", { binding: melee, override: { config, roundMs: 60_000 } });
    expect(m.inject(s3, { type: "end", won: true, tick: 2 })).toBe(true);
    expect(s3.moves).toEqual([{ type: "end", won: true, tick: 2 }]);
    const r = m.finish(s3, null);
    expect(r.ok && r.summary.score).toBe(config.winPoints);
  });

  it("the captain's board logs the ship's latest deal, once", () => {
    const now = { t: 0 };
    const m = manager(now);
    const def = PUZZLES.battle;
    const config = { ...DEFAULT_BATTLE_CONFIG, supply: null };
    const battle = { kind: "battle", shipId: "ship-1", voyageId: "v-1", tierId: "junker" } as const;
    const s = m.start("p1", "battle", { binding: battle, override: { config, roundMs: 60_000 } });
    let client = def.create(s.seed, config);
    const log = (seq: number, move: unknown) => {
      const next = def.reduce(client, move);
      const r = m.move(s, seq, move, def.hash(next));
      if (r.ok) client = next;
      return r;
    };
    const deal = (left: number) => ({ type: "supply", left, forward: 2, right: 1, turrets: 2, hull: 0 });
    // A turn's deal the board has not logged gives way to the next turn's.
    s.vouched.vouch(deal(1));
    s.vouched.vouch(deal(2));
    expect(s.vouched.pending()).toEqual([deal(2)]);
    expect(log(0, deal(2))).toEqual({ ok: true, seq: 0 });
    expect(s.vouched.pending()).toEqual([]);
    // The engine would take the same deal twice; the server would not.
    expect(log(1, deal(2))).toMatchObject({ ok: false, reason: "illegal_move" });
    expect(m.get(s.id)).toBeUndefined();
  });

  it("caps the move count at the configured maximum", () => {
    const now = { t: 0 };
    const m = manager(now, { cooling: { maxMoves: 2 } });
    const s = m.start("p1", "cooling");
    let client = createCoolingGame(s.seed, s.config as CoolingConfig);
    for (let i = 0; i < 2; i++) {
      const move = firstLegal(client);
      client = reduceCooling(client, move);
      expect(m.move(s, i, move, hashCoolingState(client))).toEqual({ ok: true, seq: i });
    }
    // The engine itself marks the game finished, so a third move is illegal; either way it is rejected.
    const r = m.move(s, 2, { type: "end" }, "00000000");
    expect(r.ok).toBe(false);
  });

  it("rejects the first move past the cap as too_many_moves, before the engine's own refusal", () => {
    const now = { t: 1000 };
    const m = manager(now);
    const def = PUZZLES.gunnery;
    const s = m.start("p1", "gunnery", { binding: PRACTICE, override: { config: { ...DEFAULT_GUNNERY_CONFIG, maxMoves: 2 }, roundMs: 60_000 } });
    let client = s.state;
    for (let i = 0; i < 2; i++) {
      const move = { type: "wait", tick: i + 1 };
      client = def.reduce(client, move);
      expect(m.move(s, i, move, def.hash(client))).toEqual({ ok: true, seq: i });
    }
    expect(m.move(s, 2, { type: "wait", tick: 3 }, "00000000")).toEqual({ ok: false, reason: "too_many_moves", atSeq: 2 });
  });

  it("a harness Cooling round plays a lone ship's heat: it turns on the round's clock and only its depth is a legal heat move", () => {
    const now = { t: 1000 };
    // A leaky hull so the heat climbs past the board's floor inside a one-minute round.
    const m = manager(now, { soloHeat: { rules: { ...DEFAULT_SHIP_RULES, heatIntakePerTurn: 200 }, par: 20 } });
    const s = m.start("p1", "cooling");
    expect((s.config as CoolingConfig).shipHeat).toBe(true);
    // A dry ship reads as the heat's floor, which is where the board starts.
    expect(s.vouched.pending()).toEqual([{ type: "heat", row: 3 }]);
    now.t += 9_999;
    expect(m.turnSoloHeat()).toEqual([]);
    // One turn: 200 permille still reads as the floor, so there is nothing to tell the client.
    now.t += 1;
    expect(m.turnSoloHeat()).toEqual([]);
    // Two: 400 permille is five rows.
    now.t += 10_000;
    expect(m.turnSoloHeat().map((c) => ({ id: c.session.id, row: c.row }))).toEqual([{ id: s.id, row: 5 }]);
    expect(s.vouched.pending()).toEqual([{ type: "heat", row: 5 }]);
    expect(m.turnSoloHeat()).toEqual([]);

    let client = createCoolingGame(s.seed, s.config as CoolingConfig);
    client = reduceCooling(client, { type: "heat", row: 5 });
    expect(m.move(s, 0, { type: "heat", row: 5 }, hashCoolingState(client))).toEqual({ ok: true, seq: 0 });
    // The depth stands until the next: logging it again is no lie.
    client = reduceCooling(client, { type: "heat", row: 5 });
    expect(m.move(s, 1, { type: "heat", row: 5 }, hashCoolingState(client))).toEqual({ ok: true, seq: 1 });
    const lie = reduceCooling(client, { type: "heat", row: 3 });
    expect(m.move(s, 2, { type: "heat", row: 3 }, hashCoolingState(lie))).toMatchObject({ ok: false, reason: "illegal_move" });
  });

  it("no lone ship turns after the round's deadline, and a duty board has none", () => {
    const now = { t: 0 };
    const m = manager(now, { soloHeat: { rules: { ...DEFAULT_SHIP_RULES, heatIntakePerTurn: 400 }, par: 20 } });
    const s = m.start("p1", "cooling");
    now.t = 120_000;
    m.turnSoloHeat();
    // A one-minute round has five turns before its deadline, never a sixth.
    expect(s.soloHeat?.turns).toBe(5);
    const duty = m.start("p2", "cooling", { binding: { kind: "duty", shipId: "ship", station: "cooling", voyageId: "v", heat: 7 } });
    expect(duty.soloHeat).toBeNull();
    expect(duty.vouched.pending()).toEqual([{ type: "heat", row: 7 }]);
  });
});
