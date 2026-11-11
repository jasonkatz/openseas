/**
 * Every board is dealt with the host it reports to (the ship it is played aboard), and what the
 * server tells the board goes to its pirate's line. These tests stand in a host that writes down
 * what it hears and an inbox for the pirate, against the real puzzle service; the database takes
 * every write and keeps none.
 */
import { describe, expect, it } from "vitest";
import { loadContent, type Content } from "@openseas/content";
import {
  DEFAULT_BATTLE_CONFIG,
  createBattleGame,
  createCoolingGame,
  hashBattleState,
  hashCoolingState,
  reduceBattle,
  reduceCooling,
  type BattleMove,
  type BattleState,
  type CoolingConfig,
} from "@openseas/engine";
import type { ServerMessage } from "@openseas/protocol";
import { PRACTICE, type SessionBinding } from "../src/puzzles/binding.js";
import type { Db } from "../src/db/index.js";
import { createLogger } from "../src/log.js";
import { Presence } from "../src/presence.js";
import { PuzzleService, type BoardEnd, type BoardHost } from "../src/puzzles/service.js";
import { Inbox } from "./inbox.js";
import { scoringMove } from "./moves.js";

/** Takes every write and keeps none: these tests are about who hears a board, not what is stored. */
function nullDb(): Db {
  const insert = () => ({ values: () => Promise.resolve() });
  return { insert, transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({ insert }) } as unknown as Db;
}

/** The real puzzle service, with p1's line an inbox: whatever the server tells p1's boards lands in it. */
function service(now: { t: number }, content: Content = loadContent()): { puzzles: PuzzleService; p1: Inbox } {
  const presence = new Presence();
  const p1 = new Inbox("p1");
  presence.attach(p1.id, p1);
  return { puzzles: new PuzzleService(nullDb(), content, createLogger("silent", false), presence, () => now.t), p1 };
}

type Heard =
  | { readonly what: "moved"; readonly moves: number }
  | { readonly what: "closing"; readonly closed: boolean; readonly held: boolean; readonly score: number }
  | { readonly what: "ended"; readonly how: BoardEnd; readonly result: ServerMessage | null; readonly closed: boolean; readonly told: boolean };

/** A host that writes down everything it hears, how the board stood, and whether the pirate had been told the result yet. */
function recorder(puzzles: PuzzleService, pirate: Inbox): { host: BoardHost; heard: Heard[] } {
  const heard: Heard[] = [];
  const host: BoardHost = {
    moved: (s) => void heard.push({ what: "moved", moves: s.moves.length }),
    closing: (s) => void heard.push({ what: "closing", closed: s.closed, held: puzzles.sessions.get(s.id) === s, score: puzzles.sessions.score(s) }),
    ended: (s, how, result) => void heard.push({ what: "ended", how, result, closed: s.closed, told: result !== null && pirate.got.includes(result) }),
  };
  return { host, heard };
}

const duty: SessionBinding = { kind: "duty", shipId: "ship-1", station: "cooling", voyageId: "v-1", heat: 3 };
const battle: SessionBinding = { kind: "battle", shipId: "ship-1", voyageId: "v-1", tierId: "junker" };
const melee: SessionBinding = { kind: "melee", shipId: "ship-1", voyageId: "v-1", tierId: "junker" };

/** A Cooling board dealt to `host`, and a client that plays it honestly. */
async function coolingBoard(puzzles: PuzzleService, binding: SessionBinding, host?: BoardHost) {
  const started = await puzzles.start("p1", "cooling", { binding, ...(host ? { host } : {}) });
  const session = puzzles.sessions.get(started.sessionId)!;
  let client = createCoolingGame(started.seed, started.config as CoolingConfig);
  return {
    session,
    get client() {
      return client;
    },
    /** Play `n` honest moves, each answered by the server before the next. */
    async play(n: number): Promise<void> {
      for (let i = 0; i < n; i++) {
        const move = scoringMove(client);
        client = reduceCooling(client, move);
        await puzzles.move(session, session.moves.length, move, hashCoolingState(client));
        expect(session.closed).toBe(false);
      }
    },
  };
}

/** The captain's battle board dealt to `host` on the ship's own config, with no practice supply. */
async function battleBoard(puzzles: PuzzleService, host: BoardHost) {
  const config = { ...DEFAULT_BATTLE_CONFIG, supply: null };
  const started = await puzzles.start("p1", "battle", { binding: battle, override: { config, roundMs: 60_000 }, host });
  const session = puzzles.sessions.get(started.sessionId)!;
  let client: BattleState = createBattleGame(started.seed, config);
  return {
    session,
    /** Log `move` at the next number, as an honest board does. */
    log(move: BattleMove): Promise<void> {
      client = reduceBattle(client, move);
      return puzzles.move(session, session.moves.length, move, hashBattleState(client));
    },
    /** A move that carries the wrong number: one before it went missing. The server never replays it. */
    skip(): Promise<void> {
      return puzzles.move(session, session.moves.length + 2, { type: "commit", segments: [], grapple: false }, "00000000");
    },
  };
}

