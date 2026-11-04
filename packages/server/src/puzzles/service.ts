import { randomBytes, randomUUID } from "node:crypto";
import type { Content } from "@openseas/content";
import { PUZZLE_IDS, type PuzzleId } from "@openseas/engine";
import { parseMoveFor, type ClientMetrics, type PuzzleIdWire, type PuzzleResult, type PuzzleStarted, type ServerMessage } from "@openseas/protocol";
import { schema, type Db } from "../db/index.js";
import { recordEvent } from "../events.js";
import type { Logger } from "../log.js";
import { rateDutyRound } from "../ratings.js";
import { PuzzleSessionManager, type DutyBinding, type PuzzleRoundOptions, type PuzzleSession, type RejectReason } from "./sessions.js";

// The protocol's puzzle ids and the engine's must be the same set. If this stops compiling, they drifted.
const _idCheck: (p: PuzzleIdWire) => PuzzleId = (p) => p;
const _idCheckBack: (p: PuzzleId) => PuzzleIdWire = (p) => p;
void _idCheck;
void _idCheckBack;

const GRACE_MS = 5_000;

/** Coordinates the in-memory session manager with persistence. One instance per process. */
export class PuzzleService {
  readonly sessions: PuzzleSessionManager;
  /**
   * Called once for every duty session as it ends, before it is closed, so the ship can take the
   * board's last points. Set by the ship service.
   */
  onDutyEnd: ((session: PuzzleSession) => void) | null = null;

  constructor(
    private readonly db: Db,
    private readonly content: Content,
    private readonly log: Logger,
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
    });
  }

  start(pirateId: string, puzzle: PuzzleId, duty: DutyBinding | null = null): PuzzleStarted {
    const s = this.sessions.start(pirateId, puzzle, duty);
    void recordEvent(this.db, pirateId, "puzzle.started", { puzzle, sessionId: s.id, ...(duty ? { voyageId: duty.voyageId } : {}) }).catch((e) =>
      this.log.warn({ err: e }, "event write failed"),
    );
    // The config came from content for this puzzle, so it matches the wire variant for `puzzle`.
    return {
      type: "puzzle.started",
      sessionId: s.id,
      puzzle,
      seed: s.seed,
      config: s.config,
      deadlineAt: s.deadlineAt,
      serverNow: s.startedAt,
      ...(duty ? { duty: { shipId: duty.shipId, station: duty.station, ...(duty.water !== undefined ? { water: duty.water } : {}) } } : {}),
    } as PuzzleStarted;
  }

  /** Returns the message to send back, if any. `move` is any puzzle's move; it is narrowed here. */
  async move(session: PuzzleSession, seq: number, move: unknown, hash: string): Promise<ServerMessage | null> {
    const parsed = parseMoveFor(session.puzzle, move);
    const r = parsed === null ? this.sessions.move(session, seq, { type: "__not_a_move__" }, hash) : this.sessions.move(session, seq, parsed, hash);
    if (r.ok) return null;
    // A rejected duty board still fed the ship what it had earned before the bad move.
    if (session.duty) this.onDutyEnd?.(session);
    await this.persistRejected(session, r.reason, null);
    return { type: "puzzle.rejected", sessionId: session.id, reason: r.reason, atSeq: r.atSeq };
  }

  /**
   * Score a round. A practice round is always rated; a duty board only when it ran its full clock
   * or the engine ended it, so a board cut short by docking counts but moves no rating.
   */
  async finish(session: PuzzleSession, hash: string | null, metrics: ClientMetrics | null): Promise<ServerMessage> {
    const rated = session.duty === null || this.sessions.ranFull(session);
    this.endDuty(session);
    const r = this.sessions.finish(session, hash);
    if (!r.ok) {
      await this.persistRejected(session, r.reason, metrics);
      return { type: "puzzle.rejected", sessionId: session.id, reason: r.reason };
    }
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
        voyageId: session.duty?.voyageId ?? null,
        rated,
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
        ...(session.duty ? { voyageId: session.duty.voyageId, shipId: session.duty.shipId } : {}),
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
      };
      return msg;
    });
    this.log.info({ pirateId: session.pirateId, puzzle: session.puzzle, score: result.score, moves: result.moves, rated }, "round scored");
    return result;
  }

  async abandon(session: PuzzleSession): Promise<void> {
    this.endDuty(session);
    this.sessions.close(session);
    await this.persistRejected(session, "deadline", null);
  }

  /**
   * End a duty board early (the ship docked, the pirate stood down or dropped). A board with moves
   * counts, unrated; an untouched one is dropped. Returns the result to send, if any.
   */
  async cutShort(session: PuzzleSession): Promise<ServerMessage | null> {
    if (session.closed) return null;
    if (session.moves.length === 0) {
      this.endDuty(session);
      this.sessions.close(session);
      return null;
    }
    return this.finish(session, null, null);
  }

  private endDuty(session: PuzzleSession): void {
    if (session.duty && !session.closed) this.onDutyEnd?.(session);
  }

  /**
   * Score rounds whose clock ran out without a finish message (the player closed the tab). Rounds
   * with moves count, with what the server received; empty rounds are dropped.
   */
  async sweep(): Promise<void> {
    for (const s of this.sessions.expired()) {
      try {
        if (s.moves.length === 0) {
          this.sessions.close(s);
          continue;
        }
        await this.finish(s, null, null);
      } catch (e) {
        this.log.error({ err: e, sessionId: s.id }, "sweep failed");
        this.sessions.close(s);
      }
    }
  }

  private async persistRejected(session: PuzzleSession, reason: RejectReason, metrics: ClientMetrics | null): Promise<void> {
    this.log.warn({ pirateId: session.pirateId, sessionId: session.id, puzzle: session.puzzle, reason }, "round rejected");
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
        voyageId: session.duty?.voyageId ?? null,
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
