import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  BATTLE_PERMILLE,
  DEFAULT_BATTLE_CONFIG,
  EMPTY_PLAN,
  InvalidMoveError,
  battleArcCells,
  battleBoardProblems,
  battleCellAt,
  battleIsWin,
  battlePlanIllegalReason,
  chooseRaiderPlan,
  createBattleGame,
  enumerateBattlePlans,
  hashBattleState,
  parseBattleBoard,
  previewBattlePlan,
  reduceBattle,
  replayBattle,
  resolveBattleTurn,
  type BattleConfig,
  type BattleMove,
  type BattlePlan,
  type BattleSegment,
  type BattleShip,
  type BattleState,
  type RaiderSpec,
  type MoveToken,
} from "../src/index.js";

const cfg = DEFAULT_BATTLE_CONFIG;

/** A small open board for rule tests: the captain at the bottom facing north, the raider at the top facing south. */
const OPEN = ["#########", "#.......#", "#...B...#", "#.......#", "#.......#", "#.......#", "#...A...#", "#.......#", "#########"];
const openCfg: BattleConfig = { ...cfg, boards: [OPEN] };

const seg = (move: MoveToken | null, port = false, starboard = false): BattleSegment => ({ move, port, starboard });
const commit = (segments: BattleSegment[], grapple = false): BattleMove => ({ type: "commit", segments, grapple });

/** A plan the captain can afford, chosen by `pick`: moves from the pool, shots from the magazine. */
function planFor(state: BattleState, pick: number): BattlePlan {
  const me = state.ships[0];
  const pool = { ...me.tokens };
  let loaded = me.loaded;
  const segments: BattleSegment[] = [];
  let k = pick;
  const n = k % (state.config.segments + 1);
  k = Math.floor(k / (state.config.segments + 1));
  for (let i = 0; i < n; i++) {
    const choice = k % 4;
    k = Math.floor(k / 4);
    const want: MoveToken | null = choice === 0 ? null : choice === 1 ? "left" : choice === 2 ? "forward" : "right";
    const move = want !== null && pool[want] > 0 ? want : null;
    if (move) pool[move] -= 1;
    const port = k % 2 === 0 && loaded > 0;
    if (port) loaded -= 1;
    k = Math.floor(k / 2);
    const starboard = k % 3 === 0 && loaded > 0;
    if (starboard) loaded -= 1;
    k = Math.floor(k / 3);
    segments.push({ move, port, starboard });
  }
  return { segments, grapple: pick % 2 === 0 };
}

function playRandom(seed: string, picks: readonly number[], config = cfg): { moves: BattleMove[]; state: BattleState } {
  let state = createBattleGame(seed, config);
  const moves: BattleMove[] = [];
  for (const pick of picks) {
    if (state.finished) break;
    const m: BattleMove = { type: "commit", ...planFor(state, pick) };
    moves.push(m);
    state = reduceBattle(state, m);
  }
  return { moves, state };
}

const picksArb = fc.array(fc.nat({ max: 100_000 }), { minLength: 0, maxLength: 24 });

function withShips(base: BattleState, a: Partial<BattleShip>, b: Partial<BattleShip>): BattleState {
  return { ...base, ships: [{ ...base.ships[0], ...a }, { ...base.ships[1], ...b }] };
}

const full = { left: 6, forward: 6, right: 6 };

function expectInvariants(state: BattleState): void {
  const [a, b] = state.ships;
  for (const s of state.ships) {
    const cell = battleCellAt(state.board, s.x, s.y);
    expect(cell, "a ship is always on the board").not.toBeNull();
    expect(cell?.kind, "a ship is never in an asteroid").not.toBe("asteroid");
    expect(s.damage).toBeGreaterThanOrEqual(0);
    expect(s.damage).toBeLessThanOrEqual(BATTLE_PERMILLE);
    expect(s.loaded).toBeGreaterThanOrEqual(0);
    expect(s.loaded).toBeLessThanOrEqual(s.turrets);
    for (const t of ["left", "forward", "right"] as const) {
      expect(s.tokens[t]).toBeGreaterThanOrEqual(0);
      expect(s.tokens[t]).toBeLessThanOrEqual(state.config.tokenCap);
    }
  }
  expect(a.x === b.x && a.y === b.y, "two ships never share a cell").toBe(false);
  expect(state.turn).toBeLessThanOrEqual(state.config.maxTurns);
  expect(state.score).toBeGreaterThanOrEqual(0);
  expect(state.finished).toBe(state.outcome !== null);
  if (state.turn >= state.config.maxTurns) expect(state.finished).toBe(true);
}

