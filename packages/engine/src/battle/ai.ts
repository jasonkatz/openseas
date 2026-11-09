/**
 * The raider's captain. A scripted policy, not a search over the captain's mind: it guesses the
 * captain will fly last turn's moves again (or hold still), flies every plan its tokens allow
 * through the same resolution the fight uses, and scores each by the broadsides it lines up, the
 * broadsides it walks into, the asteroids it hits, how close it ends and whether it can board. The
 * tier's knobs shape it: aggression trades safety for closing and boarding; accuracy is how many
 * of the shots it meant to fire it actually fires, and how often it fires at nothing. Every roll
 * comes from the fight's PRNG, so the raider replays exactly (ADR 0003).
 */

import { nextInt, type PrngState } from "../prng.js";
import { arcCells, manhattan, resolveTurn } from "./reduce.js";
import { EMPTY_PLAN, MOVE_TOKENS, type BattleState, type MoveToken, type BattlePlan, type Pose, type BattleSegment } from "./types.js";

const HIT_VALUE = 100;
const EXPOSED_VALUE = 80;
const BOARD_VALUE = 1200;
const BOARDED_VALUE = 900;
/** How many of the best plans a less wily raider picks among. */
const TOP_N = 4;

interface Candidate {
  readonly moves: ReadonlyArray<MoveToken | null>;
  score: number;
  /** Per segment and side, whether the captain's ship sat in the raider's arc under the main prediction. */
  readonly arcs: ReadonlyArray<{ port: boolean; starboard: boolean }>;
  readonly ends: Pose;
}

/** The captain's likely moves: last turn's again, else straight ahead. Grapples whenever it could. */
export function predictCaptain(state: BattleState): BattlePlan {
  const me = state.ships[0];
  if (state.lastTurn && state.lastTurn.plan.segments.length > 0) {
    const need = { left: 0, forward: 0, right: 0 };
    const segments: BattleSegment[] = [];
    for (const s of state.lastTurn.plan.segments) {
      let move = s.move;
      if (move !== null) {
        need[move] += 1;
        if (need[move] > me.tokens[move]) move = null;
      }
      segments.push({ move, port: false, starboard: false });
    }
    return { segments, grapple: true };
  }
  const n = Math.min(2, me.tokens.forward, state.config.segments);
  return { segments: Array.from({ length: n }, () => ({ move: "forward", port: false, starboard: false })), grapple: true };
}

/** Every sequence of up to `segments` moves the pool allows, holds included. Deterministic order. */
export function enumeratePlans(tokens: Readonly<Record<MoveToken, number>>, segments: number): Array<Array<MoveToken | null>> {
  const out: Array<Array<MoveToken | null>> = [];
  const pool = { ...tokens };
  const cur: Array<MoveToken | null> = [];
  const walk = (): void => {
    out.push([...cur]);
    if (cur.length >= segments) return;
    for (const t of [null, ...MOVE_TOKENS] as const) {
      if (t !== null) {
        if (pool[t] <= 0) continue;
        pool[t] -= 1;
      }
      cur.push(t);
      walk();
      cur.pop();
      if (t !== null) pool[t] += 1;
    }
  };
  walk();
  // A hold at the end of a plan is the same plan: keep only the one without it.
  const seen = new Set<string>();
  return out.filter((p) => {
    let n = p.length;
    while (n > 0 && p[n - 1] === null) n -= 1;
    const key = p.slice(0, n).map((m) => m ?? "-").join(",");
    if (seen.has(key)) return false;
    seen.add(key);
    return n === p.length;
  });
}

