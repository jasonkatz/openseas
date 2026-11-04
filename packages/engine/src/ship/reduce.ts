import { InvalidMoveError } from "../errors.js";
import { Hasher } from "../hash.js";
import { nextInt, seedFromString } from "../prng.js";
import {
  STATIONS,
  UNITS_PER_SECOND,
  isStation,
  type CrewMember,
  type Encounter,
  type LegPlan,
  type ShipConfig,
  type ShipEvent,
  type ShipMove,
  type ShipRules,
  type ShipState,
  type Station,
  type TurnReport,
} from "./types.js";

const PERMILLE = 1000;

const int = (n: unknown, lo: number, hi: number): boolean => typeof n === "number" && Number.isInteger(n) && n >= lo && n <= hi;

export function validateShipConfig(cfg: ShipConfig): void {
  const c = cfg.shipClass;
  const r: ShipRules = cfg.rules;
  const ok =
    typeof c.id === "string" &&
    c.id.length > 0 &&
    Array.isArray(c.stations) &&
    c.stations.every(isStation) &&
    new Set(c.stations).size === c.stations.length &&
    int(c.maxCrew, 1, 1000) &&
    int(c.cannons, 0, 100) &&
    int(c.baseTokens, 0, 100) &&
    int(r.turnSeconds, 1, 600) &&
    int(r.waterIntakePerTurn, 0, PERMILLE) &&
    int(r.waterIntakeAtFullDamage, 0, PERMILLE) &&
    int(r.pumpPerTurn, 0, PERMILLE) &&
    int(r.wearPerTurn, 0, PERMILLE) &&
    int(r.repairPerTurn, 0, PERMILLE) &&
    int(r.idleSpeed, 0, 10_000) &&
    int(r.sailSpeed, 0, 10_000) &&
    int(r.navSpeed, 0, 10_000) &&
    int(r.maxSpeed, r.idleSpeed, 10_000) &&
    int(r.waterSlow, 0, PERMILLE) &&
    int(r.damageSlow, 0, PERMILLE) &&
    int(r.loadPerTurn, 0, 100_000) &&
    int(r.navTokens, 0, 100) &&
    int(r.maxOutputPercent, 100, 10_000) &&
    int(r.graceTurns, 0, 100_000) &&
    int(r.hailTurns, 1, 100_000) &&
    int(r.encounterWindow.from, 0, PERMILLE) &&
    int(r.encounterWindow.to, r.encounterWindow.from, PERMILLE) &&
    STATIONS.every((s) => int(cfg.par[s], 1, 1_000_000));
  if (!ok) throw new Error("invalid ship config");
}

/** Length in progress units of a leg that takes `durationSeconds` at full speed. */
export function legUnits(durationSeconds: number): number {
  return durationSeconds * UNITS_PER_SECOND;
}

/** A station's output for a turn: `points` as a percentage of par, clamped. */
export function outputPercent(config: ShipConfig, station: Station, points: number): number {
  return Math.min(config.rules.maxOutputPercent, Math.floor((points * 100) / config.par[station]));
}

const zeroOutputs = (): Record<Station, number> => ({ bilging: 0, sailing: 0, carpentry: 0, gunnery: 0, navigation: 0 });

export function createShip(seed: string, config: ShipConfig, islandId: string): ShipState {
  validateShipConfig(config);
  if (typeof islandId !== "string" || islandId.length === 0) throw new Error("createShip: islandId required");
  return {
    config,
    rng: seedFromString(`ship:${seed}`),
    turn: 0,
    captainId: null,
    crew: [],
    nextBoardedSeq: 0,
    inviteOnly: false,
    islandId,
    voyage: null,
    water: 0,
    damage: 0,
    loaded: 0,
    loading: 0,
    tokens: 0,
    pending: zeroOutputs(),
    lastTurn: null,
    voyagesCompleted: 0,
    events: [],
  };
}

export function replayShip(seed: string, config: ShipConfig, islandId: string, moves: readonly ShipMove[]): ShipState {
  let s = createShip(seed, config, islandId);
  for (const m of moves) s = reduceShip(s, m);
  return s;
}

export function crewMember(state: ShipState, pirateId: string): CrewMember | null {
  return state.crew.find((c) => c.pirateId === pirateId) ?? null;
}

export function crewAtStation(state: ShipState, station: Station): CrewMember | null {
  return state.crew.find((c) => c.station === station) ?? null;
}

