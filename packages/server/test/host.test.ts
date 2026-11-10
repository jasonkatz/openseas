/**
 * Every board is dealt with the host it reports to (the ship it is played aboard, or a practice
 * round's pirate). These tests stand in a host that writes down what it hears, against the real
 * puzzle service; the database takes every write and keeps none.
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
  swapIllegalReason,
  type BattleMove,
  type BattleState,
  type CoolingConfig,
  type CoolingMove,
  type CoolingState,
} from "@openseas/engine";
import type { ServerMessage } from "@openseas/protocol";
import { PRACTICE, type SessionBinding } from "../src/puzzles/binding.js";
import type { Db } from "../src/db/index.js";
import { createLogger } from "../src/log.js";
import { PuzzleService, type BoardEnd, type BoardHost } from "../src/puzzles/service.js";

/** Takes every write and keeps none: these tests are about who hears a board, not what is stored. */
function nullDb(): Db {
  const insert = () => ({ values: () => Promise.resolve() });
  return { insert, transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({ insert }) } as unknown as Db;
}

function service(now: { t: number }, content: Content = loadContent()): PuzzleService {
  return new PuzzleService(nullDb(), content, createLogger("silent", false), () => now.t);
}

type Heard =
  | { readonly what: "moved"; readonly moves: number }
  | { readonly what: "closing"; readonly closed: boolean; readonly held: boolean; readonly score: number }
  | { readonly what: "ended"; readonly how: BoardEnd; readonly result: ServerMessage | null; readonly closed: boolean };

/** A host that writes down everything it hears, and how the board stood when it heard it. */
function recorder(puzzles: PuzzleService): { host: BoardHost; heard: Heard[]; sent: ServerMessage[] } {
  const heard: Heard[] = [];
  const sent: ServerMessage[] = [];
  const host: BoardHost = {
    send: (m) => void sent.push(m),
    moved: (s) => void heard.push({ what: "moved", moves: s.moves.length }),
    closing: (s) => void heard.push({ what: "closing", closed: s.closed, held: puzzles.sessions.get(s.id) === s, score: puzzles.sessions.score(s) }),
    ended: (s, how, result) => void heard.push({ what: "ended", how, result, closed: s.closed }),
  };
  return { host, heard, sent };
}

/** A swap that scores if one exists, else the first legal swap. */
function scoringMove(state: CoolingState): CoolingMove {
  let fallback: CoolingMove | null = null;
  for (let r = 0; r < state.config.height; r++) {
    for (let c = 0; c < state.config.width - 1; c++) {
      if (swapIllegalReason(state, c, r) !== null) continue;
      const move: CoolingMove = { type: "swap", col: c, row: r };
      if (reduceCooling(state, move).score > state.score) return move;
      fallback ??= move;
    }
  }
  if (!fallback) throw new Error("no legal move");
  return fallback;
}

const duty: SessionBinding = { kind: "duty", shipId: "ship-1", station: "cooling", voyageId: "v-1", heat: 3 };
const battle: SessionBinding = { kind: "battle", shipId: "ship-1", voyageId: "v-1", tierId: "junker" };

/** A Cooling board dealt to `host`, and a client that plays it honestly. */
function coolingBoard(puzzles: PuzzleService, binding: SessionBinding, host: BoardHost) {
  const started = puzzles.start("p1", "cooling", { binding, host });
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
        expect(await puzzles.move(session, session.moves.length, move, hashCoolingState(client))).toBeNull();
      }
    },
  };
}

/** The captain's battle board dealt to `host` on the ship's own config, with no practice supply. */
function battleBoard(puzzles: PuzzleService, host: BoardHost) {
  const config = { ...DEFAULT_BATTLE_CONFIG, supply: null };
  const started = puzzles.start("p1", "battle", { binding: battle, override: { config, roundMs: 60_000 }, host });
  const session = puzzles.sessions.get(started.sessionId)!;
  let client: BattleState = createBattleGame(started.seed, config);
  return {
    session,
    /** Log `move` at the next number, as an honest board does. */
    async log(move: BattleMove): Promise<ServerMessage | null> {
      client = reduceBattle(client, move);
      return puzzles.move(session, session.moves.length, move, hashBattleState(client));
    },
    /** A move that carries the wrong number: one before it went missing. The server never replays it. */
    skip(): Promise<ServerMessage | null> {
      return puzzles.move(session, session.moves.length + 2, { type: "commit", segments: [], grapple: false }, "00000000");
    },
  };
}

const deal = (left: number) => ({ type: "supply", left, forward: 2, right: 1, turrets: 2, hull: 0 }) as const;

