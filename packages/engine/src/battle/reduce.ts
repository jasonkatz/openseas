import { InvalidMoveError } from "../errors.js";
import { Hasher } from "../hash.js";
import { nextInt, seedFromString } from "../prng.js";
import { chooseBrigandPlan } from "./ai.js";
import {
  DEFAULT_BATTLE_CONFIG,
  EMPTY_PLAN,
  HEADING_DX,
  HEADING_DY,
  MOVE_TOKENS,
  WIN_OUTCOMES,
  type BattleCell,
  type BattleConfig,
  type BattleEvent,
  type BattleMove,
  type BattleOutcome,
  type BattleShip,
  type BattleState,
  type BattleTurnReport,
  type Heading,
  type MoveToken,
  type ParsedBoard,
  type BattlePlan,
  type Pose,
  type BattleSegment,
  type ShipIndex,
  type Side,
  type SupplySpec,
} from "./types.js";

export const PERMILLE = 1000;

const int = (n: unknown, lo: number, hi: number): boolean => typeof n === "number" && Number.isInteger(n) && n >= lo && n <= hi;

// ---- the board

const WIND_CHARS: Record<string, Heading> = { "^": 0, ">": 1, v: 2, "<": 3 };

export function boardProblems(rows: readonly string[]): string[] {
  const problems: string[] = [];
  if (rows.length < 5 || rows.length > 32) problems.push("a board has 5 to 32 rows");
  const width = rows[0]?.length ?? 0;
  if (width < 5 || width > 32) problems.push("a board is 5 to 32 cells wide");
  let a = 0;
  let b = 0;
  for (const row of rows) {
    if (row.length !== width) problems.push("every row of a board is the same width");
    for (const ch of row) {
      if (ch === "A") a += 1;
      else if (ch === "B") b += 1;
      else if (!(ch in WIND_CHARS) && ch !== "." && ch !== "#" && ch !== "@") problems.push(`unknown board cell "${ch}"`);
    }
  }
  if (a !== 1) problems.push("a board has exactly one captain's start (A)");
  if (b !== 1) problems.push("a board has exactly one brigand's start (B)");
  // Each ship starts with open water ahead: the captain faces north, the brigand south.
  for (let y = 0; y < rows.length; y++) {
    const ax = rows[y]!.indexOf("A");
    if (ax >= 0 && (rows[y - 1]?.[ax] ?? "#") !== ".") problems.push("the captain's start has no open water ahead (north)");
    const bx = rows[y]!.indexOf("B");
    if (bx >= 0 && (rows[y + 1]?.[bx] ?? "#") !== ".") problems.push("the brigand's start has no open water ahead (south)");
  }
  return problems;
}

export function parseBoard(rows: readonly string[]): ParsedBoard {
  const problems = boardProblems(rows);
  if (problems.length) throw new Error(`invalid battle board: ${problems.join("; ")}`);
  const width = rows[0]!.length;
  const height = rows.length;
  const cells: BattleCell[] = [];
  let a: Pose = { x: 0, y: 0, heading: 0 };
  let b: Pose = { x: 0, y: 0, heading: 2 };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ch = rows[y]![x]!;
      if (ch === "#") cells.push({ kind: "rock" });
      else if (ch === "@") cells.push({ kind: "eddy" });
      else if (ch in WIND_CHARS) cells.push({ kind: "wind", heading: WIND_CHARS[ch]! });
      else {
        cells.push({ kind: "water" });
        if (ch === "A") a = { x, y, heading: 0 };
        if (ch === "B") b = { x, y, heading: 2 };
      }
    }
  }
  return { width, height, cells, start: [a, b] };
}

export const inBounds = (board: ParsedBoard, x: number, y: number): boolean => x >= 0 && y >= 0 && x < board.width && y < board.height;
export const cellAt = (board: ParsedBoard, x: number, y: number): BattleCell | null => (inBounds(board, x, y) ? board.cells[y * board.width + x]! : null);
export const isRock = (board: ParsedBoard, x: number, y: number): boolean => cellAt(board, x, y)?.kind === "rock";

