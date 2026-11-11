/**
 * The boarding melee's rules at its own interface (ADR 0022): no ship, no sessions, no database.
 * Pirates' boards are engine states the test holds, shown to the melee the way the ship shows them.
 */
import { describe, expect, it } from "vitest";
import { loadContent } from "@openseas/content";
import { createSwordfightGame, reduceSwordfight, swordfightBoardString, type SwordfightEvent, type SwordfightState } from "@openseas/engine";
import { Melee, type MeleeOpening, type MeleeOutcome, type MeleeStep, type PirateBoard, type PirateBoards } from "../src/ships/melee.js";

const content = loadContent();
const rules = content.puzzles.swordfight.config;
const junker = content.world.raiderTiers.find((t) => t.id === "junker")!;
/** A raider crew that drops every tick and always takes its best drop, so it breaks, and sends scrap, soon. */
const drill = { id: "drill", scorePercent: 100, swordsmen: { thinkTicks: 1, skill: 100, blade: 1 } };
const tickMs = rules.tickMs;

function open(pirates: number, o: Partial<MeleeOpening> = {}): Melee {
  return Melee.open({ rules, tier: junker, pirates, seed: "melee-test", now: 0, dutyOutput: new Map(), turns: 0, ...o });
}

/** A pirate's board as it is dealt in this melee. */
function board(melee: Melee, seed = "pirate"): SwordfightState {
  return createSwordfightGame(seed, melee.boardConfig);
}

/** A pirate's board with scrap waiting on it, logged as the server announced it. */
function loaded(melee: Melee, scrap: number): SwordfightState {
  return reduceSwordfight(board(melee), { type: "incoming", board: 0, scrap, blade: 0, tick: 0 });
}

/** A pirate's board buried in scrap until it is out. */
function out(melee: Melee): SwordfightState {
  let s = loaded(melee, 999);
  for (let i = 0; i < 50 && !s.boards[0]!.out; i++) s = reduceSwordfight(s, { type: "wait", tick: s.tick + rules.landAfterTicks });
  expect(s.boards[0]!.out).toBe(true);
  return s;
}

/** The ship's view of the pirates' boards: these boards, connected and with nothing announced unless given. */
function view(boards: Record<string, Partial<PirateBoard> & { state: SwordfightState }>): PirateBoards {
  return (pirateId) => {
    const b = boards[pirateId];
    return b ? { announced: 0, connected: true, ...b } : null;
  };
}

/** A board whose last move sent these events. */
function moved(melee: Melee, events: SwordfightEvent[]): SwordfightState {
  return { ...board(melee), lastMove: { move: { type: "wait", tick: 3 }, events, points: 0 } };
}