describe("battle board", () => {
  it("parses space, asteroids, currents, wells and the two starts", () => {
    const b = parseBattleBoard(cfg.boards[0]!);
    expect(b.width).toBe(16);
    expect(b.height).toBe(16);
    expect(b.start[0]).toEqual({ x: 8, y: 12, heading: 0 });
    expect(b.start[1]).toEqual({ x: 7, y: 3, heading: 2 });
    expect(battleCellAt(b, 7, 1)).toEqual({ kind: "current", heading: 1 });
    expect(battleCellAt(b, 11, 5)).toEqual({ kind: "well" });
    expect(battleCellAt(b, 0, 0)).toEqual({ kind: "asteroid" });
    expect(battleCellAt(b, 99, 0)).toBeNull();
  });

  it("refuses boards without exactly one start each, ragged rows or unknown cells", () => {
    expect(battleBoardProblems(["#####", "#B..#", "#...#", "#..A#", "#####"])).toEqual([]);
    expect(battleBoardProblems(["#####", "#A.A#", "#...#", "#...#", "#####"]).join(" ")).toMatch(/one captain|one raider/);
    expect(battleBoardProblems(["#####", "#B..#", "#...#", "#.A#", "#####"]).join(" ")).toMatch(/same width/);
    expect(battleBoardProblems(["#####", "#B?.#", "#...#", "#..A#", "#####"]).join(" ")).toMatch(/unknown/);
    expect(battleBoardProblems(["#####", "#B..#", "#..##", "#..A#", "#####"]).join(" ")).toMatch(/open space ahead/);
  });

  it("every default board validates and the seed picks among them", () => {
    for (const b of cfg.boards) expect(battleBoardProblems(b)).toEqual([]);
    expect(() => createBattleGame("x")).not.toThrow();
  });
});

describe("battle determinism (ADR 0003)", () => {
  it("same seed and log give the same state and hash, on any config", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const a = playRandom(seed, picks);
        const b = replayBattle(seed, a.moves);
        expect(hashBattleState(b)).toBe(hashBattleState(a.state));
        expect(b).toEqual(a.state);
      }),
      { numRuns: 60 },
    );
  });

  it("the raider's choices are part of the replay: the same seed flies the same plan", () => {
    const a = playRandom("brig-1", [3, 17, 99, 1234]);
    const b = playRandom("brig-1", [3, 17, 99, 1234]);
    expect(a.state.lastTurn?.raiderPlan).toEqual(b.state.lastTurn?.raiderPlan);
    const c = playRandom("brig-2", [3, 17, 99, 1234]);
    expect(c.state.turn).toBeGreaterThan(0);
  });

  it("reduce never mutates its input", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        let state = createBattleGame(seed);
        for (const pick of picks) {
          if (state.finished) break;
          const before = JSON.stringify(state);
          const next = reduceBattle(state, { type: "commit", ...planFor(state, pick) });
          expect(JSON.stringify(state)).toBe(before);
          state = next;
        }
      }),
      { numRuns: 30 },
    );
  });

  it("keeps the invariants after every turn and ends by the turn limit", () => {
    fc.assert(
      fc.property(fc.string(), fc.array(fc.nat({ max: 100_000 }), { minLength: 25, maxLength: 30 }), (seed, picks) => {
        let state = createBattleGame(seed);
        expectInvariants(state);
        for (const pick of picks) {
          if (state.finished) break;
          state = reduceBattle(state, { type: "commit", ...planFor(state, pick) });
          expectInvariants(state);
        }
        expect(state.finished).toBe(true);
      }),
      { numRuns: 40 },
    );
  });
});