/** The longest-aboard crew member, preferring one who is connected. Null when nobody is aboard. */
export function longestAboard(crew: readonly CrewMember[]): CrewMember | null {
  let best: CrewMember | null = null;
  for (const c of crew) {
    if (best === null) {
      best = c;
      continue;
    }
    const bestAway = best.awaySinceTurn !== null;
    const cAway = c.awaySinceTurn !== null;
    if (bestAway && !cAway) best = c;
    else if (bestAway === cAway && c.boardedSeq < best.boardedSeq) best = c;
  }
  return best;
}

export function reduceShip(state: ShipState, move: ShipMove): ShipState {
  switch (move.type) {
    case "board":
      return board(state, move.pirateId);
    case "leave":
      return leave({ ...state, events: [] }, move.pirateId, "left");
    case "station":
      return station(state, move.pirateId, move.station, move);
    case "wheel":
      return wheel(state, move.pirateId, move);
    case "lock":
      return { ...state, inviteOnly: move.inviteOnly, events: [] };
    case "sail":
      return sail(state, move.leg, move);
    case "duty":
      return duty(state, move.station, move.points, move);
    case "turn":
      return turn(state);
    case "evade":
      return evade(state, move);
    case "away":
      return away(state, move.pirateId, move);
    case "back":
      return back(state, move.pirateId, move);
    default: {
      const never: never = move;
      throw new InvalidMoveError("unknown move", never);
    }
  }
}

function board(state: ShipState, pirateId: string): ShipState {
  if (typeof pirateId !== "string" || pirateId.length === 0) throw new InvalidMoveError("bad pirate id", { type: "board", pirateId });
  if (crewMember(state, pirateId)) throw new InvalidMoveError("already aboard", { type: "board", pirateId });
  if (state.crew.length >= state.config.shipClass.maxCrew) throw new InvalidMoveError("ship is full", { type: "board", pirateId });
  const member: CrewMember = { pirateId, station: null, boardedSeq: state.nextBoardedSeq, awaySinceTurn: null };
  const events: ShipEvent[] = [{ type: "boarded", pirateId }];
  let captainId = state.captainId;
  if (captainId === null) {
    captainId = pirateId;
    events.push({ type: "wheel", pirateId });
  }
  return { ...state, crew: [...state.crew, member], nextBoardedSeq: state.nextBoardedSeq + 1, captainId, events };
}

/** Removes a crew member, passing the wheel or abandoning the voyage as needed. Appends to `state.events`. */
function leave(state: ShipState, pirateId: string, reason: "left" | "timed_out"): ShipState {
  if (!crewMember(state, pirateId)) throw new InvalidMoveError("not aboard", { type: "leave", pirateId });
  const crew = state.crew.filter((c) => c.pirateId !== pirateId);
  const events: ShipEvent[] = [...state.events, { type: "left", pirateId, reason }];
  let captainId = state.captainId;
  if (captainId === pirateId) {
    const next = longestAboard(crew);
    captainId = next ? next.pirateId : null;
    if (next) events.push({ type: "wheel", pirateId: next.pirateId });
  }
  let next: ShipState = { ...state, crew, captainId, events };
  if (crew.length === 0 && state.voyage) {
    const islandId = state.voyage.leg.from;
    next = { ...next, voyage: null, islandId, water: 0, damage: 0, loading: 0, pending: zeroOutputs(), events: [...events, { type: "abandoned", islandId }] };
  }
  return next;
}

function station(state: ShipState, pirateId: string, which: Station | null, move: ShipMove): ShipState {
  const me = crewMember(state, pirateId);
  if (!me) throw new InvalidMoveError("not aboard", move);
  if (which !== null) {
    if (!isStation(which) || !state.config.shipClass.stations.includes(which)) throw new InvalidMoveError("no such station aboard", move);
    const holder = crewAtStation(state, which);
    if (holder && holder.pirateId !== pirateId) throw new InvalidMoveError("station taken", move);
  }
  const crew = state.crew.map((c) => (c.pirateId === pirateId ? { ...c, station: which } : c));
  return { ...state, crew, events: [{ type: "station", pirateId, station: which }] };
}

function wheel(state: ShipState, pirateId: string, move: ShipMove): ShipState {
  if (!crewMember(state, pirateId)) throw new InvalidMoveError("not aboard", move);
  if (state.captainId === pirateId) throw new InvalidMoveError("already at the wheel", move);
  return { ...state, captainId: pirateId, events: [{ type: "wheel", pirateId }] };
}

