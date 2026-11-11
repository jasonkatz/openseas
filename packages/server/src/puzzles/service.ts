import { randomBytes, randomUUID } from "node:crypto";
import type { Content } from "@openseas/content";
import { PUZZLE_IDS, parPerTurn, type BattleMove, type CoolingMove, type PuzzleId, type SwordfightMove } from "@openseas/engine";
import { parseMoveFor, type ClientMetrics, type PuzzleIdWire, type PuzzleResult, type PuzzleStarted, type RejectReasonWire, type ServerMessage } from "@openseas/protocol";
import { schema, type Db } from "../db/index.js";
import { recordEvent } from "../events.js";
import type { Logger } from "../log.js";
import type { Presence } from "../presence.js";
import { rateDutyRound, roundPerformance } from "../ratings.js";
import { bindingPolicy } from "./binding.js";
import { PuzzleSessionManager, type PuzzleRoundOptions, type PuzzleSession, type RejectReason, type SessionStart } from "./sessions.js";

// The protocol's puzzle ids and the engine's must be the same set. If this stops compiling, they drifted.
const _idCheck: (p: PuzzleIdWire) => PuzzleId = (p) => p;
const _idCheckBack: (p: PuzzleId) => PuzzleIdWire = (p) => p;
void _idCheck;
void _idCheckBack;
// So must the reasons a round is refused for.
const _reasonCheck: (r: RejectReasonWire) => RejectReason = (r) => r;
const _reasonCheckBack: (r: RejectReason) => RejectReasonWire = (r) => r;
void _reasonCheck;
void _reasonCheckBack;

const GRACE_MS = 5_000;

/** The message that tells a board's pirate what the server vouched for, which the board then logs as a move. */
function vouchedMessage(session: PuzzleSession, vouched: unknown): ServerMessage {
  const move = vouched as CoolingMove | BattleMove | SwordfightMove;
  const sessionId = session.id;
  switch (move.type) {
    case "heat":
      return { type: "duty.heat", sessionId, row: move.row };
    case "supply":
      return { type: "battle.supply", sessionId, left: move.left, forward: move.forward, right: move.right, turrets: move.turrets, hull: move.hull };
    case "incoming": {
      const binding = session.binding;
      if (binding.kind !== "melee") throw new Error("only a melee board is sent scrap");
      return { type: "melee.incoming", sessionId, scrap: move.scrap, blade: move.blade, from: binding.tierId };
    }
    default:
      throw new Error(`no message vouches for a ${move.type} move`);
  }
}

/** How a board ended: scored, thrown out, or abandoned. */
export type BoardEnd = "finished" | "rejected" | "abandoned";

/**
 * Who a board reports to, given when it is dealt: the ship it is played aboard, bound to its room and
 * the board's role there (a duty station, the captain's battle, a fighter in the melee). A practice
 * round has none. The puzzle service calls it; nothing in the service asks what the board is played
 * for to decide who hears. What the server tells the board's pirate is not the host's: it goes to
 * the pirate's line (Presence), whoever the host is.
 */
export interface BoardHost {
  /** The board took a move the server accepted. */
  moved?(session: PuzzleSession): void;
  /**
   * The board is being scored, thrown out, abandoned or cut short. Called before its session closes,
   * so nothing else can find it closed yet and its last points are still the board's. A move the
   * server refused has closed it already; this follows at once, before anything is stored.
   */
  closing?(session: PuzzleSession): void;
  /**
   * The board was scored, thrown out or abandoned. Called after its session closed and its round was
   * stored, with the result its pirate is owed, if any, and before the pirate is told it. A board
   * dropped untouched has no end to tell.
   */
  ended?(session: PuzzleSession, how: BoardEnd, result: ServerMessage | null): void;
}

/** How a board is dealt: what it is played for, the ship's own config where a board aboard needs one, and the host it reports to. */
export interface BoardStart extends SessionStart {
  readonly host?: BoardHost;
}

/**
 * Coordinates the in-memory session manager with persistence, and tells each board's pirate what
 * the server says to the board: what it vouched for, the board handed back, how the round ended.
 * A pirate has one round open at a time, whatever it is played for: dealing them another quits the
 * one they have open. One instance per process.
 */
export class PuzzleService {
  readonly sessions: PuzzleSessionManager;
  /** Each board's host, from its deal, until the board is detached. */
  private readonly hosts = new WeakMap<PuzzleSession, BoardHost>();

