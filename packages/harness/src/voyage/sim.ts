/**
 * The voyage bench's simulator (ADR 0027): a ship sailing one leg with a simulated crew, through
 * the engine's own reducers, wired the way the server wires them. Pure and deterministic: the same
 * setup sails the same voyage, turn for turn, hash for hash.
 *
 * One `step` is one ship turn, in the server's order:
 *
 *   1. the script's moves for this turn (a pirate drops, comes back, leaves, changes station);
 *   2. a boarding melee in progress fights on for a turn's worth of ticks;
 *   3. the battle board commits the captain's plot (the AI captain's, or the tester's) and the ship
 *      takes the shots fired and the hull damage, as the server's `takeBattleTurn` does;
 *   4. every pirate at a station reports a turn's duty points (`takeTurnPoints`);
 *   5. the ship turns;
 *   6. the battle board is supplied with the ship's word (`pushSupply`);
 *   7. the captain answers a hail this turn raised (engage, evade, or let it lapse); engaging deals
 *      the battle board on the ship's config and supplies it at once, as the server's `engage` and
 *      `supplyNow` do, so the fight's first plot sails at the next turn.
 *
 * What is modelled rather than played: a pirate's board is a number of points per turn, rolled
 * from that pirate's own PRNG around the scenario's percent of par; the captain plays no station
 * while at the helm of a fight; and the boarding melee is one swordfight with every pirate's hand
 * against the tier's crew, where aboard the server routes one fight per pirate (ADR 0022). Every
 * roll is seeded, so a scenario and its seed are the whole story.
 */

import {
  battleConfigAboard,
  chooseCaptainPlan,
  createBattleGame,
  createShip,
  createSwordfightGame,
  crewMember,
  hashBattleState,
  hashShipState,
  hashSwordfightState,
  InvalidMoveError,
  nextInt,
  pirates,
  progressPermille,
  reduceBattle,
  reduceShip,
  reduceSwordfight,
  seedFromString,
  shipSupply,
  splitBooty,
  STATIONS,
  type BattleConfig,
  type BattleMove,
  type BattleOutcome,
  type BattlePlan,
  type BattleState,
  type PrngState,
  type ShipBattleOutcome,
  type ShipEvent,
  type ShipMove,
  type ShipState,
  type Station,
  type SwordfightConfig,
  type SwordfightMove,
  type SwordfightState,
  turnBootyOutputs,
  meleeBootyOutput,
  swordfightScore,
} from "@openseas/engine";
import { meleeConfig, type VoyageSetup } from "./scenario.js";

export type SimPhase = "sailing" | "battle" | "melee" | "arrived" | "abandoned" | "adrift";

/** The ship after one turn, for the charts. */
export interface TurnSample {
  readonly turn: number;
  readonly phase: "sailing" | "battle" | "melee";
  readonly outputs: Readonly<Record<Station, number>>;
  readonly held: boolean;
  /** Permille, as the ship reducer keeps them. */
  readonly water: number;
  readonly damage: number;
  readonly speed: number;
  /** Permille of the leg. */
  readonly progress: number;
  readonly loaded: number;
  readonly tokens: number;
  /** The brigand's hull while a fight is on, permille; null otherwise. */
  readonly brigandDamage: number | null;
}

/** One sea battle: everything needed to replay it, and every state it passed through for the board. */
export interface BattleRecord {
  readonly tierId: string;
  readonly seed: string;
  readonly config: BattleConfig;
  readonly moves: readonly BattleMove[];
  /** The hash after each move. */
  readonly hashes: readonly string[];
  /** The state after the deal and after each move. */
  readonly states: readonly BattleState[];
  /** The ship turn it was engaged before. */
  readonly startTurn: number;
  /** The captain who engaged it; the fight goes with them. */
  readonly captainId: string;
  /** Who plotted each committed turn. */
  readonly plotters: ReadonlyArray<"ai" | "you">;
  /** What each pirate's station gave the ship during the fight, in percent of par summed over turns, for the purse (ADR 0030). */
  readonly dutyOutput: Readonly<Record<string, number>>;
  readonly outcome: BattleOutcome | null;
}

