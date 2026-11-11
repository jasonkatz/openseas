import type { RaiderTier } from "@openseas/content";
import {
  InvalidMoveError,
  MELEE_SIDE_MAX,
  createSwordfightGame,
  meleeAttackRate,
  meleePlunderOutput,
  reduceSwordfight,
  swordfightBoardLoad,
  swordfightBoardString,
  type ShipBattleOutcome,
  type SwordBoard,
  type SwordfightConfig,
  type SwordfightMove,
  type SwordfightState,
} from "@openseas/engine";
import type { MeleeBoardWire } from "@openseas/protocol";

/** How the airlock ends: the raider crew beaten, the pirates beaten, or the fight run out of time. */
export type MeleeOutcome = Extract<ShipBattleOutcome, "boarded" | "boarded_by" | "broke_off">;

/** Scrap the raider crew sent, as the move the pirate's board logs. Board 0 is the pirate's own. */
export type IncomingScrap = Extract<SwordfightMove, { type: "incoming" }>;

/** A pirate's board in the melee as the server holds it right now. */
export interface PirateBoard {
  /** The pirate's own fight as the server replayed it from their log. */
  readonly state: SwordfightState;
  /** Scrap announced to the board that it has not logged yet. */
  readonly announced: number;
  /** Whether the pirate is connected: scrap is announced only to a pirate who is there to log it. */
  readonly connected: boolean;
}

/** The pirates' boards in a melee, by pirate id: null for a board that is closed or gone. */
export type PirateBoards = (pirateId: string) => PirateBoard | null;

/** What the raider crew did when it caught up with the clock, for the ship to act on. */
export interface MeleeStep {
  /** Scrap the raider crew sent, each to the pirate it goes to, in the order sent: the ship vouches for it on their board. */
  readonly announce: ReadonlyArray<{ readonly pirateId: string; readonly move: IncomingScrap }>;
  /** Whether the raider crew's boards changed, so everyone aboard is shown the boards again. */
  readonly changed: boolean;
  /** The airlock's outcome once it is decided: the ship settles the melee. */
  readonly decided: MeleeOutcome | null;
}

/** What a melee opens with. */
export interface MeleeOpening {
  /** Swordfighting's rules from content: every board in the melee is dealt them. */
  readonly rules: SwordfightConfig;
  /** The raider tier at the airlock: its crew's hand, and its score factor on the pirates' attack rate. */
  readonly tier: Pick<RaiderTier, "id" | "scorePercent" | "swordsmen">;
  /** How many pirates are at the airlock, at least one: the raider crew has a board for each, up to eight. */
  readonly pirates: number;
  /** Seeds the raider crew's fight and names the deal every pirate's board is dealt from. */
  readonly seed: string;
  readonly now: number;
  /** What each pirate gave the ship in the space battle before the boarding, carried into the split (ADR 0030). */
  readonly dutyOutput: ReadonlyMap<string, number>;
  /** Space Battle turns fought before the boarding, for the log. */
  readonly turns: number;
}

/**
 * The boarding melee (M5, ADR 0022): the raider crew's fight, which no player is in, against one
 * fight per pirate, each on its own board. The melee holds the raider crew's fight and runs it on its
 * own clock, routes scrap between the two sides to the board with the least on it, decides the
 * airlock, and weighs each pirate's part in the plunder. It reads no session and sends nothing: the
 * ship deals the pirates' boards, shows the melee a view of them (`PirateBoards`), and does what each
 * call returns. Time is the `now` the ship passes in; the only randomness is the fight's own.
 */
export class Melee {
  /** Each pirate's own board, by pirate id: the id of the session it runs in, in the order dealt. */
  private readonly fightsByPirate = new Map<string, string>();
  /** The score of each pirate's board once it is over, for the plunder split. */
  private readonly scores = new Map<string, number>();
  private crewFight: SwordfightState;

  private constructor(
    readonly tierId: string,
    readonly seed: string,
    readonly startedAt: number,
    /** The fight's last tick: the airlock is broken off when the clock reaches it. */
    readonly deadlineAt: number,
    /** The config every pirate's own board is dealt: content's rules with nobody else in the fight, and the tier's score factor. */
    readonly boardConfig: SwordfightConfig,
    crew: SwordfightState,
    private readonly dutyOutput: ReadonlyMap<string, number>,
    /** Space Battle turns fought before the boarding, for the log. */
    readonly turns: number,
  ) {
    this.crewFight = crew;
  }