const deal = (left: number) => ({ type: "supply", left, forward: 2, right: 1, turrets: 2, hull: 0 }) as const;

describe("BoardHost", () => {
  it("hears each move the server accepts, then the board closing while it is still open, then its end, before the pirate is told the result", async () => {
    const now = { t: 1000 };
    const { puzzles, p1 } = service(now);
    const rec = recorder(puzzles, p1);
    const board = await coolingBoard(puzzles, duty, rec.host);
    await board.play(3);
    expect(rec.heard).toEqual([1, 2, 3].map((moves) => ({ what: "moved", moves })));
    expect(board.client.score).toBeGreaterThan(0);

    // A duty board's host hears it closing before it closes: the next ship turn would drop a closed
    // board unpaid, so the board's last points must still be the board's when its host hears.
    const finishing = puzzles.finish(board.session, hashCoolingState(board.client), null);
    expect(rec.heard.slice(3)).toEqual([{ what: "closing", closed: false, held: true, score: board.client.score }]);
    expect(board.session.closed).toBe(true);
    const result = await finishing;
    expect(result).toMatchObject({ type: "puzzle.result", score: board.client.score, moves: 3, rating: null });
    // The host hears the end first (a melee board's end shows the boards and may settle the fight), then the pirate is told.
    expect(rec.heard.slice(4)).toEqual([{ what: "ended", how: "finished", result, closed: true, told: false }]);
    expect(p1.got).toEqual([result]);
  });

  it("hears a board the server threw out closing at once, before its round is stored, then its end, and its pirate is told", async () => {
    const now = { t: 1000 };
    const { puzzles, p1 } = service(now);
    const rec = recorder(puzzles, p1);
    const board = await coolingBoard(puzzles, duty, rec.host);
    await board.play(2);
    const score = puzzles.sessions.score(board.session);
    const refusing = puzzles.move(board.session, 2, scoringMove(board.client), "00000000");
    // The bad move closed it; the host hears that before anything asynchronous can run.
    expect(rec.heard.slice(2)).toEqual([{ what: "closing", closed: true, held: false, score }]);
    await refusing;
    const rejected: ServerMessage = { type: "puzzle.rejected", sessionId: board.session.id, reason: "divergence", atSeq: 2 };
    expect(rec.heard.slice(3)).toEqual([{ what: "ended", how: "rejected", result: rejected, closed: true, told: false }]);
    expect(p1.got).toEqual([rejected]);
  });

  it("sends a ship's board that missed a move back to its pirate, and hears it abandoned", async () => {
    const now = { t: 1000 };
    const { puzzles, p1 } = service(now);
    const rec = recorder(puzzles, p1);
    const board = await battleBoard(puzzles, rec.host);
    puzzles.vouch(board.session, deal(1));
    expect(p1.got).toEqual([{ type: "battle.supply", sessionId: board.session.id, left: 1, forward: 2, right: 1, turrets: 2, hull: 0 }]);
    await board.log(deal(1));
    expect(rec.heard).toEqual([{ what: "moved", moves: 1 }]);

    // The next turn's deal went astray (the board never logs it), and so did a move: the board goes
    // back with the server's log and the deal it never logged, to its pirate, and the host hears no move.
    puzzles.vouch(board.session, deal(2));
    p1.got.length = 0;
    await board.skip();
    expect(p1.got).toEqual(puzzles.handBack(board.session));
    expect(p1.got.map((m) => m.type)).toEqual(["puzzle.started", "battle.supply"]);
    expect(rec.heard).toHaveLength(1);

    p1.got.length = 0;
    await puzzles.quit(board.session);
    expect(rec.heard.slice(1)).toEqual([
      { what: "closing", closed: false, held: true, score: 0 },
      { what: "ended", how: "abandoned", result: null, closed: true, told: false },
    ]);
    expect(p1.got).toEqual([]);
  });

  it("hears nothing more of a board once detached, while its pirate still hears what the server tells it", async () => {
    const now = { t: 1000 };
    const { puzzles, p1 } = service(now);
    const rec = recorder(puzzles, p1);
    const board = await battleBoard(puzzles, rec.host);
    puzzles.vouch(board.session, deal(1));
    puzzles.detach(board.session);
    await board.log(deal(1));
    expect(board.session.moves).toHaveLength(1);
    await board.skip();
    expect(p1.got.map((m) => m.type)).toEqual(["battle.supply", "puzzle.started"]);
    await puzzles.quit(board.session);
    expect(board.session.closed).toBe(true);
    expect(rec.heard).toEqual([]);

    // A station the ship ends itself: the board is cut short and counts, its pirate is told, and its
    // host, detached, takes nothing from it.
    const station = recorder(puzzles, p1);
    const cooling = await coolingBoard(puzzles, duty, station.host);
    await cooling.play(2);
    station.heard.length = 0;
    p1.got.length = 0;
    puzzles.detach(cooling.session);
    await puzzles.cutShort(cooling.session);
    expect(p1.got).toMatchObject([{ type: "puzzle.result", sessionId: cooling.session.id, moves: 2 }]);
    expect(station.heard).toEqual([]);
  });

  it("tells a practice round's pirate the lone ship's heat", async () => {
    const now = { t: 1000 };
    const content = loadContent();
    // A leaky hull, so the heat climbs past the board's floor in two turns.
    const leaky: Content = { ...content, world: { ...content.world, ship: { ...content.world.ship, heatIntakePerTurn: 200 } } };
    const { puzzles, p1 } = service(now, leaky);
    const { session } = await coolingBoard(puzzles, PRACTICE);
    const floor = (session.config as CoolingConfig).minHeatRow;
    expect(session.vouched.pending()).toEqual([{ type: "heat", row: floor }]);
    now.t += 2 * leaky.world.ship.turnSeconds * 1000;
    puzzles.tick();
    const row = (session.vouched.pending()[0] as { row: number }).row;
    expect(row).toBeGreaterThan(floor);
    expect(p1.got).toEqual([{ type: "duty.heat", sessionId: session.id, row }]);
  });
});