export const turnLeft = (h: Heading): Heading => ((h + 3) % 4) as Heading;
export const turnRight = (h: Heading): Heading => ((h + 1) % 4) as Heading;
export const headingAfter = (h: Heading, token: MoveToken): Heading => (token === "left" ? turnLeft(h) : token === "right" ? turnRight(h) : h);
export const sideHeading = (h: Heading, side: Side): Heading => (side === "port" ? turnLeft(h) : turnRight(h));
export const forwardOf = (p: Pose): { x: number; y: number } => ({ x: p.x + HEADING_DX[p.heading]!, y: p.y + HEADING_DY[p.heading]! });
export const manhattan = (a: Pose, b: Pose): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** The cells a shot from `pose` to `side` crosses: outward up to the range, stopping before a rock or the edge. */
export function arcCells(board: ParsedBoard, pose: Pose, side: Side, range: number): Array<{ x: number; y: number }> {
  const h = sideHeading(pose.heading, side);
  const out: Array<{ x: number; y: number }> = [];
  let x = pose.x;
  let y = pose.y;
  for (let i = 0; i < range; i++) {
    x += HEADING_DX[h]!;
    y += HEADING_DY[h]!;
    if (!inBounds(board, x, y) || isRock(board, x, y)) break;
    out.push({ x, y });
  }
  return out;
}

// ---- config

export function validateConfig(cfg: BattleConfig): void {
  const b = cfg.brigand;
  const ok =
    Array.isArray(cfg.boards) &&
    cfg.boards.length >= 1 &&
    cfg.boards.length <= 32 &&
    cfg.boards.every((rows) => Array.isArray(rows) && boardProblems(rows).length === 0) &&
    int(cfg.segments, 1, 8) &&
    int(cfg.turnSeconds, 3, 600) &&
    int(cfg.tokenCap, 1, 32) &&
    int(cfg.cannonRange, 1, 16) &&
    int(cfg.shotDamage, 0, PERMILLE) &&
    int(cfg.rockDamage, 0, PERMILLE) &&
    int(cfg.ramDamage, 0, PERMILLE) &&
    int(cfg.grappleDamage, 0, PERMILLE) &&
    int(cfg.maxTurns, 1, 200) &&
    int(cfg.cannons, 0, 32) &&
    int(cfg.startLoaded, 0, cfg.cannons) &&
    int(cfg.startDamage, 0, PERMILLE - 1) &&
    (cfg.supply === null || validSupply(cfg.supply)) &&
    typeof b === "object" &&
    b !== null &&
    int(b.cannons, 0, 32) &&
    int(b.tokensPerTurn, 0, 32) &&
    int(b.reloadPerTurn, 0, 32) &&
    int(b.accuracy, 0, 100) &&
    int(b.aggression, 0, 100) &&
    int(b.startDamage, 0, PERMILLE - 1) &&
    int(cfg.hitPoints, 0, 1_000_000) &&
    int(cfg.winPoints, 0, 1_000_000) &&
    int(cfg.turnBonus, 0, 1_000_000) &&
    int(cfg.maxMoves, 1, 1_000_000);
  if (!ok) throw new Error("invalid battle config");
}

const validSupply = (s: SupplySpec): boolean => typeof s === "object" && s !== null && int(s.left, 0, 32) && int(s.forward, 0, 32) && int(s.right, 0, 32) && int(s.cannons, 0, 32);

// ---- lifecycle

const zeroTokens = (): Record<MoveToken, number> => ({ left: 0, forward: 0, right: 0 });

/** Add a turn's deal to a ship's pool and magazine, within the caps. */
function dealSupply(cfg: BattleConfig, ship: BattleShip, s: SupplySpec): BattleShip {
  return {
    ...ship,
    tokens: {
      left: Math.min(cfg.tokenCap, ship.tokens.left + s.left),
      forward: Math.min(cfg.tokenCap, ship.tokens.forward + s.forward),
      right: Math.min(cfg.tokenCap, ship.tokens.right + s.right),
    },
    loaded: Math.min(ship.cannons, ship.loaded + s.cannons),
  };
}

/** What the brigand is dealt each turn: its forward tokens, and half as many turns each way. */
export function brigandSupply(cfg: BattleConfig): SupplySpec {
  const b = cfg.brigand;
  const turns = Math.ceil(b.tokensPerTurn / 2);
  return { left: turns, forward: b.tokensPerTurn, right: turns, cannons: b.reloadPerTurn };
}