  /**
   * Grappling hooks are over: the raider crew gets one board per pirate at the airlock, up to eight,
   * each with the tier's hand. Each pirate's own board shares the melee's deal, and its foes are
   * outside it (ADR 0022).
   */
  static open(o: MeleeOpening): Melee {
    const crew: SwordfightConfig = { ...o.rules, player: false, blade: 0, allies: Array.from({ length: Math.min(o.pirates, MELEE_SIDE_MAX) }, () => ({ ...o.tier.swordsmen })), foes: [] };
    const board: SwordfightConfig = { ...o.rules, player: true, allies: [], foes: [], dealSeed: o.seed, scorePercent: o.tier.scorePercent };
    return new Melee(o.tier.id, o.seed, o.now, o.now + o.rules.maxTick * o.rules.tickMs, board, createSwordfightGame(o.seed, crew), new Map(o.dutyOutput), o.turns);
  }

  /** The raider crew's fight: one AI board per pirate at the airlock, no player in it. */
  get crew(): SwordfightState {
    return this.crewFight;
  }

  /** Each pirate's board still in the melee, by pirate id: the id of the session it runs in. */
  get fights(): ReadonlyMap<string, string> {
    return this.fightsByPirate;
  }

  /** How long a board dealt now has to run: until the fight's last tick, and never less than ten seconds. */
  roundMs(now: number): number {
    return Math.max(10_000, this.deadlineAt - now);
  }

  /** Whether a pirate may be dealt a board: a board already fought in this melee is the pirate's one board in it. */
  mayDeal(pirateId: string): boolean {
    return !this.scores.has(pirateId);
  }

  /** A pirate was dealt their board, which runs in this session. */
  dealt(pirateId: string, sessionId: string): void {
    this.fightsByPirate.set(pirateId, sessionId);
  }

  /**
   * The raider crew's fight catches up with the clock. Each batch of scrap it sends goes to the
   * connected pirate with the least on their board, counting scrap announced and not yet logged,
   * this step's included. Once the clock reaches the fight's last tick nothing moves, and the airlock
   * is broken off.
   */
  advance(now: number, boards: PirateBoards): MeleeStep {
    if (now >= this.deadlineAt) return { announce: [], changed: false, decided: "broke_off" };
    const announce: Array<{ pirateId: string; move: IncomingScrap }> = [];
    let changed = false;
    const tick = this.crewTick(now);
    if (tick > this.crewFight.tick && !this.crewFight.finished) {
      this.crewFight = reduceSwordfight(this.crewFight, { type: "wait", tick });
      const events = this.crewFight.lastMove?.events ?? [];
      for (const e of events) {
        if (e.type !== "attack" || e.to !== -1 || e.scrap <= 0) continue;
        const pirateId = this.leastLoaded(boards, announce);
        // The tick is when the raider crew sent it; the board logs the scrap at its own.
        if (pirateId !== null) announce.push({ pirateId, move: { type: "incoming", board: 0, scrap: e.scrap, blade: e.blade, tick } });
      }
      changed = events.length > 0;
    }
    return { announce, changed, decided: this.decide(boards) };
  }

  /**
   * A pirate's board took a move: the scrap it sent out of its fight goes to the raider crew. Returns
   * whether the move changed the board, so everyone aboard is shown the boards again.
   */
  pirateMoved(now: number, board: SwordfightState): boolean {
    const events = board.lastMove?.events ?? [];
    for (const e of events) if (e.type === "attack" && e.board === 0 && e.to === -1 && e.scrap > 0) this.pirateSent(now, e.scrap, e.blade);
    return events.length > 0;
  }

  /** Scrap from a pirate's board lands on the raider board with the least on it, at the raider crew's clock. */
  pirateSent(now: number, scrap: number, blade: number): void {
    const crew = this.crewFight;
    if (crew.finished) return;
    let target = -1;
    let bestLoad = Infinity;
    crew.boards.forEach((b, i) => {
      if (b.out) return;
      const load = swordfightBoardLoad(b);
      if (load < bestLoad) {
        target = i;
        bestLoad = load;
      }
    });
    if (target < 0) return;
    const tick = Math.max(crew.tick, this.crewTick(now));
    try {
      this.crewFight = reduceSwordfight(crew, { type: "incoming", board: target, scrap: Math.min(999, scrap), blade, tick });
    } catch (e) {
      if (!(e instanceof InvalidMoveError)) throw e;
    }
  }