/** One boarding melee, modelled as a single team swordfight. */
export interface MeleeRecord {
  readonly tierId: string;
  readonly seed: string;
  readonly config: SwordfightConfig;
  readonly moves: readonly SwordfightMove[];
  readonly hashes: readonly string[];
  /** The pirate behind each of side 0's boards, in board order. */
  readonly fighters: readonly string[];
  readonly startTurn: number;
  /** What the sea battle ended in: who boarded whom. */
  readonly boarding: "boarded" | "boarded_by";
  readonly outcome: ShipBattleOutcome | null;
  /** The fight as it stands, for the bench's tally of the boards. */
  readonly last: SwordfightState;
}

/** A line of the voyage's log. `kind` names a message under `harness.voyage.log.`; `who` values are pirate ids. */
export interface SimEntry {
  readonly turn: number;
  readonly kind: string;
  readonly vars: Readonly<Record<string, string | number>>;
}

export interface VoyageSim {
  readonly setup: VoyageSetup;
  readonly ship: ShipState;
  /** Every ship move applied, in order, and the hash after each: the voyage's log. */
  readonly shipMoves: readonly ShipMove[];
  readonly shipHashes: readonly string[];
  /** One PRNG per pirate, so changing one pirate leaves the others' rolls alone. */
  readonly crewRng: readonly PrngState[];
  readonly captainRng: PrngState;
  readonly battles: readonly BattleRecord[];
  readonly melees: readonly MeleeRecord[];
  /** The fight on now: the last battle or melee record, while unfinished. */
  readonly battle: BattleState | null;
  readonly melee: SwordfightState | null;
  readonly samples: readonly TurnSample[];
  readonly log: readonly SimEntry[];
  /** Coins paid per pirate over the voyage. */
  readonly booty: Readonly<Record<string, number>>;
  readonly phase: SimPhase;
  readonly done: boolean;
}

/** A working copy for one step: arrays copied once, then appended to in place. */
interface Work {
  setup: VoyageSetup;
  ship: ShipState;
  shipMoves: ShipMove[];
  shipHashes: string[];
  crewRng: PrngState[];
  captainRng: PrngState;
  battles: BattleRecord[];
  melees: MeleeRecord[];
  battle: BattleState | null;
  melee: SwordfightState | null;
  samples: TurnSample[];
  log: SimEntry[];
  booty: Record<string, number>;
  phase: SimPhase;
  done: boolean;
}

const zeroOutputs = (): Record<Station, number> => ({ bilging: 0, sailing: 0, carpentry: 0, gunnery: 0, navigation: 0 });

function work(sim: VoyageSim): Work {
  return {
    ...sim,
    shipMoves: [...sim.shipMoves],
    shipHashes: [...sim.shipHashes],
    crewRng: [...sim.crewRng],
    battles: [...sim.battles],
    melees: [...sim.melees],
    samples: [...sim.samples],
    log: [...sim.log],
    booty: { ...sim.booty },
  };
}

const freeze = (w: Work): VoyageSim => w;

function note(w: Work, kind: string, vars: Record<string, string | number> = {}): void {
  w.log.push({ turn: w.ship.turn, kind, vars });
}

/** Apply a ship move and log what it did. Returns false (and logs the refusal) when the reducer refuses it. */
function applyShip(w: Work, move: ShipMove, refusedAs?: { kind: string; who: string }): boolean {
  try {
    w.ship = reduceShip(w.ship, move);
  } catch (e) {
    if (!(e instanceof InvalidMoveError)) throw e;
    if (refusedAs) note(w, "refused", { action: refusedAs.kind, who: refusedAs.who, reason: e.message });
    return false;
  }
  w.shipMoves.push(move);
  w.shipHashes.push(hashShipState(w.ship));
  for (const e of w.ship.events) shipEvent(w, e);
  return true;
}