describe("the boarding melee", () => {
  it("opens with a raider board for each pirate at the airlock, up to eight, and deals every pirate the same board", () => {
    const m = open(3, { now: 5_000 });
    expect(m.tierId).toBe(junker.id);
    expect(m.crew.config.player).toBe(false);
    expect(m.crew.config.foes).toEqual([]);
    expect(m.crew.boards).toHaveLength(3);
    for (const b of m.crew.boards) expect(b).toMatchObject({ mind: "ai", side: 0, ai: junker.swordsmen, out: false });
    expect(m.crew.tick).toBe(0);
    expect(open(10).crew.boards).toHaveLength(8);

    // A pirate's own board: alone in its fight, the raider crew outside it, on the melee's deal and the tier's score factor.
    expect(m.boardConfig).toEqual({ ...rules, player: true, allies: [], foes: [], dealSeed: "melee-test", scorePercent: junker.scorePercent });
    expect(m.deadlineAt).toBe(5_000 + rules.maxTick * tickMs);
    expect(m.roundMs(5_000)).toBe(rules.maxTick * tickMs);
    expect(m.roundMs(m.deadlineAt - 1_000)).toBe(10_000);
    expect(m.fights.size).toBe(0);
    expect(m.mayDeal("p1")).toBe(true);
    m.dealt("p1", "s1");
    expect([...m.fights]).toEqual([["p1", "s1"]]);
  });

  it("runs the raider crew on its own clock, and breaks the airlock off at the fight's last tick", () => {
    const m = open(1);
    m.dealt("p1", "s1");
    const boards = view({ p1: { state: board(m) } });
    expect(m.advance(tickMs - 1, boards)).toEqual({ announce: [], changed: false, decided: null });
    expect(m.crew.tick).toBe(0);
    m.advance(5 * tickMs + 10, boards);
    expect(m.crew.tick).toBe(5);
    // The clock read earlier moves nothing.
    m.advance(2 * tickMs, boards);
    expect(m.crew.tick).toBe(5);
    // The raider drops its first pair on its own cadence.
    const step = m.advance(junker.swordsmen.thinkTicks * tickMs, boards);
    expect(step.changed).toBe(true);
    expect(m.crew.boards[0]!.drops).toBe(1);
    // At the deadline nothing moves: the airlock is broken off.
    const before = m.crew;
    expect(m.advance(m.deadlineAt, boards)).toEqual({ announce: [], changed: false, decided: "broke_off" });
    expect(m.crew).toBe(before);
  });

  it("sends the raider crew's scrap to the connected pirate with the least on their board", () => {
    const m = open(2, { tier: drill });
    for (const id of ["heavy", "told", "light", "away", "beaten", "gone"]) m.dealt(id, `s-${id}`);
    const boards = view({
      heavy: { state: loaded(m, 30) },
      // Nothing on the board yet, but scrap announced to it counts.
      told: { state: board(m), announced: 40 },
      light: { state: loaded(m, 10) },
      away: { state: board(m), connected: false },
      beaten: { state: out(m) },
    });
    let first: MeleeStep["announce"][number] | null = null;
    for (let t = 1; t <= 300 && !first; t++) first = m.advance(t * tickMs, boards).announce[0] ?? null;
    expect(first).not.toBeNull();
    expect(first!.pirateId).toBe("light");
    expect(first!.move).toMatchObject({ type: "incoming", board: 0, blade: drill.swordsmen.blade, tick: m.crew.tick });
    expect(first!.move.scrap).toBeGreaterThan(0);
    // The pirate's board logs it as said.
    expect(() => reduceSwordfight(board(m), first!.move)).not.toThrow();
  });

  it("counts scrap announced earlier in the same step, and drops scrap with nobody there to take it", () => {
    const m = open(2, { tier: drill });
    m.dealt("p1", "s1");
    m.dealt("p2", "s2");
    const step = m.advance(400 * tickMs, view({ p1: { state: board(m) }, p2: { state: board(m) } }));
    expect(step.announce.length).toBeGreaterThanOrEqual(2);
    // Each batch goes to whoever has had less so far; the first dealt takes a tie.
    const so = { p1: 0, p2: 0 };
    for (const a of step.announce) {
      expect(a.pirateId).toBe(so.p1 <= so.p2 ? "p1" : "p2");
      so[a.pirateId as "p1" | "p2"] += a.move.scrap;
    }

    const alone = open(1, { tier: drill });
    alone.dealt("p1", "s1");
    const away = view({ p1: { state: board(alone), connected: false } });
    let sent = false;
    for (let t = 1; t <= 300 && !alone.crew.finished; t++) {
      const s = alone.advance(t * tickMs, away);
      expect(s.announce).toEqual([]);
      sent ||= alone.crew.lastMove?.events.some((e) => e.type === "attack" && e.to === -1) ?? false;
    }
    expect(sent).toBe(true);
  });

  it("lands scrap a pirate's board sends on the raider board with the least on it", () => {
    const m = open(3);
    const pending = (): number[][] => m.crew.boards.map((b) => b.pending.map((p) => p.scrap));
    m.pirateSent(0, 10, 0);
    m.pirateSent(0, 6, 0);
    m.pirateSent(0, 8, 0);
    expect(pending()).toEqual([[10], [6], [8]]);
    m.pirateSent(0, 3, 0);
    expect(pending()).toEqual([[10], [6, 3], [8]]);
    // A batch is at most 999, and it lands at the raider crew's clock.
    m.pirateSent(7 * tickMs, 5_000, 2);
    expect(pending()).toEqual([[10], [6, 3], [8, 999]]);
    expect(m.crew.tick).toBe(7);
    expect(m.crew.boards[2]!.pending[1]).toEqual({ scrap: 999, blade: 2 });

    // A move reports what the board sent: only scrap that left the board goes over.
    const attack = (scrap: number, to: number): SwordfightEvent => ({ tick: 3, board: 0, type: "attack", to, scrap, offset: 0, blade: 1 });
    const placed: SwordfightEvent = { tick: 3, board: 0, type: "placed", cells: [0, 1], ids: [1, 2] };
    expect(m.pirateMoved(7 * tickMs, moved(m, [placed, attack(4, -1), attack(0, -2)]))).toBe(true);
    expect(pending()).toEqual([[10], [6, 3, 4], [8, 999]]);
    expect(m.pirateMoved(7 * tickMs, moved(m, [placed]))).toBe(true);
    expect(m.pirateMoved(7 * tickMs, moved(m, []))).toBe(false);
    expect(m.pirateMoved(7 * tickMs, board(m))).toBe(false);
    expect(pending()).toEqual([[10], [6, 3, 4], [8, 999]]);
  });

  it("keeps a pirate's score when their board ends, and deals them no second board", () => {
    const m = open(2);
    m.dealt("p1", "s1");
    m.dealt("p2", "s2");
    m.pirateEnded("p1", 1_234);
    expect([...m.fights.keys()]).toEqual(["p2"]);
    expect(m.mayDeal("p1")).toBe(false);
    expect(m.mayDeal("p2")).toBe(true);
    expect(m.mayDeal("late")).toBe(true);
    expect(m.points(["p1", "p2"], 60_000, { parRatePerMinute: 1_000, turnSeconds: 10 }).get("p1")).toBeGreaterThan(0);
  });

  it("decides the airlock: lost when no pirate's board stands, won when every raider board is out", () => {
    const m = open(2);
    m.dealt("p1", "s1");
    m.dealt("p2", "s2");
    expect(m.decide(view({ p1: { state: board(m) }, p2: { state: board(m) } }))).toBeNull();
    expect(m.decide(view({ p1: { state: out(m) }, p2: { state: board(m) } }))).toBeNull();
    // A board that is out, and one that is closed: nobody stands.
    expect(m.decide(view({ p1: { state: out(m) } }))).toBe("boarded_by");
    m.pirateEnded("p1", 0);
    m.pirateEnded("p2", 0);
    expect(m.decide(view({}))).toBe("boarded_by");

    // Bury every raider board in scrap; the raider crew's own clock lands it and puts them out.
    const won = open(2);
    won.dealt("p1", "s1");
    const boards = view({ p1: { state: board(won) } });
    for (let i = 0; i < won.crew.boards.length; i++) won.pirateSent(0, 999, 0);
    let decided: MeleeOutcome | null = null;
    for (let t = 1; t <= 40 && !decided; t++) decided = won.advance(t * rules.landAfterTicks * tickMs, boards).decided;
    expect(decided).toBe("boarded");
    expect(won.crew.finished).toBe(true);
    expect(won.crew.boards.every((b) => b.out)).toBe(true);
  });

  it("tells a board the raider crew is beaten at the raider crew's clock, or the board's own if it is later", () => {
    const m = open(1);
    const at = (tick: number): SwordfightState => ({ ...board(m), tick });
    expect(m.overTick(10 * tickMs, at(3))).toBe(10);
    expect(m.overTick(2 * tickMs, at(7))).toBe(7);
    expect(m.overTick(m.deadlineAt + 60_000, at(0))).toBe(rules.maxTick);
  });

  it("weighs each pirate's melee in the plunder as duty turns at their attack rate, on top of the space battle", () => {
    const m = open(2, { dutyOutput: new Map([["p1", 300], ["p3", 120]]) });
    m.dealt("p1", "s1");
    m.dealt("p2", "s2");
    // A won board's score carries the win band, which is no part of the rate; a lost board's is all rate.
    m.pirateEnded("p1", rules.winPoints + 600);
    m.pirateEnded("p2", 450);
    const points = m.points(["p1", "p2", "p3", "bot:1"], 90_000, { parRatePerMinute: 1_000, turnSeconds: 10 });
    // Nine ship's turns at 60% and 45% of par; p3 worked a station in the space battle and fought no board.
    expect(Object.fromEntries(points)).toEqual({ p1: 300 + 60 * 9, p2: 45 * 9, p3: 120, "bot:1": 0 });
    const won = open(1);
    won.dealt("p1", "s1");
    won.pirateEnded("p1", rules.winPoints);
    expect(won.points(["p1"], 90_000, { parRatePerMinute: 1_000, turnSeconds: 10 }).get("p1")).toBe(0);
  });

  it("shows everyone each pirate's open board in the order dealt, then the raider crew's", () => {
    const m = open(2);
    m.dealt("p1", "s1");
    m.dealt("p2", "s2");
    m.dealt("p3", "s3");
    m.pirateSent(0, 9, 0);
    const p1 = loaded(m, 12);
    const p3 = board(m);
    const wire = m.wire(view({ p1: { state: p1, announced: 5 }, p3: { state: p3, connected: false } }), (id) => `name of ${id}`);
    expect(wire).toEqual([
      { pirateId: "p1", name: "name of p1", side: 0, cells: swordfightBoardString(p1.config, p1.boards[0]!.cells), pending: 17, out: false, points: 0 },
      { pirateId: "p3", name: "name of p3", side: 0, cells: swordfightBoardString(p3.config, p3.boards[0]!.cells), pending: 0, out: false, points: 0 },
      { pirateId: null, name: "", side: 1, cells: swordfightBoardString(m.crew.config, m.crew.boards[0]!.cells), pending: 9, out: false, points: 0 },
      { pirateId: null, name: "", side: 1, cells: swordfightBoardString(m.crew.config, m.crew.boards[1]!.cells), pending: 0, out: false, points: 0 },
    ]);
  });
});