describe("BoardHost", () => {
  it("hears each move the server accepts, then the board closing while it is still open, then its end with the result", async () => {
    const now = { t: 1000 };
    const puzzles = service(now);
    const rec = recorder(puzzles);
    const board = coolingBoard(puzzles, duty, rec.host);
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
    expect(rec.heard.slice(4)).toEqual([{ what: "ended", how: "finished", result, closed: true }]);
    expect(rec.sent).toEqual([]);
  });

  it("hears a board the server threw out closing at once, before its round is stored, then its end", async () => {
    const now = { t: 1000 };
    const puzzles = service(now);
    const rec = recorder(puzzles);
    const board = coolingBoard(puzzles, duty, rec.host);
    await board.play(2);
    const score = puzzles.sessions.score(board.session);
    const refusing = puzzles.move(board.session, 2, scoringMove(board.client), "00000000");
    // The bad move closed it; the host hears that before anything asynchronous can run.
    expect(rec.heard.slice(2)).toEqual([{ what: "closing", closed: true, held: false, score }]);
    const rejected = await refusing;
    expect(rejected).toEqual({ type: "puzzle.rejected", sessionId: board.session.id, reason: "divergence", atSeq: 2 });
    expect(rec.heard.slice(3)).toEqual([{ what: "ended", how: "rejected", result: rejected, closed: true }]);
  });

  it("sends a ship's board that missed a move back through its host, and hears it abandoned", async () => {
    const now = { t: 1000 };
    const puzzles = service(now);
    const rec = recorder(puzzles);
    const board = battleBoard(puzzles, rec.host);
    expect(puzzles.vouch(board.session, deal(1))).toEqual({ type: "battle.supply", sessionId: board.session.id, left: 1, forward: 2, right: 1, turrets: 2, hull: 0 });
    expect(await board.log(deal(1))).toBeNull();
    expect(rec.heard).toEqual([{ what: "moved", moves: 1 }]);

    // The next turn's deal went astray, and so did a move: the board goes back with the server's log
    // and the deal it never logged, to its pirate, and the host hears no move.
    puzzles.vouch(board.session, deal(2));
    expect(await board.skip()).toBeNull();
    expect(rec.sent).toEqual(puzzles.handBack(board.session));
    expect(rec.sent.map((m) => m.type)).toEqual(["puzzle.started", "battle.supply"]);
    expect(rec.heard).toHaveLength(1);

    expect(await puzzles.quit(board.session)).toBeNull();
    expect(rec.heard.slice(1)).toEqual([
      { what: "closing", closed: false, held: true, score: 0 },
      { what: "ended", how: "abandoned", result: null, closed: true },
    ]);
  });

  it("hears nothing more of a board once detached, while its pirate still hears what the server tells it", async () => {
    const now = { t: 1000 };
    const puzzles = service(now);
    const rec = recorder(puzzles);
    const board = battleBoard(puzzles, rec.host);
    puzzles.vouch(board.session, deal(1));
    puzzles.detach(board.session);
    expect(await board.log(deal(1))).toBeNull();
    expect(board.session.moves).toHaveLength(1);
    expect(await board.skip()).toBeNull();
    expect(rec.sent.map((m) => m.type)).toEqual(["puzzle.started"]);
    expect(await puzzles.quit(board.session)).toBeNull();
    expect(board.session.closed).toBe(true);
    expect(rec.heard).toEqual([]);

    // A station the ship ends itself: the board is cut short and counts, and its host, detached, takes nothing from it.
    const station = recorder(puzzles);
    const cooling = coolingBoard(puzzles, duty, station.host);
    await cooling.play(2);
    station.heard.length = 0;
    puzzles.detach(cooling.session);
    expect(await puzzles.cutShort(cooling.session)).toMatchObject({ type: "puzzle.result", moves: 2 });
    expect(station.heard).toEqual([]);
  });

  it("tells a practice round's pirate the lone ship's heat through its host", () => {
    const now = { t: 1000 };
    const content = loadContent();
    // A leaky hull, so the heat climbs past the board's floor in two turns.
    const leaky: Content = { ...content, world: { ...content.world, ship: { ...content.world.ship, heatIntakePerTurn: 200 } } };
    const puzzles = service(now, leaky);
    const rec = recorder(puzzles);
    const { session } = coolingBoard(puzzles, PRACTICE, rec.host);
    const floor = (session.config as CoolingConfig).minHeatRow;
    expect(session.vouched.pending()).toEqual([{ type: "heat", row: floor }]);
    now.t += 2 * leaky.world.ship.turnSeconds * 1000;
    puzzles.tick();
    const row = (session.vouched.pending()[0] as { row: number }).row;
    expect(row).toBeGreaterThan(floor);
    expect(rec.sent).toEqual([{ type: "duty.heat", sessionId: session.id, row }]);
    expect(rec.heard).toEqual([]);
  });
});