function shipEvent(w: Work, e: ShipEvent): void {
  switch (e.type) {
    case "boarded":
      return; // the crew list says who sailed
    case "left":
      note(w, e.reason === "timed_out" ? "timed_out" : "left", { who: e.pirateId });
      return;
    case "hired":
      note(w, "hired", { who: e.pirateId, station: e.station ?? "" });
      return;
    case "paid_off":
      note(w, "paid_off", { count: e.pirateIds.length });
      return;
    case "station":
      note(w, "station", { who: e.pirateId, station: e.station ?? "" });
      return;
    case "wheel":
      note(w, "wheel", { who: e.pirateId });
      return;
    case "sailed":
      note(w, "sailed", { route: e.routeId });
      return;
    case "hailed":
      note(w, "hailed", { tier: e.tierId });
      return;
    case "evaded":
      note(w, e.auto ? "evaded_auto" : "evaded", { tier: e.tierId });
      return;
    case "engaged":
      note(w, "engaged", { tier: e.tierId });
      return;
    case "battle_ended":
      note(w, "battle_ended", { tier: e.tierId, outcome: e.outcome, booty: e.booty, turns: e.turns });
      return;
    case "boarding":
      return;
    case "arrived":
      note(w, "arrived", { island: e.islandId, turns: e.turns });
      w.phase = "arrived";
      w.done = true;
      return;
    case "abandoned":
      note(w, "abandoned", { island: e.islandId });
      w.phase = "abandoned";
      w.done = true;
      return;
  }
}

/** Set sail: everyone boards in order (the first has the wheel), takes their station, and the ship sails the leg. */
export function startVoyage(setup: VoyageSetup): VoyageSim {
  const w: Work = {
    setup,
    ship: createShip(setup.seed, setup.ship, setup.islandId),
    shipMoves: [],
    shipHashes: [],
    crewRng: setup.crew.map((c) => seedFromString(`crew:${setup.seed}:${c.pirateId}`)),
    captainRng: seedFromString(`captain:${setup.seed}`),
    battles: [],
    melees: [],
    battle: null,
    melee: null,
    samples: [],
    log: [],
    booty: {},
    phase: "sailing",
    done: false,
  };
  for (const c of setup.crew) applyShip(w, { type: "board", pirateId: c.pirateId }, { kind: "board", who: c.pirateId });
  for (const c of setup.crew) if (c.station) applyShip(w, { type: "station", pirateId: c.pirateId, station: c.station }, { kind: "station", who: c.pirateId });
  applyShip(w, { type: "sail", leg: setup.leg });
  return freeze(w);
}

const lastBattle = (w: Work): BattleRecord => w.battles[w.battles.length - 1]!;
const lastMelee = (w: Work): MeleeRecord => w.melees[w.melees.length - 1]!;

function pushBattleMove(w: Work, move: BattleMove, plotter?: "ai" | "you"): void {
  const rec = lastBattle(w);
  const next = reduceBattle(w.battle!, move);
  w.battle = next;
  w.battles[w.battles.length - 1] = {
    ...rec,
    moves: [...rec.moves, move],
    hashes: [...rec.hashes, hashBattleState(next)],
    states: [...rec.states, next],
    plotters: plotter ? [...rec.plotters, plotter] : rec.plotters,
  };
}

/** The ship's word to the captain's board, after the deal and after every ship turn. */
function supply(w: Work): void {
  if (!w.battle || w.battle.finished) return;
  pushBattleMove(w, { type: "supply", ...shipSupply(w.ship) });
  if (w.battle.finished) settleBattle(w);
}

function engage(w: Work): void {
  const hail = w.ship.voyage?.hail;
  if (!hail || !applyShip(w, { type: "engage" })) return;
  const tier = w.setup.tiers[hail.tierId]!;
  const config = battleConfigAboard(w.setup.battleBase, w.ship, tier.brigand, tier.scorePercent);
  const seed = `${w.setup.seed}/battle/${w.battles.length + 1}`;
  const state = createBattleGame(seed, config);
  w.battle = state;
  w.phase = "battle";
  w.battles.push({
    tierId: tier.id,
    seed,
    config,
    moves: [],
    hashes: [],
    states: [state],
    startTurn: w.ship.turn + 1,
    captainId: w.ship.captainId ?? "",
    plotters: [],
    dutyOutput: {},
    outcome: null,
  });
  supply(w);
}