describe("battle moves", () => {
  it("forward carries the ship one cell along its heading; a turn carries it forward and swings it", () => {
    const s = createBattleGame("open", openCfg);
    const me = s.ships[0];
    const f = reduceBattle(s, commit([seg("forward")]));
    expect([f.ships[0].x, f.ships[0].y, f.ships[0].heading]).toEqual([me.x, me.y - 1, 0]);
    const l = reduceBattle(s, commit([seg("left")]));
    expect([l.ships[0].x, l.ships[0].y, l.ships[0].heading]).toEqual([me.x, me.y - 1, 3]);
    const r = reduceBattle(s, commit([seg("right")]));
    expect([r.ships[0].x, r.ships[0].y, r.ships[0].heading]).toEqual([me.x, me.y - 1, 1]);
    const lf = reduceBattle(s, commit([seg("left"), seg("forward")]));
    expect([lf.ships[0].x, lf.ships[0].y, lf.ships[0].heading]).toEqual([me.x - 1, me.y - 1, 3]);
  });

  it("spends the tokens it uses, refuses what the pool or magazine cannot cover, and deals supply after the turn", () => {
    const s = createBattleGame("open", openCfg);
    expect(s.ships[0].tokens).toEqual({ left: 1, forward: 2, right: 1 });
    expect(battlePlanIllegalReason(s, { segments: [seg("left"), seg("left")], grapple: false })).toMatch(/left/);
    expect(s.ships[0].loaded).toBe(4);
    expect(battlePlanIllegalReason(s, { segments: [seg("forward", true, true), seg("forward", true, true), seg(null, true)], grapple: false })).toMatch(/turrets/);
    expect(battlePlanIllegalReason(s, { segments: [seg(null), seg(null), seg(null), seg(null), seg(null)], grapple: false })).toMatch(/segments/);
    expect(() => reduceBattle(s, commit([seg("left"), seg("left")]))).toThrow(InvalidMoveError);
    const after = reduceBattle(s, commit([seg("forward"), seg("left", true)]));
    // 2 forward - 1 + 2 dealt = 3 (cap 6); 1 left - 1 + 1; 1 right + 1; 4 loaded - 1 shot + 2, capped at the 4 guns.
    expect(after.ships[0].tokens).toEqual({ left: 1, forward: 3, right: 2 });
    expect(after.ships[0].loaded).toBe(4);
    expect(after.turn).toBe(1);
    expect(after.lastTurn?.shots).toBe(1);
  });

  it("an empty commit lets the turn pass; tokens pile up to the cap", () => {
    let s = createBattleGame("open", openCfg);
    for (let i = 0; i < 6; i++) s = reduceBattle(s, commit([]));
    expect(s.ships[0].tokens.forward).toBe(openCfg.tokenCap);
    expect(s.turn).toBe(6);
  });

  it("an asteroid blocks the move, costs hull and still swings the ship", () => {
    const s = createBattleGame("open", openCfg);
    const t = withShips(s, { x: 1, y: 1, heading: 3, tokens: full }, {});
    const r = reduceBattle(t, commit([seg("left")]));
    expect([r.ships[0].x, r.ships[0].y, r.ships[0].heading]).toEqual([1, 1, 2]);
    expect(r.ships[0].damage).toBe(openCfg.asteroidDamage);
    const ev = r.lastTurn!.events.find((e) => e.type === "move" && e.ship === 0);
    expect(ev && ev.type === "move" ? ev.blocked : null).toBe("asteroid");
  });

  it("two ships bound for the same cell both stop and both take the ram", () => {
    const s = createBattleGame("open", openCfg);
    // Captain at (4,4) facing north, raider at (4,2) facing south: both drive for (4,3).
    const t = withShips(s, { x: 4, y: 4, heading: 0, tokens: full }, { x: 4, y: 2, heading: 2, tokens: full });
    const r = resolveBattleTurn(t.board, t.config, t.ships, [{ segments: [seg("forward")], grapple: false }, { segments: [seg("forward")], grapple: false }]);
    expect([r.ships[0].x, r.ships[0].y]).toEqual([4, 4]);
    expect([r.ships[1].x, r.ships[1].y]).toEqual([4, 2]);
    expect(r.ships[0].damage).toBe(openCfg.ramDamage);
    expect(r.ships[1].damage).toBe(openCfg.ramDamage);
  });

  it("flying into a ship that holds still rams it; a ship may follow one that flies away", () => {
    const s = createBattleGame("open", openCfg);
    const t = withShips(s, { x: 4, y: 4, heading: 0, tokens: full }, { x: 4, y: 3, heading: 0, tokens: full });
    const still = resolveBattleTurn(t.board, t.config, t.ships, [{ segments: [seg("forward")], grapple: false }, EMPTY_PLAN]);
    expect([still.ships[0].x, still.ships[0].y]).toEqual([4, 4]);
    expect(still.ships[0].damage).toBe(openCfg.ramDamage);
    expect(still.ships[1].damage).toBe(openCfg.ramDamage);
    const away = resolveBattleTurn(t.board, t.config, t.ships, [{ segments: [seg("forward")], grapple: false }, { segments: [seg("forward")], grapple: false }]);
    expect([away.ships[0].x, away.ships[0].y]).toEqual([4, 3]);
    expect([away.ships[1].x, away.ships[1].y]).toEqual([4, 2]);
    expect(away.ships[0].damage).toBe(0);
  });

  it("a current carries a ship one cell each segment it sits on it; a well spins it clockwise", () => {
    const windy = ["#########", "#.......#", "#...B...#", "#.......#", "#...>...#", "#..@....#", "#...A...#", "#.......#", "#########"];
    const s = createBattleGame("w", { ...cfg, boards: [windy], segments: 2 });
    const blown = reduceBattle(s, commit([seg("forward"), seg("forward")]));
    // Forward to (4,5), forward onto the current at (4,4), then blown east to (5,4).
    expect([blown.ships[0].x, blown.ships[0].y, blown.ships[0].heading]).toEqual([5, 4, 0]);
    const t = withShips(s, { x: 3, y: 6, heading: 0, tokens: full }, {});
    const spun = reduceBattle(t, commit([seg("forward")]));
    // Onto the well at (3,5): spun once on arrival and once more sitting there through the second segment.
    expect([spun.ships[0].x, spun.ships[0].y, spun.ships[0].heading]).toEqual([3, 5, 2]);
    expect(spun.lastTurn!.events.filter((e) => e.type === "spin" && e.ship === 0)).toHaveLength(2);
  });

  it("a shot reaches `turretRange` cells to the side and stops at an asteroid", () => {
    const b = parseBattleBoard(["#########", "#.......#", "#...B...#", "#.......#", "#.#.....#", "#.......#", "#...A...#", "#.......#", "#########"]);
    expect(battleArcCells(b, { x: 4, y: 6, heading: 0 }, "port", 3)).toEqual([
      { x: 3, y: 6 },
      { x: 2, y: 6 },
      { x: 1, y: 6 },
    ]);
    expect(battleArcCells(b, { x: 4, y: 4, heading: 0 }, "port", 3)).toEqual([{ x: 3, y: 4 }]);
    expect(battleArcCells(b, { x: 4, y: 6, heading: 0 }, "starboard", 2)).toEqual([
      { x: 5, y: 6 },
      { x: 6, y: 6 },
    ]);
  });

  it("a broadside that lines up hits, spends a load, scores and builds the combo", () => {
    const s = createBattleGame("open", openCfg);
    // Raider two cells to starboard of the captain, out of its own tokens so it holds still.
    const t = withShips(s, { x: 3, y: 5, heading: 0, loaded: 2 }, { x: 5, y: 5, heading: 2, tokens: { left: 0, forward: 0, right: 0 }, loaded: 0 });
    const r = reduceBattle(t, commit([seg(null, false, true)]));
    expect(r.ships[1].damage).toBe(openCfg.shotDamage);
    expect(r.ships[0].loaded).toBe(2 - 1 + openCfg.supply!.turrets);
    expect(r.hits).toBe(1);
    expect(r.score).toBe(openCfg.hitPoints);
    expect(r.combo).toBe(1);
    const miss = reduceBattle(t, commit([seg(null, true, false)]));
    expect(miss.ships[1].damage).toBe(0);
    expect(miss.combo).toBe(0);
  });

  it("a crippled raider ends the fight as a win with the turn bonus; a crippled captain loses", () => {
    const s = createBattleGame("open", openCfg);
    const t = withShips(s, { x: 3, y: 5, heading: 0, loaded: 2 }, { x: 5, y: 5, heading: 2, damage: BATTLE_PERMILLE - 1, tokens: { left: 0, forward: 0, right: 0 }, loaded: 0 });
    const r = reduceBattle(t, commit([seg(null, false, true)]));
    expect(r.finished).toBe(true);
    expect(r.outcome).toBe("crippled");
    expect(battleIsWin(r.outcome)).toBe(true);
    expect(r.score).toBe(openCfg.hitPoints + openCfg.winPoints + openCfg.turnBonus * (openCfg.maxTurns - 1));
    expect(() => reduceBattle(r, commit([]))).toThrow(InvalidMoveError);
    const u = withShips(s, { x: 3, y: 5, heading: 0, damage: BATTLE_PERMILLE - 1 }, { x: 5, y: 5, heading: 2, loaded: 4, tokens: { left: 0, forward: 0, right: 0 } });
    // The raider's plan is its own; give it a sure shot by resolving directly.
    const lost = resolveBattleTurn(u.board, u.config, u.ships, [EMPTY_PLAN, { segments: [seg(null, false, true)], grapple: false }]);
    expect(lost.outcome).toBe("crippled_by");
  });

  it("grappling boards an adjacent raider only once it is damaged enough, and only when asked", () => {
    const s = createBattleGame("open", openCfg);
    const base = withShips(s, { x: 4, y: 5, heading: 0 }, { x: 4, y: 4, heading: 2, damage: openCfg.grappleDamage, tokens: { left: 0, forward: 0, right: 0 } });
    expect(resolveBattleTurn(base.board, base.config, base.ships, [{ segments: [], grapple: true }, EMPTY_PLAN]).outcome).toBe("boarded");
    expect(resolveBattleTurn(base.board, base.config, base.ships, [{ segments: [], grapple: false }, EMPTY_PLAN]).outcome).toBeNull();
    const sound = withShips(base, {}, { damage: openCfg.grappleDamage - 1 });
    expect(resolveBattleTurn(sound.board, sound.config, sound.ships, [{ segments: [], grapple: true }, EMPTY_PLAN]).outcome).toBeNull();
    const far = withShips(base, { x: 4, y: 6 }, {});
    expect(resolveBattleTurn(far.board, far.config, far.ships, [{ segments: [], grapple: true }, EMPTY_PLAN]).outcome).toBeNull();
    // Both could board: the sounder hull wins.
    const both = withShips(base, { damage: openCfg.grappleDamage + 10 }, {});
    expect(resolveBattleTurn(both.board, both.config, both.ships, [{ segments: [], grapple: true }, { segments: [], grapple: true }]).outcome).toBe("boarded_by");
  });

  it("the fight breaks off at the turn limit and the captain may disengage at any time", () => {
    let s = createBattleGame("open", { ...openCfg, maxTurns: 3 });
    s = reduceBattle(s, commit([]));
    s = reduceBattle(s, commit([]));
    expect(s.finished).toBe(false);
    s = reduceBattle(s, commit([]));
    expect(s.outcome).toBe("broke_off");
    const d = reduceBattle(createBattleGame("open", openCfg), { type: "end" });
    expect(d.outcome).toBe("disengaged");
    expect(d.finished).toBe(true);
  });

  it("previews the plan's path against a raider that holds still", () => {
    const s = createBattleGame("open", openCfg);
    const path = previewBattlePlan(s, [seg("forward"), seg("right")]);
    expect(path.map((p) => [p.x, p.y, p.heading])).toEqual([
      [4, 5, 0],
      [4, 4, 1],
      [4, 4, 1],
      [4, 4, 1],
    ]);
  });
});