function sail(state: ShipState, leg: LegPlan, move: ShipMove): ShipState {
  if (state.islandId === null || state.voyage) throw new InvalidMoveError("not docked", move);
  if (state.captainId === null) throw new InvalidMoveError("nobody aboard", move);
  const legOk =
    typeof leg.routeId === "string" &&
    leg.from === state.islandId &&
    typeof leg.to === "string" &&
    leg.to !== leg.from &&
    int(leg.lengthUnits, 1, 1_000_000_000) &&
    int(leg.encounterChancePercent, 0, 100) &&
    Array.isArray(leg.brigands) &&
    leg.brigands.every((b) => typeof b.tierId === "string" && int(b.weight, 1, 1_000_000));
  if (!legOk) throw new InvalidMoveError("bad leg", move);

  let rng = state.rng;
  let encounter: Encounter | null = null;
  const roll = nextInt(rng, 100);
  rng = roll.state;
  if (roll.value < leg.encounterChancePercent && leg.brigands.length > 0) {
    const total = leg.brigands.reduce((n, b) => n + b.weight, 0);
    const pick = nextInt(rng, total);
    rng = pick.state;
    let acc = 0;
    let tierId = leg.brigands[0]!.tierId;
    for (const b of leg.brigands) {
      acc += b.weight;
      if (pick.value < acc) {
        tierId = b.tierId;
        break;
      }
    }
    const { from, to } = state.config.rules.encounterWindow;
    const lo = Math.floor((leg.lengthUnits * from) / PERMILLE);
    const hi = Math.floor((leg.lengthUnits * to) / PERMILLE);
    const at = nextInt(rng, hi - lo + 1);
    rng = at.state;
    encounter = { tierId, atUnits: lo + at.value, resolved: false };
  }
  return {
    ...state,
    rng,
    islandId: null,
    voyage: { leg, progress: 0, startedTurn: state.turn, encounter, hail: null },
    pending: zeroOutputs(),
    events: [{ type: "sailed", routeId: leg.routeId }],
  };
}

function duty(state: ShipState, which: Station, points: number, move: ShipMove): ShipState {
  if (!state.voyage) throw new InvalidMoveError("not at sea", move);
  if (!isStation(which) || !crewAtStation(state, which)) throw new InvalidMoveError("station unstaffed", move);
  if (!int(points, 0, 1_000_000_000)) throw new InvalidMoveError("bad points", move);
  return { ...state, pending: { ...state.pending, [which]: state.pending[which] + points }, events: [] };
}

function evade(state: ShipState, move: ShipMove): ShipState {
  const v = state.voyage;
  if (!v || !v.hail || !v.encounter) throw new InvalidMoveError("no brigand to evade", move);
  return {
    ...state,
    voyage: { ...v, hail: null, encounter: { ...v.encounter, resolved: true } },
    events: [{ type: "evaded", tierId: v.hail.tierId, auto: false }],
  };
}

function away(state: ShipState, pirateId: string, move: ShipMove): ShipState {
  const me = crewMember(state, pirateId);
  if (!me) throw new InvalidMoveError("not aboard", move);
  if (me.awaySinceTurn !== null) throw new InvalidMoveError("already away", move);
  const crew = state.crew.map((c) => (c.pirateId === pirateId ? { ...c, awaySinceTurn: state.turn } : c));
  return { ...state, crew, events: [] };
}