function answerHail(w: Work): void {
  const hail = w.ship.voyage?.hail;
  const captain = w.ship.captainId ? crewMember(w.ship, w.ship.captainId) : null;
  if (!hail || w.battle || w.melee || !captain || captain.awaySinceTurn !== null) return;
  if (w.setup.hail === "engage") engage(w);
  else if (w.setup.hail === "evade") applyShip(w, { type: "evade" });
}

/** The fight is decided on the board: a boarding opens the melee at the rail, anything else pays out now. */
function settleBattle(w: Work): void {
  const state = w.battle!;
  const rec = lastBattle(w);
  const outcome = state.outcome ?? "broke_off";
  w.battles[w.battles.length - 1] = { ...rec, outcome };
  w.battle = null;
  if (outcome === "boarded" || outcome === "boarded_by") {
    // Deckhands hold no board; a pirate whose seat is held while away is not at the rail.
    const fighters = w.ship.crew.filter((c) => !c.mate && c.awaySinceTurn === null);
    if (fighters.length > 0) {
      openMelee(w, rec.tierId, outcome, fighters.map((c) => c.pirateId));
      return;
    }
  }
  payBattle(w, rec.tierId, outcome, rec.dutyOutput, state.turn);
}

function openMelee(w: Work, tierId: string, boarding: "boarded" | "boarded_by", fighters: string[]): void {
  const tier = w.setup.tiers[tierId]!;
  const hands = fighters.slice(0, 8).map((id) => w.setup.crew.find((c) => c.pirateId === id)!.sword);
  const config = meleeConfig(w.setup.swordBase, hands, tier.swordsmen, tier.scorePercent);
  const seed = `${w.setup.seed}/melee/${w.melees.length + 1}`;
  w.melee = createSwordfightGame(seed, config);
  w.phase = "melee";
  w.melees.push({ tierId, seed, config, moves: [], hashes: [], fighters: fighters.slice(0, 8), startTurn: w.ship.turn + 1, boarding, outcome: null, last: w.melee });
  note(w, "boarding", { tier: tierId, fighters: hands.length, boarded: boarding === "boarded" ? 1 : 0 });
}

/** The melee fights on for one ship turn's worth of ticks, and may decide the rail. */
function fightMelee(w: Work): void {
  const state = w.melee!;
  const cfg = state.config;
  const ticksPerTurn = Math.max(1, Math.floor((w.setup.ship.rules.turnSeconds * 1000) / cfg.tickMs));
  const tick = Math.min(cfg.maxTick, state.tick + ticksPerTurn);
  const move: SwordfightMove = { type: "wait", tick };
  const next = reduceSwordfight(state, move);
  const rec = lastMelee(w);
  w.melee = next;
  w.melees[w.melees.length - 1] = { ...rec, moves: [...rec.moves, move], hashes: [...rec.hashes, hashSwordfightState(next)], last: next };
  if (next.finished) settleMelee(w, next.outcome === "won" ? "boarded" : "boarded_by");
  else if (next.tick >= cfg.maxTick) settleMelee(w, "broke_off");
}

function settleMelee(w: Work, outcome: ShipBattleOutcome): void {
  const state = w.melee!;
  const rec = lastMelee(w);
  w.melees[w.melees.length - 1] = { ...rec, outcome };
  w.melee = null;
  note(w, "melee_ended", { tier: rec.tierId, outcome });
  // The purse weighs what each pirate gave the ship in the sea battle, and their melee as duty
  // turns at their attack a minute against Swordfight's par (ADR 0030).
  const battle = w.battles[w.battles.length - 1]!;
  const points: Record<string, number> = { ...battle.dutyOutput };
  const meleeMs = state.tick * state.config.tickMs;
  rec.fighters.forEach((id, i) => {
    const board = state.boards[i];
    if (!board) return;
    const rate = swordfightScore(state.config, board.points, state.tick, null);
    points[id] = (points[id] ?? 0) + meleeBootyOutput(rate, w.setup.meleeParRate, meleeMs, w.setup.ship.rules.turnSeconds);
  });
  payBattle(w, rec.tierId, outcome, points, battle.states[battle.states.length - 1]!.turn);
}