  constructor(
    private readonly db: Db,
    private readonly content: Content,
    private readonly log: Logger,
    private readonly presence: Presence,
    now: () => number = Date.now,
  ) {
    const puzzles = {} as Record<PuzzleId, PuzzleRoundOptions>;
    for (const id of PUZZLE_IDS) {
      const c = content.puzzles[id];
      puzzles[id] = { roundMs: c.roundSeconds * 1000, config: c.config };
    }
    this.sessions = new PuzzleSessionManager({
      graceMs: GRACE_MS,
      puzzles,
      now,
      randomSeed: () => randomBytes(16).toString("hex"),
      randomId: () => randomUUID(),
      soloHeat: { rules: content.world.ship, par: parPerTurn(content.world.ship, content.puzzles.cooling) },
    });
  }

  /** Once a second: turn the lone ships of harness Cooling rounds that are due, and tell their pirates what moved. */
  tick(): void {
    for (const { session, row } of this.sessions.turnSoloHeat()) this.tell(session, vouchedMessage(session, { type: "heat", row }));
  }

  /**
   * Deal a round to the host it reports to, and return the deal for the caller to send. Its binding
   * says what it is played for; aboard, for the battle and a melee board, `override` gives the ship's
   * own config (the tier, the guns, the ship's turn). The pirate's open round, whatever it is played
   * for, is quit first (`quit`), so whatever it ends with reaches them before this deal does.
   */
  async start(pirateId: string, puzzle: PuzzleId, opts: BoardStart): Promise<PuzzleStarted> {
    await this.quitOpenRound(pirateId);
    const s = this.sessions.start(pirateId, puzzle, opts);
    if (opts.host) this.hosts.set(s, opts.host);
    void recordEvent(this.db, pirateId, "puzzle.started", { puzzle, sessionId: s.id, ...bindingPolicy(s.binding).startedEvent }).catch((e) =>
      this.log.warn({ err: e }, "event write failed"),
    );
    return this.startedMessage(s);
  }

  /**
   * The pirate quits the round they have open, if any: abandons it, or at a station cuts it short
   * (`quit`). `start` does this itself; a caller that reads the ship before it deals (the captain's
   * guns, a station's heat) calls it first, so the old board's last points are in what it reads.
   */
  async quitOpenRound(pirateId: string): Promise<void> {
    // Quitting closes a round before anything it awaits, so this ends; a round dealt to the pirate
    // meanwhile is quit in its turn.
    for (let open = this.sessions.openFor(pirateId); open; open = this.sessions.openFor(pirateId)) await this.quit(open);
  }

  /**
   * The host stops hearing the board: no more of its moves, its closing or its end reach it, whatever
   * becomes of the board now. Its pirate still hears what the server tells the board. The ship
   * detaches a board before it cuts it short on its own terms (a station it ends, a fight it
   * settles), so the board's own end decides nothing aboard.
   */
  detach(session: PuzzleSession): void {
    this.hosts.delete(session);
  }

  /** The server's word on a melee board (ADR 0022): the end move, written into the log here, then the round scored and its pirate told. */
  async endMelee(session: PuzzleSession, won: boolean, tick: number): Promise<void> {
    if (session.closed) return;
    this.sessions.inject(session, { type: "end", won, tick });
    await this.finish(session, null, null);
  }

  /** The deal as the client sees it; with `resume`, a ship's board handed back (the battle or a melee board) with every move logged. */
  startedMessage(s: PuzzleSession, resume = false): PuzzleStarted {
    // The config came from content (or the ship's override) for this puzzle, so it matches the wire variant for `puzzle`.
    return {
      type: "puzzle.started",
      sessionId: s.id,
      puzzle: s.puzzle,
      seed: s.seed,
      config: s.config,
      deadlineAt: s.deadlineAt,
      serverNow: s.startedAt,
      ...bindingPolicy(s.binding).wire,
      ...(resume ? { resume: { moves: s.moves } } : {}),
    } as PuzzleStarted;
  }

  /**
   * Vouch for a move on a board (ADR 0042): the ship's heat, the battle's supply, a melee's incoming
   * scrap. The board may now log it, and its pirate is told to, unless it is no news to the board
   * (the heat it already has).
   */
  vouch(session: PuzzleSession, move: CoolingMove | BattleMove | SwordfightMove): void {
    const message = vouchedMessage(session, move);
    if (session.vouched.vouch(move)) this.tell(session, message);
  }