export function createBattleGame(seed: string, config: BattleConfig = DEFAULT_BATTLE_CONFIG): BattleState {
  validateConfig(config);
  let rng = seedFromString(`battle:${seed}`);
  const pick = nextInt(rng, config.boards.length);
  rng = pick.state;
  const board = parseBoard(config.boards[pick.value]!);
  let player: BattleShip = { ...board.start[0], damage: config.startDamage, loaded: config.startLoaded, cannons: config.cannons, tokens: zeroTokens() };
  let brigand: BattleShip = {
    ...board.start[1],
    damage: config.brigand.startDamage,
    loaded: Math.min(config.brigand.cannons, config.startLoaded),
    cannons: config.brigand.cannons,
    tokens: zeroTokens(),
  };
  if (config.supply) player = dealSupply(config, player, config.supply);
  brigand = dealSupply(config, brigand, brigandSupply(config));
  return {
    config,
    board,
    boardIndex: pick.value,
    ships: [player, brigand],
    turn: 0,
    rng,
    score: 0,
    hits: 0,
    hitsTaken: 0,
    combo: 0,
    bestCombo: 0,
    moveCount: 0,
    lastTurn: null,
    finished: false,
    outcome: null,
  };
}

export function replayBattle(seed: string, moves: readonly BattleMove[], config: BattleConfig = DEFAULT_BATTLE_CONFIG): BattleState {
  let s = createBattleGame(seed, config);
  for (const m of moves) s = reduceBattle(s, m);
  return s;
}

// ---- moves

/** Why the captain cannot sail this plan right now, or null when the engine would take it. */
export function planIllegalReason(state: BattleState, plan: BattlePlan): string | null {
  if (state.finished) return "finished";
  if (!Array.isArray(plan.segments) || plan.segments.length > state.config.segments) return "too many segments";
  if (typeof plan.grapple !== "boolean") return "bad grapple flag";
  const need = zeroTokens();
  let shots = 0;
  for (const seg of plan.segments) {
    if (typeof seg !== "object" || seg === null) return "bad segment";
    const m: unknown = seg.move;
    if (m !== null && !(MOVE_TOKENS as readonly unknown[]).includes(m)) return "bad move";
    if (typeof seg.port !== "boolean" || typeof seg.starboard !== "boolean") return "bad fire flags";
    if (m !== null) need[m as MoveToken] += 1;
    if (seg.port) shots += 1;
    if (seg.starboard) shots += 1;
  }
  const me = state.ships[0];
  for (const t of MOVE_TOKENS) if (need[t] > me.tokens[t]) return `not enough ${t} tokens`;
  if (shots > me.loaded) return "not enough loaded cannons";
  return null;
}

export function reduceBattle(state: BattleState, move: BattleMove): BattleState {
  switch (move.type) {
    case "commit":
      return commit(state, { segments: move.segments, grapple: move.grapple }, move);
    case "supply":
      return supply(state, move);
    case "end":
      return disengage(state, move);
    default: {
      const never: never = move;
      throw new InvalidMoveError("unknown move", never);
    }
  }
}

function supply(state: BattleState, move: Extract<BattleMove, { type: "supply" }>): BattleState {
  if (state.finished) throw new InvalidMoveError("finished", move);
  if (state.config.supply !== null) throw new InvalidMoveError("practice supplies itself", move);
  if (!int(move.left, 0, 32) || !int(move.forward, 0, 32) || !int(move.right, 0, 32) || !int(move.cannons, 0, 32) || !int(move.hull, 0, PERMILLE)) {
    throw new InvalidMoveError("bad supply", move);
  }
  const me = state.ships[0];
  const dealt = dealSupply(state.config, { ...me, loaded: 0 }, { left: move.left, forward: move.forward, right: move.right, cannons: move.cannons });
  const player: BattleShip = { ...dealt, damage: Math.min(PERMILLE, move.hull) };
  let s: BattleState = { ...state, ships: [player, state.ships[1]], moveCount: state.moveCount + 1 };
  if (player.damage >= PERMILLE) s = end(s, state.ships[1].damage >= PERMILLE ? "broke_off" : "crippled_by", []);
  return s;
}

function disengage(state: BattleState, move: BattleMove): BattleState {
  if (state.finished) throw new InvalidMoveError("finished", move);
  return end({ ...state, moveCount: state.moveCount + 1 }, "disengaged", []);
}

