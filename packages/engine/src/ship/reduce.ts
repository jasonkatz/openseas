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
    int(c.minCrew, 0, c.maxCrew) &&
    Array.isArray(c.mateStations) &&
    c.mateStations.every((st) => isStation(st) && c.stations.includes(st)) &&
    new Set(c.mateStations).size === c.mateStations.length &&
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
    int(r.mateOutput.min, 0, r.maxOutputPercent) &&
    int(r.mateOutput.max, r.mateOutput.min, r.maxOutputPercent) &&
    int(r.mateRestTurns, 0, 100_000) &&
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

/** The pirates aboard: the crew without its deckhands. */
export function pirates(crew: readonly CrewMember[]): CrewMember[] {
  return crew.filter((c) => !c.mate);
}

/** The deckhands aboard. */
export function mates(crew: readonly CrewMember[]): CrewMember[] {
  return crew.filter((c) => c.mate);
}

/** The longest-aboard pirate, preferring one who is connected. Null when no pirate is aboard; a deckhand never has the wheel. */
export function longestAboard(crew: readonly CrewMember[]): CrewMember | null {
  let best: CrewMember | null = null;
  for (const c of crew) {
    if (c.mate) continue;
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
    case "assign":
      return assign(state, move.pirateId, move.station, move);
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
    case "engage":
      return engage(state, move);
    case "hit":
      return hit(state, move);
    case "fired":
      return fired(state, move);
    case "battle_end":
      return battleEnd(state, move);
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
  if (typeof pirateId !== "string" || pirateId.length === 0 || pirateId.startsWith(MATE_PREFIX)) throw new InvalidMoveError("bad pirate id", { type: "board", pirateId });
  if (crewMember(state, pirateId)) throw new InvalidMoveError("already aboard", { type: "board", pirateId });
  let s: ShipState = { ...state, events: [] };
  if (s.crew.length >= s.config.shipClass.maxCrew) {
    // A deckhand gives up its berth to a pirate: the idle one first, else the last signed on.
    const hands = mates(s.crew);
    const spare = hands.find((m) => m.station === null) ?? hands[hands.length - 1];
    if (!spare) throw new InvalidMoveError("ship is full", { type: "board", pirateId });
    s = payOff(s, [spare.pirateId]);
  }
  const member: CrewMember = { pirateId, station: null, boardedSeq: s.nextBoardedSeq, awaySinceTurn: null, mate: false, idleFromTurn: null };
  const events: ShipEvent[] = [...s.events, { type: "boarded", pirateId }];
  let captainId = s.captainId;
  if (captainId === null) {
    captainId = pirateId;
    events.push({ type: "wheel", pirateId });
  }
  return { ...s, crew: [...s.crew, member], nextBoardedSeq: s.nextBoardedSeq + 1, captainId, events };
}

const MATE_PREFIX = "mate:";

/** Deckhands go ashore. Appends to `state.events`. */
function payOff(state: ShipState, pirateIds: readonly string[]): ShipState {
  if (pirateIds.length === 0) return state;
  const gone = new Set(pirateIds);
  return { ...state, crew: state.crew.filter((c) => !gone.has(c.pirateId)), events: [...state.events, { type: "paid_off", pirateIds: [...pirateIds] }] };
}

/** The stations a deckhand may take right now, in the class's order of preference. */
function openMateStations(state: ShipState): Station[] {
  return state.config.shipClass.mateStations.filter((st) => !crewAtStation(state, st));
}

/**
 * Setting sail short-handed signs on deckhands up to the class's `minCrew`, each at the first
 * open station it will work; any left over wait on deck for one to open. Appends to `state.events`.
 */
function hire(state: ShipState): ShipState {
  const c = state.config.shipClass;
  const wanted = Math.min(c.maxCrew, c.minCrew) - state.crew.length;
  if (wanted <= 0) return state;
  let s = state;
  const open = openMateStations(s);
  for (let i = 0; i < wanted; i++) {
    const station = open.shift() ?? null;
    const pirateId = `${MATE_PREFIX}${s.nextBoardedSeq}`;
    const member: CrewMember = { pirateId, station, boardedSeq: s.nextBoardedSeq, awaySinceTurn: null, mate: true, idleFromTurn: station ? null : s.turn };
    s = { ...s, crew: [...s.crew, member], nextBoardedSeq: s.nextBoardedSeq + 1, events: [...s.events, { type: "hired", pirateId, station }] };
  }
  return s;
}

/** Deckhands whose rest is over take the open stations, in boarding order. Appends to `state.events`. */
function reseatMates(state: ShipState): ShipState {
  let s = state;
  for (const m of mates(s.crew)) {
    if (m.station !== null || m.idleFromTurn === null || s.turn < m.idleFromTurn) continue;
    const station = openMateStations(s)[0];
    if (!station) continue;
    s = {
      ...s,
      crew: s.crew.map((c) => (c.pirateId === m.pirateId ? { ...c, station, idleFromTurn: null } : c)),
      events: [...s.events, { type: "station", pirateId: m.pirateId, station }],
    };
  }
  return s;
}

/** Removes a crew member, passing the wheel or abandoning the voyage as needed. Appends to `state.events`. */
function leave(state: ShipState, pirateId: string, reason: "left" | "timed_out"): ShipState {
  const me = crewMember(state, pirateId);
  if (!me) throw new InvalidMoveError("not aboard", { type: "leave", pirateId });
  if (me.mate) throw new InvalidMoveError("not a pirate", { type: "leave", pirateId });
  const crew = state.crew.filter((c) => c.pirateId !== pirateId);
  const events: ShipEvent[] = [...state.events, { type: "left", pirateId, reason }];
  let captainId = state.captainId;
  if (captainId === pirateId) {
    const next = longestAboard(crew);
    captainId = next ? next.pirateId : null;
    if (next) events.push({ type: "wheel", pirateId: next.pirateId });
  }
  let next: ShipState = { ...state, crew, captainId, events };
  // The deckhands work for the pirates; with the last one gone they go too, and the ship is empty.
  if (pirates(crew).length === 0) next = payOff(next, mates(crew).map((m) => m.pirateId));
  if (next.crew.length === 0 && state.voyage) {
    const islandId = state.voyage.leg.from;
    next = { ...next, voyage: null, islandId, water: 0, damage: 0, loading: 0, pending: zeroOutputs(), events: [...next.events, { type: "abandoned", islandId }] };
  }
  return next;
}

function station(state: ShipState, pirateId: string, which: Station | null, move: ShipMove): ShipState {
  const me = crewMember(state, pirateId);
  if (!me) throw new InvalidMoveError("not aboard", move);
  if (me.mate) throw new InvalidMoveError("not a pirate", move);
  let relieved: CrewMember | null = null;
  if (which !== null) {
    if (!isStation(which) || !state.config.shipClass.stations.includes(which)) throw new InvalidMoveError("no such station aboard", move);
    const holder = crewAtStation(state, which);
    if (holder && holder.pirateId !== pirateId) {
      if (!holder.mate) throw new InvalidMoveError("station taken", move);
      relieved = holder;
    }
  }
  const restUntil = state.turn + state.config.rules.mateRestTurns;
  const crew = state.crew.map((c) => (c.pirateId === pirateId ? { ...c, station: which } : c === relieved ? { ...c, station: null, idleFromTurn: restUntil } : c));
  return { ...state, crew, events: [{ type: "station", pirateId, station: which }] };
}

/** A pirate's order to a deckhand: work this station (any the ship has), or stand down for a rest. */
function assign(state: ShipState, pirateId: string, which: Station | null, move: ShipMove): ShipState {
  const hand = crewMember(state, pirateId);
  if (!hand) throw new InvalidMoveError("not aboard", move);
  if (!hand.mate) throw new InvalidMoveError("not a deckhand", move);
  let displaced: CrewMember | null = null;
  if (which !== null) {
    if (!isStation(which) || !state.config.shipClass.stations.includes(which)) throw new InvalidMoveError("no such station aboard", move);
    const holder = crewAtStation(state, which);
    if (holder && holder.pirateId !== pirateId) {
      if (!holder.mate) throw new InvalidMoveError("station taken", move);
      displaced = holder;
    }
  }
  if (hand.station === which) return { ...state, events: [] };
  const restUntil = state.turn + state.config.rules.mateRestTurns;
  const crew = state.crew.map((c) =>
    c.pirateId === pirateId
      ? { ...c, station: which, idleFromTurn: which === null ? restUntil : null }
      : c === displaced
        ? { ...c, station: null, idleFromTurn: state.turn }
        : c,
  );
  return { ...state, crew, events: [{ type: "station", pirateId, station: which }] };
}

function wheel(state: ShipState, pirateId: string, move: ShipMove): ShipState {
  const to = crewMember(state, pirateId);
  if (!to) throw new InvalidMoveError("not aboard", move);
  if (to.mate) throw new InvalidMoveError("not a pirate", move);
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
  return hire({
    ...state,
    rng,
    islandId: null,
    voyage: { leg, progress: 0, startedTurn: state.turn, encounter, hail: null, battle: null },
    pending: zeroOutputs(),
    events: [{ type: "sailed", routeId: leg.routeId }],
  });
}

function duty(state: ShipState, which: Station, points: number, move: ShipMove): ShipState {
  if (!state.voyage) throw new InvalidMoveError("not at sea", move);
  const holder = isStation(which) ? crewAtStation(state, which) : null;
  if (!holder) throw new InvalidMoveError("station unstaffed", move);
  if (holder.mate) throw new InvalidMoveError("a deckhand plays no board", move);
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

function engage(state: ShipState, move: ShipMove): ShipState {
  const v = state.voyage;
  if (!v || !v.hail || !v.encounter) throw new InvalidMoveError("no brigand to engage", move);
  if (v.battle) throw new InvalidMoveError("already in battle", move);
  return {
    ...state,
    voyage: { ...v, hail: null, battle: { tierId: v.hail.tierId, sinceTurn: state.turn } },
    events: [{ type: "engaged", tierId: v.hail.tierId }],
  };
}

function hit(state: ShipState, move: Extract<ShipMove, { type: "hit" }>): ShipState {
  if (!state.voyage?.battle) throw new InvalidMoveError("not in battle", move);
  if (!int(move.damage, 0, PERMILLE)) throw new InvalidMoveError("bad damage", move);
  return { ...state, damage: clamp(state.damage + move.damage, 0, PERMILLE), events: [] };
}

function fired(state: ShipState, move: Extract<ShipMove, { type: "fired" }>): ShipState {
  if (!state.voyage?.battle) throw new InvalidMoveError("not in battle", move);
  if (!int(move.shots, 0, 1000)) throw new InvalidMoveError("bad shots", move);
  return { ...state, loaded: Math.max(0, state.loaded - move.shots), events: [] };
}

function battleEnd(state: ShipState, move: Extract<ShipMove, { type: "battle_end" }>): ShipState {
  const v = state.voyage;
  if (!v || !v.battle || !v.encounter) throw new InvalidMoveError("not in battle", move);
  if (!int(move.booty, 0, 1_000_000_000) || !int(move.turns, 0, 1_000_000)) throw new InvalidMoveError("bad battle end", move);
  return {
    ...state,
    voyage: { ...v, battle: null, encounter: { ...v.encounter, resolved: true } },
    events: [{ type: "battle_ended", tierId: v.battle.tierId, outcome: move.outcome, booty: move.booty, turns: move.turns }],
  };
}

function away(state: ShipState, pirateId: string, move: ShipMove): ShipState {
  const me = crewMember(state, pirateId);
  if (!me) throw new InvalidMoveError("not aboard", move);
  if (me.mate) throw new InvalidMoveError("not a pirate", move);
  if (me.awaySinceTurn !== null) throw new InvalidMoveError("already away", move);
  const crew = state.crew.map((c) => (c.pirateId === pirateId ? { ...c, awaySinceTurn: state.turn } : c));
  return { ...state, crew, events: [] };
}

function back(state: ShipState, pirateId: string, move: ShipMove): ShipState {
  const me = crewMember(state, pirateId);
  if (!me) throw new InvalidMoveError("not aboard", move);
  if (me.mate) throw new InvalidMoveError("not a pirate", move);
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

  // Deckhands relieved a while ago find another station to work.
  s = reseatMates(s);

  const r = s.config.rules;
  const captain = s.captainId ? crewMember(s, s.captainId) : null;
  const held = captain === null || captain.awaySinceTurn !== null;
  const outputs = zeroOutputs();
  let report: TurnReport;
  if (held) {
    report = { turn: turnNo, outputs, held: true, speed: 0, advanced: 0, tokens: 0 };
    return { ...s, pending: zeroOutputs(), lastTurn: report };
  }

  // A pirate's output is their board's points; a deckhand's is a passable roll from the ship's PRNG.
  let rng = s.rng;
  for (const st of STATIONS) {
    const who = crewAtStation(s, st);
    if (!who) continue;
    if (who.mate) {
      const roll = nextInt(rng, r.mateOutput.max - r.mateOutput.min + 1);
      rng = roll.state;
      outputs[st] = r.mateOutput.min + roll.value;
    } else outputs[st] = outputPercent(s.config, st, s.pending[st]);
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
  // In a fight the ship holds position; the stations still drive the battle board.
  const advanced = v.battle ? 0 : Math.min(v.leg.lengthUnits - v.progress, speed * r.turnSeconds);
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
  s = { ...s, rng, water, damage, loaded, loading, tokens, pending: zeroOutputs(), lastTurn: report, events };

  if (progress >= v.leg.lengthUnits) {
    if (hail) events.push({ type: "evaded", tierId: hail.tierId, auto: true });
    // The deckhands are paid off in port; the next voyage signs on fresh ones if it needs them.
    s = payOff({ ...s, events }, mates(s.crew).map((m) => m.pirateId));
    const arrived: ShipEvent[] = [...s.events, { type: "arrived", islandId: v.leg.to, turns: turnNo - v.startedTurn }];
    return { ...s, islandId: v.leg.to, voyage: null, water: 0, damage: 0, loading: 0, voyagesCompleted: s.voyagesCompleted + 1, events: arrived };
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
  for (const c of s.crew) h.str(c.pirateId).str(c.station ?? "").int(c.boardedSeq).int(c.awaySinceTurn ?? -1).int(c.mate ? 1 : 0).int(c.idleFromTurn ?? -1);
  for (const st of STATIONS) h.int(s.pending[st]);
  if (s.voyage) {
    const v = s.voyage;
    h.str(v.leg.routeId).int(v.progress).int(v.startedTurn);
    if (v.encounter) h.str(v.encounter.tierId).int(v.encounter.atUnits).int(v.encounter.resolved ? 1 : 0);
    h.int(v.hail ? 1 : 0).int(v.battle ? 1 : 0);
    if (v.hail) h.str(v.hail.tierId).int(v.hail.sinceTurn);
    if (v.battle) h.str(v.battle.tierId).int(v.battle.sinceTurn);
  }
  return h.digest();
}

/** Where the ship is for a snapshot: docked, or this far along a leg in permille. */
export function progressPermille(s: ShipState): number {
  if (!s.voyage) return 0;
  return Math.floor((s.voyage.progress * PERMILLE) / s.voyage.leg.lengthUnits);
}