describe("battle supply aboard", () => {
  const aboard: BattleConfig = { ...openCfg, supply: null };

  it("takes the ship's word for tokens, loads and hull, and refuses supply in practice", () => {
    const s = createBattleGame("aboard", aboard);
    expect(s.ships[0].tokens).toEqual({ left: 0, forward: 0, right: 0 });
    const fed = reduceBattle(s, { type: "supply", left: 1, forward: 3, right: 1, turrets: 3, hull: 120 });
    expect(fed.ships[0].tokens).toEqual({ left: 1, forward: 3, right: 1 });
    expect(fed.ships[0].loaded).toBe(3);
    expect(fed.ships[0].damage).toBe(120);
    const after = reduceBattle(fed, commit([seg("forward", true)]));
    // No practice deal aboard: what is left is what the ship brought.
    expect(after.ships[0].tokens.forward).toBe(2);
    expect(after.ships[0].loaded).toBe(2);
    expect(() => reduceBattle(createBattleGame("p", openCfg), { type: "supply", left: 1, forward: 1, right: 1, turrets: 1, hull: 0 })).toThrow(InvalidMoveError);
    expect(() => reduceBattle(s, { type: "supply", left: -1, forward: 1, right: 1, turrets: 1, hull: 0 })).toThrow(InvalidMoveError);
  });

  it("a hull the ship reports as wrecked ends the fight", () => {
    const s = createBattleGame("aboard", aboard);
    const sunk = reduceBattle(s, { type: "supply", left: 0, forward: 0, right: 0, turrets: 0, hull: BATTLE_PERMILLE });
    expect(sunk.outcome).toBe("crippled_by");
  });
});