/** The fight is over: the purse is split among the pirates aboard, and the ship sails on. */
function payBattle(w: Work, tierId: string, outcome: ShipBattleOutcome, points: Readonly<Record<string, number>>, turns: number): void {
  const won = outcome === "boarded" || outcome === "crippled";
  const booty = won ? w.setup.tiers[tierId]!.booty : 0;
  const crew = pirates(w.ship.crew).map((c) => ({ pirateId: c.pirateId, captain: c.pirateId === w.ship.captainId, points: points[c.pirateId] ?? 0 }));
  const shares = booty > 0 ? splitBooty(booty, crew) : new Map<string, number>();
  for (const [id, coins] of shares) w.booty[id] = (w.booty[id] ?? 0) + coins;
  if (w.ship.voyage?.battle) applyShip(w, { type: "battle_end", outcome, booty, turns });
  if (!w.done) w.phase = "sailing";
}

/** The battle board's plot this turn: the tester's if given, else the AI captain's when the AI has the wheel. */
function commit(w: Work, plan: BattlePlan | null): void {
  let plotter: "ai" | "you" = "you";
  if (!plan) {
    const c = chooseCaptainPlan(w.battle!, w.setup.captain, w.captainRng);
    w.captainRng = c.rng;
    plan = c.plan;
    plotter = "ai";
  }
  pushBattleMove(w, { type: "commit", ...plan }, plotter);
  const report = w.battle!.lastTurn;
  if (report && w.ship.voyage?.battle) {
    if (report.shots > 0) applyShip(w, { type: "fired", shots: report.shots });
    if (report.damageTaken > 0) applyShip(w, { type: "hit", damage: report.damageTaken });
    note(w, "battle_turn", { n: w.battle!.turn, hits: report.hits, taken: report.hitsTaken, hull: w.battle!.ships[0].damage, theirs: w.battle!.ships[1].damage, plotter });
  }
  if (w.battle!.finished) settleBattle(w);
}

/** Whether the captain who engaged is at the helm to plot: aboard, connected, still the captain. */
function captainAtHelm(w: Work): boolean {
  const rec = lastBattle(w);
  const me = crewMember(w.ship, rec.captainId);
  return me !== null && me.awaySinceTurn === null && w.ship.captainId === rec.captainId;
}

/** The engaging captain left or lost the wheel: the ship breaks off, as the server cuts the fight short. */
function cutBattleIfCaptainGone(w: Work): void {
  if (!w.battle) return;
  const rec = lastBattle(w);
  if (crewMember(w.ship, rec.captainId) && w.ship.captainId === rec.captainId) return;
  pushBattleMove(w, { type: "end" });
  settleBattle(w);
}

/** True when the next step needs the tester's plot: a fight is on, the tester has the wheel and the captain is at the helm. */
export function needsPlot(sim: VoyageSim, wheel = sim.setup.wheel): boolean {
  if (sim.done || !sim.battle || sim.battle.finished || wheel !== "you") return false;
  const rec = sim.battles[sim.battles.length - 1]!;
  const me = crewMember(sim.ship, rec.captainId);
  return me !== null && me.awaySinceTurn === null && sim.ship.captainId === rec.captainId;
}

export interface StepInput {
  /** The tester's plot for this battle turn. Without one, the AI captain plots. */
  readonly plan?: BattlePlan | null;
}