function commit(state: BattleState, plan: BattlePlan, move: BattleMove): BattleState {
  const why = planIllegalReason(state, plan);
  if (why) throw new InvalidMoveError(why, move);
  const chosen = chooseBrigandPlan(state, state.rng);
  const r = resolveTurn(state.board, state.config, state.ships, [plan, chosen.plan]);
  const events: BattleEvent[] = [...r.events];
  const turn = state.turn + 1;
  let hits = 0;
  let hitsTaken = 0;
  let shots = 0;
  for (const e of r.events) {
    if (e.type !== "shot") continue;
    if (e.ship === 0) {
      shots += 1;
      if (e.hit) hits += 1;
    } else if (e.hit) hitsTaken += 1;
  }
  let outcome = r.outcome;
  if (outcome === null && turn >= state.config.maxTurns) outcome = "broke_off";
  const combo = hits > 0 ? state.combo + 1 : 0;
  let points = hits * state.config.hitPoints;
  if (outcome !== null && WIN_OUTCOMES.includes(outcome)) points += state.config.winPoints + state.config.turnBonus * Math.max(0, state.config.maxTurns - turn);
  let ships: readonly [BattleShip, BattleShip] = r.ships;
  if (outcome === null) {
    const player = state.config.supply ? dealSupply(state.config, ships[0], state.config.supply) : ships[0];
    ships = [player, dealSupply(state.config, ships[1], brigandSupply(state.config))];
  } else events.push({ seg: state.config.segments, type: "ended", outcome });
  const report: BattleTurnReport = {
    turn,
    plan,
    brigandPlan: chosen.plan,
    events,
    hits,
    hitsTaken,
    shots,
    damageTaken: ships[0].damage - state.ships[0].damage,
    points,
  };
  return {
    ...state,
    ships,
    turn,
    rng: chosen.rng,
    score: state.score + points,
    hits: state.hits + hits,
    hitsTaken: state.hitsTaken + hitsTaken,
    combo,
    bestCombo: Math.max(state.bestCombo, combo),
    moveCount: state.moveCount + 1,
    lastTurn: report,
    finished: outcome !== null,
    outcome,
  };
}

function end(state: BattleState, outcome: BattleOutcome, events: readonly BattleEvent[]): BattleState {
  const report: BattleTurnReport = {
    turn: state.turn,
    plan: EMPTY_PLAN,
    brigandPlan: EMPTY_PLAN,
    events: [...events, { seg: 0, type: "ended", outcome }],
    hits: 0,
    hitsTaken: 0,
    shots: 0,
    damageTaken: 0,
    points: 0,
  };
  return { ...state, finished: true, outcome, lastTurn: report };
}

// ---- resolution: pure in the board and the ships, no randomness

export interface TurnResolution {
  readonly ships: readonly [BattleShip, BattleShip];
  readonly events: readonly BattleEvent[];
  /** Both ships' poses after each segment's moves and winds, before the guns. */
  readonly trace: ReadonlyArray<readonly [Pose, Pose]>;
  readonly outcome: BattleOutcome | null;
}

const pose = (s: BattleShip): Pose => ({ x: s.x, y: s.y, heading: s.heading });
const hurt = (s: BattleShip, damage: number): BattleShip => ({ ...s, damage: Math.min(PERMILLE, s.damage + damage) });

/** Sail both plans through every segment of a turn. Ends early at a grapple or a crippled hull. */
export function resolveTurn(board: ParsedBoard, cfg: BattleConfig, start: readonly [BattleShip, BattleShip], plans: readonly [BattlePlan, BattlePlan]): TurnResolution {
  let ships: [BattleShip, BattleShip] = [start[0], start[1]];
  const events: BattleEvent[] = [];
  const trace: Array<readonly [Pose, Pose]> = [];
  for (let seg = 0; seg < cfg.segments; seg++) {
    const segs: [BattleSegment | undefined, BattleSegment | undefined] = [plans[0].segments[seg], plans[1].segments[seg]];
    ships = moveShips(board, cfg, ships, [segs[0]?.move ?? null, segs[1]?.move ?? null], seg, events);
    ships = blow(board, cfg, ships, seg, events);
    trace.push([pose(ships[0]), pose(ships[1])]);
    ships = fire(board, cfg, ships, segs, seg, events);
    const outcome = settle(cfg, ships, [plans[0].grapple, plans[1].grapple], seg, events);
    if (outcome) return { ships, events, trace, outcome };
  }
  return { ships, events, trace, outcome: null };
}