  /**
   * The board as the server holds it, for its pirate to rebuild (ADR 0024): the deal with every move
   * logged, then every move the server vouched for that the board has not logged. Sent on reconnect,
   * on a `melee.join` for a board still held, and after a missing move.
   */
  handBack(session: PuzzleSession): ServerMessage[] {
    return [this.startedMessage(session, true), ...session.vouched.pending().map((m) => vouchedMessage(session, m))];
  }

  /**
   * A move from the board's pirate. `move` is any puzzle's move; it is narrowed here. A missing move
   * on a ship's board gets the board handed back (ADR 0024); a move the server refuses throws the
   * round out, and the pirate is told.
   */
  async move(session: PuzzleSession, seq: number, move: unknown, hash: string): Promise<void> {
    const parsed = parseMoveFor(session.puzzle, move);
    const expected = session.moves.length;
    const r = parsed === null ? this.sessions.move(session, seq, { type: "__not_a_move__" }, hash) : this.sessions.move(session, seq, parsed, hash);
    if (r.ok === "resync") {
      if (r.handBack) {
        this.log.warn({ pirateId: session.pirateId, sessionId: session.id, puzzle: session.puzzle, seq, expected, resyncs: session.resyncs }, "board handed back after a missing move");
        for (const m of this.handBack(session)) this.tell(session, m);
      }
      return;
    }
    if (r.ok) {
      this.hosts.get(session)?.moved?.(session);
      return;
    }
    // The bad move closed the board; its host hears it closing before anything is stored, so a
    // duty board still feeds the ship what it had earned before the bad move.
    this.hosts.get(session)?.closing?.(session);
    await this.persistRejected(session, r.reason, null, { seq, expected });
    this.ended(session, "rejected", { type: "puzzle.rejected", sessionId: session.id, reason: r.reason, atSeq: r.atSeq });
  }

  /**
   * Score a round and tell its pirate the result, which is returned for the caller to read. Standing
   * is earned in the game only (ADR 0028): the captain's space battle and a melee board always move
   * it, a duty board only when it ran its full clock or the engine ended it (a board cut short by
   * docking counts but moves no standing), and a harness round never does. Every scored round gets
   * its own performance rating against the thresholds.
   */
  finish(session: PuzzleSession, hash: string | null, metrics: ClientMetrics | null): Promise<ServerMessage> {
    return this.score(session, hash, metrics, true);
  }

  /** `finish`, telling the pirate the result only when `tell` says so. */
  private async score(session: PuzzleSession, hash: string | null, metrics: ClientMetrics | null, tell: boolean): Promise<ServerMessage> {
    const policy = bindingPolicy(session.binding);
    const rated = policy.rated === "always" || (policy.rated === "ran_full" && this.sessions.ranFull(session));
    this.closing(session);
    const r = this.sessions.finish(session, hash);
    if (!r.ok) {
      await this.persistRejected(session, r.reason, metrics);
      const rejected: ServerMessage = { type: "puzzle.rejected", sessionId: session.id, reason: r.reason };
      this.ended(session, "rejected", rejected, tell);
      return rejected;
    }
    const performance = roundPerformance(this.content, session.puzzle, r.summary.score);
    const result = await this.db.transaction(async (tx) => {
      const rating = rated ? await rateDutyRound(tx, this.content, session.pirateId, session.puzzle, r.summary.score) : null;
      await tx.insert(schema.puzzleRound).values({
        id: session.id,
        pirateId: session.pirateId,
        puzzle: session.puzzle,
        seed: session.seed,
        score: r.summary.score,
        moves: r.summary.moves,
        bestCombo: r.summary.bestCombo,
        rejectedReason: null,
        voyageId: policy.voyageId,
        rated,
        performance: performance.rating,
        moveLog: r.moves as unknown[],
        metrics: metrics ?? null,
        startedAt: new Date(session.startedAt),
      });
      await recordEvent(tx, session.pirateId, "puzzle.completed", {
        puzzle: session.puzzle,
        sessionId: session.id,
        score: r.summary.score,
        moves: r.summary.moves,
        rated,
        performance: performance.rating,
        ...policy.completedEvent,
        ...(rating ? { ratingBefore: rating.before.rating, ratingAfter: rating.after.rating } : {}),
        ...(metrics ? { metrics } : {}),
      });
      const msg: PuzzleResult = {
        type: "puzzle.result",
        sessionId: session.id,
        score: r.summary.score,
        moves: r.summary.moves,
        bestCombo: r.summary.bestCombo,
        verified: true,
        rating: rating ? rating.view : null,
        tierChange: rating ? rating.tierChange : null,
        performance,
      };
      return msg;
    });
    this.log.info({ pirateId: session.pirateId, puzzle: session.puzzle, score: result.score, moves: result.moves, rated }, "round scored");
    this.ended(session, "finished", result, tell);
    return result;
  }