describe("a pirate's open round", () => {
  it("is quit when they are dealt another, whatever it is played for: a melee board is abandoned and its host hears it end", async () => {
    const now = { t: 1000 };
    const { puzzles, p1 } = service(now);
    const rec = recorder(puzzles, p1);
    const fight = await puzzles.start("p1", "swordfight", { binding: melee, host: rec.host });
    const board = puzzles.sessions.get(fight.sessionId)!;
    expect(puzzles.sessions.openFor("p1")).toBe(board);

    // A practice round mid-melee: the melee board is quit by its binding's policy (abandoned) before
    // the practice round is dealt, and its host hears it end, as the melee does to drop it from the fight.
    const practice = await puzzles.start("p1", "cooling", { binding: PRACTICE });
    expect(board.closed).toBe(true);
    expect(rec.heard).toEqual([
      { what: "closing", closed: false, held: true, score: 0 },
      { what: "ended", how: "abandoned", result: null, closed: true, told: false },
    ]);
    expect(puzzles.sessions.openFor("p1")?.id).toBe(practice.sessionId);
    expect(p1.got).toEqual([]);
  });

  it("is cut short at a station, and its pirate is told the result before the next deal is returned", async () => {
    const now = { t: 1000 };
    const { puzzles, p1 } = service(now);
    const rec = recorder(puzzles, p1);
    const station = await coolingBoard(puzzles, duty, rec.host);
    await station.play(2);
    rec.heard.length = 0;
    const dealing = puzzles.start("p1", "cooling", { binding: PRACTICE });
    // The station hears its board closing at once, while its last points are still the board's.
    expect(rec.heard).toEqual([{ what: "closing", closed: false, held: true, score: station.client.score }]);
    expect(p1.got).toEqual([]);
    const practice = await dealing;
    expect(p1.got).toMatchObject([{ type: "puzzle.result", sessionId: station.session.id, moves: 2, rating: null }]);
    expect(practice.sessionId).not.toBe(station.session.id);
  });

  it("is no longer theirs once it closed: a round already over is not quit again", async () => {
    const now = { t: 1000 };
    const { puzzles, p1 } = service(now);
    const rec = recorder(puzzles, p1);
    const station = await coolingBoard(puzzles, duty, rec.host);
    await station.play(1);
    await puzzles.finish(station.session, hashCoolingState(station.client), null);
    expect(puzzles.sessions.openFor("p1")).toBeNull();
    rec.heard.length = 0;
    p1.got.length = 0;
    await puzzles.start("p1", "cooling", { binding: PRACTICE });
    expect(rec.heard).toEqual([]);
    expect(p1.got).toEqual([]);
  });
});