function moveShips(board: ParsedBoard, cfg: BattleConfig, ships: [BattleShip, BattleShip], tokens: [MoveToken | null, MoveToken | null], seg: number, events: BattleEvent[]): [BattleShip, BattleShip] {
  const from: [Pose, Pose] = [pose(ships[0]), pose(ships[1])];
  const target: [{ x: number; y: number }, { x: number; y: number }] = [from[0], from[1]];
  const blocked: ["rock" | "edge" | "ship" | null, "rock" | "edge" | "ship" | null] = [null, null];
  const damage: [number, number] = [0, 0];
  for (const i of [0, 1] as const) {
    if (tokens[i] === null) continue;
    const t = forwardOf(from[i]);
    if (!inBounds(board, t.x, t.y)) blocked[i] = "edge";
    else if (isRock(board, t.x, t.y)) {
      blocked[i] = "rock";
      damage[i] += cfg.rockDamage;
    } else target[i] = t;
  }
  const moving = [tokens[0] !== null && blocked[0] === null, tokens[1] !== null && blocked[1] === null];
  const same = (a: { x: number; y: number }, b: { x: number; y: number }): boolean => a.x === b.x && a.y === b.y;
  let ram = false;
  if (moving[0] && moving[1] && same(target[0], target[1])) ram = true;
  else if (moving[0] && moving[1] && same(target[0], from[1]) && same(target[1], from[0])) ram = true;
  else if (moving[0] && !moving[1] && same(target[0], from[1])) ram = true;
  else if (moving[1] && !moving[0] && same(target[1], from[0])) ram = true;
  if (ram) {
    for (const i of [0, 1] as const) {
      if (moving[i]) {
        blocked[i] = "ship";
        target[i] = from[i];
      }
      damage[i] += cfg.ramDamage;
    }
  }
  const out: [BattleShip, BattleShip] = [ships[0], ships[1]];
  for (const i of [0, 1] as const) {
    const token = tokens[i];
    if (token === null) {
      // Rammed while holding still.
      out[i] = hurt(ships[i], damage[i]);
      continue;
    }
    const heading = headingAfter(from[i].heading, token);
    const to: Pose = { x: target[i].x, y: target[i].y, heading };
    // A token is spent when it is sailed, blocked or not.
    const pool = { ...ships[i].tokens, [token]: Math.max(0, ships[i].tokens[token] - 1) };
    out[i] = hurt({ ...ships[i], x: to.x, y: to.y, heading, tokens: pool }, damage[i]);
    events.push({ seg, type: "move", ship: i, token, from: from[i], to, blocked: blocked[i], damage: damage[i] });
  }
  return out;
}

/** Winds carry, eddies spin. The captain's ship is blown first; a ship never blows into the other. */
function blow(board: ParsedBoard, cfg: BattleConfig, ships: [BattleShip, BattleShip], seg: number, events: BattleEvent[]): [BattleShip, BattleShip] {
  const out: [BattleShip, BattleShip] = [ships[0], ships[1]];
  for (const i of [0, 1] as const) {
    const me = out[i];
    const other = out[i === 0 ? 1 : 0];
    const cell = cellAt(board, me.x, me.y);
    if (!cell) continue;
    if (cell.kind === "eddy") {
      const to: Pose = { x: me.x, y: me.y, heading: turnRight(me.heading) };
      out[i] = { ...me, heading: to.heading };
      events.push({ seg, type: "spin", ship: i, from: pose(me), to });
    } else if (cell.kind === "wind") {
      const x = me.x + HEADING_DX[cell.heading]!;
      const y = me.y + HEADING_DY[cell.heading]!;
      let blocked: "rock" | "edge" | "ship" | null = null;
      let damage = 0;
      if (!inBounds(board, x, y)) blocked = "edge";
      else if (isRock(board, x, y)) {
        blocked = "rock";
        damage = cfg.rockDamage;
      } else if (other.x === x && other.y === y) blocked = "ship";
      const to: Pose = blocked ? pose(me) : { x, y, heading: me.heading };
      out[i] = hurt({ ...me, x: to.x, y: to.y }, damage);
      events.push({ seg, type: "push", ship: i, from: pose(me), to, blocked, damage });
    }
  }
  return out;
}

