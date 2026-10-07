import { randomBytes, randomUUID } from "node:crypto";
import type { Content } from "@openseas/content";
import type { BilgingMove, PuzzleId } from "@openseas/engine";
import type { ClientMetrics, PuzzleResult, PuzzleStarted, ServerMessage } from "@openseas/protocol";
import { schema, type Db } from "../db/index.js";
import { recordEvent } from "../events.js";
import type { Logger } from "../log.js";
import { rateDutyRound } from "../ratings.js";
import { PuzzleSessionManager, type PuzzleSession, type RejectReason } from "./sessions.js";

const GRACE_MS = 5_000;

/** Coordinates the in-memory session manager with persistence. One instance per process. */
export class PuzzleService {
  readonly sessions: PuzzleSessionManager;

  constructor(
    private readonly db: Db,
    private readonly content: Content,
    private readonly log: Logger,
    now: () => number = Date.now,
  ) {
    const bilging = content.puzzles.bilging;
    this.sessions = new PuzzleSessionManager({
      graceMs: GRACE_MS,
      roundMs: bilging.roundSeconds * 1000,
      config: bilging.config,
      now,
      randomSeed: () => randomBytes(16).toString("hex"),
      randomId: () => randomUUID(),
    });
  }

  start(pirateId: string, puzzle: PuzzleId): PuzzleStarted {
    const s = this.sessions.start(pirateId, puzzle);
    void recordEvent(this.db, pirateId, "puzzle.started", { puzzle, sessionId: s.id }).catch((e) =>
      this.log.warn({ err: e }, "event write failed"),
    );
    return {
      type: "puzzle.started",
      sessionId: s.id,
      puzzle,
      seed: s.seed,
      config: s.config,
      deadlineAt: s.deadlineAt,
      serverNow: s.startedAt,
    };
  }

  /** Returns the message to send back, if any. */
  async move(session: PuzzleSession, seq: number, move: BilgingMove, hash: string): Promise<ServerMessage | null> {
    const r = this.sessions.move(session, seq, move, hash);
    if (r.ok) return null;
    await this.persistRejected(session, r.reason, null);
    return { type: "puzzle.rejected", sessionId: session.id, reason: r.reason, atSeq: r.atSeq };
  }

  async finish(session: PuzzleSession, hash: string | null, metrics: ClientMetrics | null): Promise<ServerMessage> {
    const r = this.sessions.finish(session, hash);
    if (!r.ok) {
      await this.persistRejected(session, r.reason, metrics);
      return { type: "puzzle.rejected", sessionId: session.id, reason: r.reason };
    }
    const result = await this.db.transaction(async (tx) => {
      const rating = await rateDutyRound(tx, this.content, session.pirateId, session.puzzle, r.summary.score);
      await tx.insert(schema.puzzleRound).values({
        id: session.id,
        pirateId: session.pirateId,
        puzzle: session.puzzle,
        seed: session.seed,
        score: r.summary.score,
        moves: r.summary.moves,
        bestCombo: r.summary.bestCombo,
        rejectedReason: null,
        moveLog: r.moves as unknown[],
        metrics: metrics ?? null,
        startedAt: new Date(session.startedAt),
      });
      await recordEvent(tx, session.pirateId, "puzzle.completed", {
        puzzle: session.puzzle,
        sessionId: session.id,
        score: r.summary.score,
        moves: r.summary.moves,
        ratingBefore: rating.before.rating,
        ratingAfter: rating.after.rating,
        ...(metrics ? { metrics } : {}),
      });
      const msg: PuzzleResult = {
        type: "puzzle.result",
        sessionId: session.id,
        score: r.summary.score,
        moves: r.summary.moves,
        bestCombo: r.summary.bestCombo,
        verified: true,
        rating: rating.view,
        tierChange: rating.tierChange,
      };
      return msg;
    });
    this.log.info({ pirateId: session.pirateId, score: result.score, moves: result.moves }, "round scored");
    return result;
  }

  async abandon(session: PuzzleSession): Promise<void> {
    this.sessions.close(session);
    await this.persistRejected(session, "deadline", null);
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
    this.log.warn({ pirateId: session.pirateId, sessionId: session.id, reason }, "round rejected");
    try {
      await this.db.insert(schema.puzzleRound).values({
        id: session.id,
        pirateId: session.pirateId,
        puzzle: session.puzzle,
        seed: session.seed,
        score: session.state.score,
        moves: session.moves.length,
        bestCombo: session.state.bestCombo,
        rejectedReason: reason,
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