describe("the raider", () => {
  it("enumerates every plan its pool allows, each once", () => {
    const plans = enumerateBattlePlans({ left: 1, forward: 1, right: 0 }, 2);
    const keys = plans.map((p) => p.map((m) => m ?? "-").join(","));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("");
    expect(keys).toContain("forward");
    expect(keys).toContain("left,forward");
    expect(keys).toContain("-,left");
    expect(keys).not.toContain("forward,forward");
    expect(keys).not.toContain("forward,-");
    expect(enumerateBattlePlans({ left: 2, forward: 2, right: 2 }, 4).length).toBeGreaterThan(100);
  });

  it("never plans more than its tokens or loads allow, on any state", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        let state = createBattleGame(seed);
        for (const pick of picks) {
          if (state.finished) break;
          const { plan } = chooseRaiderPlan(state, state.rng);
          const need = { left: 0, forward: 0, right: 0 };
          let shots = 0;
          for (const s of plan.segments) {
            if (s.move) need[s.move] += 1;
            shots += (s.port ? 1 : 0) + (s.starboard ? 1 : 0);
          }
          const me = state.ships[1];
          for (const t of ["left", "forward", "right"] as const) expect(need[t]).toBeLessThanOrEqual(me.tokens[t]);
          expect(shots).toBeLessThanOrEqual(me.loaded);
          expect(plan.segments.length).toBeLessThanOrEqual(state.config.segments);
          state = reduceBattle(state, { type: "commit", ...planFor(state, pick) });
        }
      }),
      { numRuns: 25 },
    );
  });

  it("lines up a broadside when one is there to take", () => {
    const s = createBattleGame("open", openCfg);
    // Captain parked broadside-on two cells east of where the raider lands after one move forward.
    const t = withShips(s, { x: 6, y: 3, heading: 0, tokens: { left: 0, forward: 0, right: 0 }, loaded: 0 }, { x: 4, y: 2, heading: 2, loaded: 2, tokens: { left: 1, forward: 2, right: 1 } });
    const sharp: BattleState = { ...t, config: { ...t.config, raider: { ...t.config.raider, accuracy: 100, aggression: 100 } } };
    const { plan } = chooseRaiderPlan(sharp, sharp.rng);
    const r = resolveBattleTurn(sharp.board, sharp.config, sharp.ships, [EMPTY_PLAN, plan]);
    expect(r.events.some((e) => e.type === "shot" && e.ship === 1 && e.hit)).toBe(true);
  });

  /** A plain captain: flies straight and fires both sides whenever a gun is loaded, every turn. */
  function plainCaptain(state: BattleState): BattlePlan {
    const me = state.ships[0];
    const segments: BattleSegment[] = [];
    let loaded = me.loaded;
    let fwd = me.tokens.forward;
    let left = me.tokens.left;
    for (let i = 0; i < state.config.segments; i++) {
      const move: MoveToken | null = fwd > 0 ? "forward" : left > 0 ? "left" : null;
      if (move === "forward") fwd -= 1;
      if (move === "left") left -= 1;
      const port = loaded > 0;
      if (port) loaded -= 1;
      const starboard = loaded > 0;
      if (starboard) loaded -= 1;
      segments.push({ move, port, starboard });
    }
    return { segments, grapple: true };
  }

  function fightsAgainst(raider: RaiderSpec, seeds: number): { taken: number; turns: number; losses: number } {
    let taken = 0;
    let turns = 0;
    let losses = 0;
    for (let i = 0; i < seeds; i++) {
      let s = createBattleGame(`tier-${i}`, { ...cfg, raider });
      while (!s.finished) s = reduceBattle(s, { type: "commit", ...plainCaptain(s) });
      taken += s.hitsTaken;
      turns += s.turn;
      if (s.outcome === "boarded_by" || s.outcome === "crippled_by") losses += 1;
    }
    return { taken, turns, losses };
  }

  it("a harder tier beats a plain captain sooner, and no tier is a pushover", () => {
    const junker: RaiderSpec = { turrets: 4, tokensPerTurn: 2, reloadPerTurn: 1, accuracy: 50, aggression: 40, startDamage: 0 };
    const corsair: RaiderSpec = { turrets: 4, tokensPerTurn: 4, reloadPerTurn: 2, accuracy: 80, aggression: 80, startDamage: 0 };
    const easy = fightsAgainst(junker, 12);
    const hard = fightsAgainst(corsair, 12);
    expect(hard.turns).toBeLessThan(easy.turns);
    expect(hard.losses).toBeGreaterThanOrEqual(easy.losses);
    expect(hard.losses).toBeGreaterThan(0);
    expect(easy.taken).toBeGreaterThan(0);
  });
});

describe("space battle scoring", () => {
  it("hits score as the margin, the tier scales every turn, and the score never drops below zero", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 8 }), picksArb, (seed, picks) => {
        let state = createBattleGame(seed, cfg);
        let sum = 0;
        for (const pick of picks) {
          if (state.finished) break;
          const before = state.score;
          state = reduceBattle(state, { type: "commit", ...planFor(state, pick) });
          const r = state.lastTurn!;
          expect(r.points).toBe(state.score - before);
          expect(state.score).toBeGreaterThanOrEqual(0);
          sum += r.points;
        }
        expect(state.score).toBe(sum);
      }),
      { numRuns: 40 },
    );
  });

  it("a harder raider's factor scales the same fight's points", () => {
    const free: BattleConfig = { ...cfg, hitTakenPoints: 0 };
    const double: BattleConfig = { ...free, scorePercent: 200 };
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 8 }), picksArb, (seed, picks) => {
        const a = playRandom(seed, picks, free);
        let b = createBattleGame(seed, double);
        for (const m of a.moves) b = reduceBattle(b, m);
        expect(b.score).toBe(2 * a.state.score);
      }),
      { numRuns: 30 },
    );
  });
});