function fire(board: ParsedBoard, cfg: BattleConfig, ships: [BattleShip, BattleShip], segs: [BattleSegment | undefined, BattleSegment | undefined], seg: number, events: BattleEvent[]): [BattleShip, BattleShip] {
  const out: [BattleShip, BattleShip] = [ships[0], ships[1]];
  const taken: [number, number] = [0, 0];
  for (const i of [0, 1] as const) {
    const s = segs[i];
    if (!s) continue;
    const other = ships[i === 0 ? 1 : 0];
    for (const side of ["port", "starboard"] as const) {
      if (!s[side] || out[i].loaded <= 0) continue;
      out[i] = { ...out[i], loaded: out[i].loaded - 1 };
      const cells = arcCells(board, pose(ships[i]), side, cfg.cannonRange);
      const hitAt = cells.findIndex((c) => c.x === other.x && c.y === other.y);
      const hit = hitAt >= 0;
      if (hit) taken[i === 0 ? 1 : 0] += cfg.shotDamage;
      events.push({ seg, type: "shot", ship: i, side, cells: hit ? cells.slice(0, hitAt + 1) : cells, hit, damage: hit ? cfg.shotDamage : 0 });
    }
  }
  return [hurt(out[0], taken[0]), hurt(out[1], taken[1])];
}

/** Crippled hulls end the fight; otherwise a grapple from a ship that wants one and can take the other. */
function settle(cfg: BattleConfig, ships: [BattleShip, BattleShip], grapples: [boolean, boolean], seg: number, events: BattleEvent[]): BattleOutcome | null {
  const [me, them] = ships;
  if (me.damage >= PERMILLE && them.damage >= PERMILLE) return "broke_off";
  if (them.damage >= PERMILLE) return "crippled";
  if (me.damage >= PERMILLE) return "crippled_by";
  if (manhattan(pose(me), pose(them)) !== 1) return null;
  const can0 = grapples[0] && them.damage >= cfg.grappleDamage;
  const can1 = grapples[1] && me.damage >= cfg.grappleDamage;
  if (!can0 && !can1) return null;
  const boarder: ShipIndex = can0 && can1 ? (me.damage <= them.damage ? 0 : 1) : can0 ? 0 : 1;
  events.push({ seg, type: "grapple", ship: boarder, success: true });
  return boarder === 0 ? "boarded" : "boarded_by";
}

// ---- queries for boards and the harness

/** Where the captain's plan takes the ship if the brigand holds still: a pose per segment. */
export function previewPlan(state: BattleState, segments: readonly BattleSegment[]): Pose[] {
  const r = resolveTurn(state.board, state.config, state.ships, [{ segments: segments.map((s) => ({ ...s, port: false, starboard: false })), grapple: false }, EMPTY_PLAN]);
  return r.trace.map((t) => t[0]);
}

export function isWin(outcome: BattleOutcome | null): boolean {
  return outcome !== null && WIN_OUTCOMES.includes(outcome);
}

export function tokensSpent(plan: BattlePlan): Record<MoveToken, number> {
  const out = zeroTokens();
  for (const s of plan.segments) if (s.move) out[s.move] += 1;
  return out;
}

export function shotsPlanned(plan: BattlePlan): number {
  let n = 0;
  for (const s of plan.segments) n += (s.port ? 1 : 0) + (s.starboard ? 1 : 0);
  return n;
}

const OUTCOMES: readonly BattleOutcome[] = ["boarded", "crippled", "boarded_by", "crippled_by", "broke_off", "disengaged"];

export function hashBattleState(s: BattleState): string {
  const h = new Hasher();
  h.int(s.turn).int(s.boardIndex).int(s.score).int(s.hits).int(s.hitsTaken).int(s.combo).int(s.bestCombo).int(s.moveCount);
  h.int(s.finished ? 1 : 0).int(s.outcome === null ? -1 : OUTCOMES.indexOf(s.outcome));
  h.int(s.rng.a).int(s.rng.b).int(s.rng.c).int(s.rng.d);
  for (const ship of s.ships) {
    h.int(ship.x).int(ship.y).int(ship.heading).int(ship.damage).int(ship.loaded).int(ship.cannons);
    for (const t of MOVE_TOKENS) h.int(ship.tokens[t]);
  }
  return h.digest();
}

export interface BattleSummary {
  readonly score: number;
  readonly moves: number;
  readonly bestCombo: number;
}

export function summarizeBattle(s: BattleState): BattleSummary {
  return { score: s.score, moves: s.turn, bestCombo: s.bestCombo };
}