function evaluate(state: BattleState, moves: ReadonlyArray<MoveToken | null>, predicted: BattlePlan, grapple: boolean): { score: number; arcs: Array<{ port: boolean; starboard: boolean }>; ends: Pose } {
  const cfg = state.config;
  const b = cfg.raider;
  const me = state.ships[1];
  const plan: BattlePlan = { segments: moves.map((m) => ({ move: m, port: false, starboard: false })), grapple };
  const r = resolveTurn(state.board, cfg, state.ships, [predicted, plan]);
  let score = 0;
  const arcs: Array<{ port: boolean; starboard: boolean }> = [];
  let shotsLeft = me.loaded;
  let exposed = 0;
  const theirLoaded = state.ships[0].loaded;
  for (const [them, us] of r.trace) {
    const port = shotsLeft > 0 && arcCells(state.board, us, "port", cfg.turretRange).some((c) => c.x === them.x && c.y === them.y);
    const starboard = shotsLeft > 0 && arcCells(state.board, us, "starboard", cfg.turretRange).some((c) => c.x === them.x && c.y === them.y);
    if (port) shotsLeft -= 1;
    if (starboard) shotsLeft -= 1;
    if (port) score += HIT_VALUE;
    if (starboard) score += HIT_VALUE;
    arcs.push({ port, starboard });
    if (theirLoaded > 0) {
      for (const side of ["port", "starboard"] as const) {
        if (arcCells(state.board, them, side, cfg.turretRange).some((c) => c.x === us.x && c.y === us.y)) exposed += 1;
      }
    }
  }
  score -= Math.floor((Math.min(exposed, theirLoaded) * EXPOSED_VALUE * (130 - b.aggression)) / 100);
  for (const e of r.events) {
    if ((e.type === "move" || e.type === "push") && e.ship === 1 && e.damage > 0) score -= e.damage * 2;
    if (e.type === "move" && e.ship === 0 && e.blocked === "ship") score += Math.floor((cfg.ramDamage * b.aggression) / 100);
  }
  const ends = r.trace.length ? r.trace[r.trace.length - 1]![1] : { x: me.x, y: me.y, heading: me.heading };
  const them = r.trace.length ? r.trace[r.trace.length - 1]![0] : state.ships[0];
  score -= Math.floor((manhattan(ends, them) * (20 + b.aggression)) / 4);
  if (r.outcome === "boarded_by") score += Math.floor((BOARD_VALUE * (50 + b.aggression)) / 100);
  if (r.outcome === "boarded") score -= BOARDED_VALUE;
  if (r.outcome === "crippled_by") score += BOARD_VALUE;
  return { score, arcs, ends };
}

/** Pick the raider's plan for the turn about to resolve. Spends only the PRNG it returns. */
export function chooseRaiderPlan(state: BattleState, rng: PrngState): { plan: BattlePlan; rng: PrngState } {
  const cfg = state.config;
  const b = cfg.raider;
  const me = state.ships[1];
  const main = predictCaptain(state);
  const grapple = b.aggression > 0;
  const candidates: Candidate[] = enumeratePlans(me.tokens, cfg.segments).map((moves) => {
    const a = evaluate(state, moves, main, grapple);
    const still = evaluate(state, moves, EMPTY_PLAN, grapple);
    return { moves, score: Math.floor((a.score * 3 + still.score * 2) / 5), arcs: a.arcs, ends: a.ends };
  });
  candidates.sort((p, q) => q.score - p.score);
  let r = nextInt(rng, 100);
  rng = r.state;
  const wit = Math.max(b.accuracy, b.aggression);
  let pick = candidates[0]!;
  if (r.value >= wit && candidates.length > 1) {
    r = nextInt(rng, Math.min(TOP_N, candidates.length));
    rng = r.state;
    pick = candidates[r.value]!;
  }
  // Guns: fire where the captain is expected, as far as the loads go, each shot judged right with
  // the tier's accuracy. A poor gunner also wastes a load now and then on an empty space.
  let loads = me.loaded;
  const segments: BattleSegment[] = [];
  for (let i = 0; i < cfg.segments; i++) {
    const move = pick.moves[i] ?? null;
    const arc = pick.arcs[i] ?? { port: false, starboard: false };
    let port = false;
    let starboard = false;
    for (const side of ["port", "starboard"] as const) {
      if (!arc[side] || loads <= 0) continue;
      r = nextInt(rng, 100);
      rng = r.state;
      if (r.value < b.accuracy) {
        loads -= 1;
        if (side === "port") port = true;
        else starboard = true;
      }
    }
    if (!port && !starboard && loads > 0) {
      r = nextInt(rng, 300);
      rng = r.state;
      if (r.value < 100 - b.accuracy) {
        loads -= 1;
        const s = nextInt(rng, 2);
        rng = s.state;
        if (s.value === 0) port = true;
        else starboard = true;
      }
    }
    if (move !== null || port || starboard || i < pick.moves.length) segments.push({ move, port, starboard });
  }
  while (segments.length && segments[segments.length - 1]!.move === null && !segments[segments.length - 1]!.port && !segments[segments.length - 1]!.starboard) segments.pop();
  return { plan: { segments, grapple }, rng };
}