function back(state: ShipState, pirateId: string, move: ShipMove): ShipState {
  const me = crewMember(state, pirateId);
  if (!me) throw new InvalidMoveError("not aboard", move);
  if (me.awaySinceTurn === null) throw new InvalidMoveError("not away", move);
  const crew = state.crew.map((c) => (c.pirateId === pirateId ? { ...c, awaySinceTurn: null } : c));
  return { ...state, crew, events: [] };
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

function turn(state: ShipState): ShipState {
  const turnNo = state.turn + 1;
  let s: ShipState = { ...state, turn: turnNo, events: [] };

  // Seats held past the grace period are given up, which may pass the wheel or abandon the voyage.
  for (const c of state.crew) {
    if (c.awaySinceTurn !== null && turnNo - c.awaySinceTurn >= s.config.rules.graceTurns && crewMember(s, c.pirateId)) {
      s = leave(s, c.pirateId, "timed_out");
    }
  }

  const v = s.voyage;
  if (!v) return { ...s, pending: zeroOutputs() };

  const r = s.config.rules;
  const captain = s.captainId ? crewMember(s, s.captainId) : null;
  const held = captain === null || captain.awaySinceTurn !== null;
  const outputs = zeroOutputs();
  let report: TurnReport;
  if (held) {
    report = { turn: turnNo, outputs, held: true, speed: 0, advanced: 0, tokens: 0 };
    return { ...s, pending: zeroOutputs(), lastTurn: report };
  }

  for (const st of STATIONS) {
    if (crewAtStation(s, st)) outputs[st] = outputPercent(s.config, st, s.pending[st]);
  }

  const water = clamp(
    s.water + r.waterIntakePerTurn + Math.floor((s.damage * r.waterIntakeAtFullDamage) / PERMILLE) - Math.floor((r.pumpPerTurn * outputs.bilging) / 100),
    0,
    PERMILLE,
  );
  const damage = clamp(s.damage + r.wearPerTurn - Math.floor((r.repairPerTurn * outputs.carpentry) / 100), 0, PERMILLE);

  let speed = Math.min(r.maxSpeed, r.idleSpeed + Math.floor((r.sailSpeed * outputs.sailing) / 100) + Math.floor((r.navSpeed * outputs.navigation) / 100));
  speed = Math.floor((speed * (PERMILLE - Math.floor((water * r.waterSlow) / PERMILLE))) / PERMILLE);
  speed = Math.floor((speed * (PERMILLE - Math.floor((damage * r.damageSlow) / PERMILLE))) / PERMILLE);
  const advanced = Math.min(v.leg.lengthUnits - v.progress, speed * r.turnSeconds);
  const progress = v.progress + advanced;

  let loaded = s.loaded;
  let loading = s.loading + Math.floor((r.loadPerTurn * outputs.gunnery) / 100);
  while (loading >= PERMILLE && loaded < s.config.shipClass.cannons) {
    loaded += 1;
    loading -= PERMILLE;
  }
  if (loaded >= s.config.shipClass.cannons) loading = 0;

  const tokens = Math.floor((s.config.shipClass.baseTokens * outputs.sailing) / 100) + Math.floor((r.navTokens * outputs.navigation) / 100);

  const events: ShipEvent[] = [...s.events];
  let encounter = v.encounter;
  let hail = v.hail;
  if (encounter && !encounter.resolved && hail === null && progress >= encounter.atUnits) {
    hail = { tierId: encounter.tierId, sinceTurn: turnNo };
    events.push({ type: "hailed", tierId: encounter.tierId });
  } else if (hail && encounter && turnNo - hail.sinceTurn >= r.hailTurns) {
    events.push({ type: "evaded", tierId: hail.tierId, auto: true });
    hail = null;
    encounter = { ...encounter, resolved: true };
  }

  report = { turn: turnNo, outputs, held: false, speed, advanced, tokens };
  s = { ...s, water, damage, loaded, loading, tokens, pending: zeroOutputs(), lastTurn: report, events };

  if (progress >= v.leg.lengthUnits) {
    if (hail) events.push({ type: "evaded", tierId: hail.tierId, auto: true });
    events.push({ type: "arrived", islandId: v.leg.to, turns: turnNo - v.startedTurn });
    return { ...s, islandId: v.leg.to, voyage: null, water: 0, damage: 0, loading: 0, voyagesCompleted: s.voyagesCompleted + 1, events };
  }
  return { ...s, voyage: { ...v, progress, encounter, hail } };
}

export function hashShipState(s: ShipState): string {
  const h = new Hasher();
  h.int(s.turn).int(s.water).int(s.damage).int(s.loaded).int(s.loading).int(s.tokens).int(s.voyagesCompleted).int(s.nextBoardedSeq);
  h.int(s.inviteOnly ? 1 : 0);
  h.str(s.captainId ?? "");
  h.str(s.islandId ?? "");
  h.int(s.rng.a).int(s.rng.b).int(s.rng.c).int(s.rng.d);
  for (const c of s.crew) h.str(c.pirateId).str(c.station ?? "").int(c.boardedSeq).int(c.awaySinceTurn ?? -1);
  for (const st of STATIONS) h.int(s.pending[st]);
  if (s.voyage) {
    const v = s.voyage;
    h.str(v.leg.routeId).int(v.progress).int(v.startedTurn);
    if (v.encounter) h.str(v.encounter.tierId).int(v.encounter.atUnits).int(v.encounter.resolved ? 1 : 0);
    if (v.hail) h.str(v.hail.tierId).int(v.hail.sinceTurn);
  }
  return h.digest();
}

/** Where the ship is for a snapshot: docked, or this far along a leg in permille. */
export function progressPermille(s: ShipState): number {
  if (!s.voyage) return 0;
  return Math.floor((s.voyage.progress * PERMILLE) / s.voyage.leg.lengthUnits);
}