  /** A pirate's board is over, however it ended: its score is kept for the split, and it is out of the melee. */
  pirateEnded(pirateId: string, score: number): void {
    this.scores.set(pirateId, score);
    this.fightsByPirate.delete(pirateId);
  }

  /** The airlock is won when every raider board is out, and lost when no pirate's board is standing. */
  decide(boards: PirateBoards): MeleeOutcome | null {
    if (this.crewFight.finished) return "boarded";
    for (const pirateId of this.fightsByPirate.keys()) {
      const b = boards(pirateId);
      if (b && !b.state.boards[0]!.out) return null;
    }
    return "boarded_by";
  }

  /** The tick a pirate's board is told the raider crew is beaten: the raider crew's clock, or the board's own if it is later. */
  overTick(now: number, board: SwordfightState): number {
    return Math.max(this.crewTick(now), board.tick);
  }

  /**
   * Each crew member's weight in the plunder split (ADR 0030): what they gave the ship in the space
   * battle, plus, for a pirate whose board here is over, the melee as duty turns at their attack a
   * minute against Swordfight's par, once for every ship's turn the melee lasted.
   */
  points(crewIds: readonly string[], now: number, par: { readonly parRatePerMinute: number; readonly turnSeconds: number }): Map<string, number> {
    const meleeMs = now - this.startedAt;
    const points = new Map<string, number>();
    for (const id of crewIds) {
      const score = this.scores.get(id);
      const melee = score === undefined ? 0 : meleePlunderOutput(meleeAttackRate(this.boardConfig, score), par.parRatePerMinute, meleeMs, par.turnSeconds);
      points.set(id, (this.dutyOutput.get(id) ?? 0) + melee);
    }
    return points;
  }

  /** Every board in the melee as everyone aboard is shown it: each pirate's still open, in the order dealt, then the raider crew's. */
  wire(boards: PirateBoards, nameOf: (pirateId: string) => string): MeleeBoardWire[] {
    const out: MeleeBoardWire[] = [];
    for (const pirateId of this.fightsByPirate.keys()) {
      const b = boards(pirateId);
      if (!b) continue;
      const own = b.state.boards[0]!;
      out.push({ pirateId, name: nameOf(pirateId), side: 0, cells: swordfightBoardString(b.state.config, own.cells), pending: waiting(own) + b.announced, out: own.out, points: own.points });
    }
    for (const r of this.crewFight.boards) {
      out.push({ pirateId: null, name: "", side: 1, cells: swordfightBoardString(this.crewFight.config, r.cells), pending: waiting(r), out: r.out, points: r.points });
    }
    return out;
  }

  /** The raider crew's clock: ticks since the melee opened, on the fight's tick, up to its last. */
  private crewTick(now: number): number {
    const config = this.crewFight.config;
    return Math.max(0, Math.min(config.maxTick, Math.floor((now - this.startedAt) / config.tickMs)));
  }

  /** The connected pirate whose standing board has the least on it, counting what this step already announced; the first dealt wins a tie. */
  private leastLoaded(boards: PirateBoards, announced: ReadonlyArray<{ pirateId: string; move: IncomingScrap }>): string | null {
    let best: string | null = null;
    let bestLoad = Infinity;
    for (const pirateId of this.fightsByPirate.keys()) {
      const b = boards(pirateId);
      if (!b || !b.connected) continue;
      const own = b.state.boards[0]!;
      if (own.out || b.state.finished) continue;
      let load = swordfightBoardLoad(own) + b.announced;
      for (const a of announced) if (a.pirateId === pirateId) load += a.move.scrap;
      if (load < bestLoad) {
        best = pirateId;
        bestLoad = load;
      }
    }
    return best;
  }
}

/** Scrap waiting to land on a board. */
function waiting(board: SwordBoard): number {
  return board.pending.reduce((n, p) => n + p.scrap, 0);
}