/** One ship turn, in the server's order. A finished voyage is returned as it is. */
export function step(sim: VoyageSim, input: StepInput = {}): VoyageSim {
  if (sim.done) return sim;
  const w = work(sim);
  const turnNo = w.ship.turn + 1;
  const name = (i: number): string => w.setup.crew[i]!.pirateId;

  // 1. The script.
  for (const s of w.setup.script) {
    if (s.turn !== turnNo) continue;
    const who = name(s.who);
    if (s.action === "station") applyShip(w, { type: "station", pirateId: who, station: s.station }, { kind: "station", who });
    else applyShip(w, { type: s.action, pirateId: who }, { kind: s.action, who });
    cutBattleIfCaptainGone(w);
    if (w.done) return freeze(w);
  }

  // 2. The melee fights on.
  if (w.melee) fightMelee(w);

  // 3. The plot sails. A captain away leaves the fight waiting: nothing resolves, supplies pile up.
  if (w.battle && !w.battle.finished && captainAtHelm(w)) commit(w, input.plan ?? null);

  // 4. Duty points: everyone at a station, connected, not at the helm of a fight nor at the rail.
  if (w.ship.voyage) {
    const helm = w.battle ? lastBattle(w).captainId : null;
    w.setup.crew.forEach((c, i) => {
      const me = crewMember(w.ship, c.pirateId);
      if (!me || me.station === null || me.awaySinceTurn !== null || w.melee || c.pirateId === helm) return;
      const roll = nextInt(w.crewRng[i]!, 2 * c.spread + 1);
      w.crewRng[i] = roll.state;
      const percent = Math.max(0, c.duty - c.spread + roll.value);
      const points = Math.round((w.setup.ship.par[me.station] * percent) / 100);
      if (points <= 0) return;
      applyShip(w, { type: "duty", station: me.station, points });
    });
  }

  // 5. The ship turns.
  const phase: TurnSample["phase"] = w.melee ? "melee" : w.battle ? "battle" : "sailing";
  const brigandDamage = w.battle ? w.battle.ships[1].damage : null;
  const atSea = { water: w.ship.water, damage: w.ship.damage };
  applyShip(w, { type: "turn" });
  // In a fight, the purse weighs what each pirate's station gave the ship this turn, as the server does (ADR 0030).
  if (w.battle) {
    const rec = lastBattle(w);
    const dutyOutput = { ...rec.dutyOutput };
    for (const { pirateId, output } of turnBootyOutputs(w.ship)) dutyOutput[pirateId] = (dutyOutput[pirateId] ?? 0) + output;
    w.battles[w.battles.length - 1] = { ...rec, dutyOutput };
  }
  const r = w.ship.lastTurn;
  // Making port repairs the ship for the dock; the chart keeps the last readings at sea.
  const reading = w.phase === "arrived" ? atSea : { water: w.ship.water, damage: w.ship.damage };
  w.samples.push({
    turn: w.ship.turn,
    phase,
    outputs: r ? { ...r.outputs } : zeroOutputs(),
    held: r?.held ?? false,
    water: reading.water,
    damage: reading.damage,
    speed: r?.speed ?? 0,
    progress: w.phase === "arrived" ? 1000 : progressPermille(w.ship),
    loaded: w.ship.loaded,
    tokens: w.ship.tokens,
    brigandDamage,
  });
  cutBattleIfCaptainGone(w);
  if (w.done) return freeze(w);

  // 6. The board hears the ship's word.
  supply(w);

  // 7. A hail raised by this turn is answered before the next, if the captain is at the wheel and connected.
  answerHail(w);

  if (w.ship.voyage && w.ship.turn - w.ship.voyage.startedTurn >= w.setup.maxTurns) {
    note(w, "adrift", { turns: w.setup.maxTurns });
    w.phase = "adrift";
    w.done = true;
  }
  return freeze(w);
}

/** Sail on until the voyage ends, the tester's plot is needed, or `limit` turns pass. */
export function sailOn(sim: VoyageSim, opts: { readonly limit?: number; readonly stopForPlot?: boolean } = {}): VoyageSim {
  let s = sim;
  const limit = opts.limit ?? Infinity;
  for (let i = 0; i < limit && !s.done; i++) {
    if (opts.stopForPlot && needsPlot(s)) break;
    s = step(s);
  }
  return s;
}

/** Sail the whole voyage with the AI at the wheel. */
export function sailVoyage(setup: VoyageSetup): VoyageSim {
  return sailOn(startVoyage({ ...setup, wheel: "ai" }));
}

/** Every station's average output over the turns the ship was not held, percent of par. */
export function averageOutputs(samples: readonly TurnSample[]): Record<Station, number> {
  const out = zeroOutputs();
  const sailing = samples.filter((s) => !s.held);
  if (sailing.length === 0) return out;
  for (const st of STATIONS) out[st] = Math.round(sailing.reduce((n, s) => n + s.outputs[st], 0) / sailing.length);
  return out;
}