  /**
   * The pirate quit a round: abandoned it, or started another. A duty board is cut short and counts,
   * and its pirate is told the result; any other round is abandoned.
   */
  async quit(session: PuzzleSession): Promise<void> {
    if (bindingPolicy(session.binding).quit === "cut_short") await this.cutShort(session);
    else await this.abandon(session);
  }

  async abandon(session: PuzzleSession): Promise<void> {
    this.closing(session);
    this.sessions.close(session);
    await this.persistRejected(session, "deadline", null);
    this.ended(session, "abandoned", null);
  }

  /**
   * End a duty board early (the ship docked, the pirate stood down or dropped). A board with moves
   * counts, unrated, and its pirate is told the result; an untouched one is dropped.
   */
  async cutShort(session: PuzzleSession): Promise<void> {
    if (session.closed) return;
    if (session.moves.length === 0) {
      this.closing(session);
      this.sessions.close(session);
      return;
    }
    await this.finish(session, null, null);
  }

  /** Say something to the board's pirate, on their line, whoever the board's host is. */
  private tell(session: PuzzleSession, message: ServerMessage): void {
    this.presence.send(session.pirateId, message);
  }

  /** The board is about to close: its host hears it while the board is still open. */
  private closing(session: PuzzleSession): void {
    if (!session.closed) this.hosts.get(session)?.closing?.(session);
  }

  /**
   * The board is over and closed: its host hears how, then its pirate hears the result they are owed.
   * In that order: a melee board's end shows the melee's boards (and may settle the airlock) before
   * its pirate sees the result.
   */
  private ended(session: PuzzleSession, how: BoardEnd, result: ServerMessage | null, tell = true): void {
    this.hosts.get(session)?.ended?.(session, how, result);
    if (result && tell) this.tell(session, result);
  }

  /**
   * Score rounds whose clock ran out without a finish message (the player closed the tab). Rounds
   * with moves count, with what the server received; empty rounds are dropped. Nobody is told.
   */
  async sweep(): Promise<void> {
    for (const s of this.sessions.expired()) {
      try {
        if (s.moves.length === 0) {
          this.sessions.close(s);
          continue;
        }
        await this.score(s, null, null, false);
      } catch (e) {
        this.log.error({ err: e, sessionId: s.id }, "sweep failed");
        this.sessions.close(s);
      }
    }
  }

  /** `at`: for a rejected move, the number it carried and the number the server was waiting for. */
  private async persistRejected(session: PuzzleSession, reason: RejectReason, metrics: ClientMetrics | null, at?: { seq: number; expected: number }): Promise<void> {
    this.log.warn({ pirateId: session.pirateId, sessionId: session.id, puzzle: session.puzzle, reason, ...at }, "round rejected");
    const summary = session.def.summarize(session.state);
    try {
      await this.db.insert(schema.puzzleRound).values({
        id: session.id,
        pirateId: session.pirateId,
        puzzle: session.puzzle,
        seed: session.seed,
        score: summary.score,
        moves: session.moves.length,
        bestCombo: summary.bestCombo,
        rejectedReason: reason,
        voyageId: bindingPolicy(session.binding).voyageId,
        rated: false,
        moveLog: session.moves as unknown[],
        metrics: metrics ?? null,
        startedAt: new Date(session.startedAt),
      });
      await recordEvent(this.db, session.pirateId, "puzzle.rejected", { puzzle: session.puzzle, sessionId: session.id, reason });
    } catch (e) {
      this.log.error({ err: e }, "failed to persist rejected round");
    }
  }
}
