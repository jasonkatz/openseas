import type { PuzzleDef } from "@openseas/engine";
import type { ClientMessage, PuzzleResult, PuzzleStarted, ServerMessage } from "@openseas/protocol";
import { wallClock, type Clock } from "./clock.js";
import { PuzzleRound } from "./round.js";

/**
 * What a round needs of the connection to the server: send, hear, and read the server's clock as
 * this machine's. `GameSocket` is the applications' adapter; a test brings a fake one.
 */
export interface RoundSocket {
  send(msg: ClientMessage): boolean;
  onMessage(fn: (msg: ServerMessage) => void): () => void;
  /** A moment on the server's clock, as the same moment on this machine's clock. */
  toLocal(serverMs: number): number;
}

/**
 * Where a board stands: no round; asked the server for a deal; a round in play; finished here and
 * waiting for the server's verdict; the verdict in (or a local round over).
 */
export type RoundPhase = "idle" | "dealing" | "playing" | "waiting" | "result";

/** The server's verdict on a dealt round. */
export type RoundOutcome = { kind: "scored"; result: PuzzleResult } | { kind: "rejected"; reason: string };

/** A message the server sends about one dealt round, other than its deal and its verdict. */
export type RoundMessage = Exclude<Extract<ServerMessage, { sessionId: string }>, { type: "puzzle.started" | "puzzle.result" | "puzzle.rejected" }>;

/** What a board shows. A new object whenever any of it changes. */
export interface RoundView<S> {
  readonly phase: RoundPhase;
  /** The round's state, or the board shown between rounds. */
  readonly state: S;
  /** Bumps on every state change, so the same state object can be shown again after a reset. */
  readonly version: number;
  readonly outcome: RoundOutcome | null;
  /** Whole seconds to the deadline at the last clock reading; null when no round has run since the board was cleared. */
  readonly secondsLeft: number | null;
  /** True when the last round was rebuilt from moves the server already held (a reconnect or a hand-back). */
  readonly resumed: boolean;
}

/** A round the server did not deal: unrated, and nothing is sent. The caller picks its seed, config and clock. */
export interface LocalRound<C> {
  seed: string;
  config: C;
  roundMs: number;
  /** Default: the wall clock. */
  clock?: Clock;
}

export interface RoundSessionOptions<S, M, C> {
  def: PuzzleDef<S, M, C>;
  /** The board shown before the first round. */
  initial(): S;
  /** The clock dealt rounds run on. Default: the wall clock. */
  clock?: Clock;
  /**
   * Whether a deal is this board's. True plays it; false lets it pass (it is another board's);
   * "decline" answers the server with `puzzle.abandon` and plays nothing.
   */
  accepts(started: PuzzleStarted): boolean | "decline";
  /**
   * A message about the dealt round in play. Returns the move the server vouches for, which the
   * round logs and streams as the server's word, or null. It may instead settle the round itself
   * (`round.settleLocal`, for a move the server already logged) and return null.
   */
  inbound?(msg: RoundMessage, round: PuzzleRound<S, M, C>): M | null;
  /** A deal is in play. `handedBack` is true when it replaced the round of the same session (ADR 0024). */
  onDeal?(started: PuzzleStarted, round: PuzzleRound<S, M, C>, handedBack: boolean): void;
  /** Every applied move, with the new and the previous state. */
  onMove?(state: S, prev: S): void;
  /** The round in play finished: its clock ran out, the engine ended it, or the caller did. */
  onFinished?(state: S, rated: boolean): void;
  /** The server's verdict on the dealt round in play. */
  onVerdict?(outcome: RoundOutcome): void;
  /** Each new whole second left on the round in play, as `tick` reads it. */
  onSecond?(secondsLeft: number): void;
  /** The board was cleared: dropped, or dismissed. */
  onClear?(): void;
}

/**
 * The round a board plays, from the deal to the verdict (ADR 0003, ADR 0019). It takes the deals
 * the caller says are its own, on the server's time read as local time; builds the round and
 * streams its moves; logs the moves the server vouches for; takes the verdict for its session and
 * no other; rebuilds a board the server hands back without a word to the server (ADR 0024); and
 * finishes the round when its clock runs out. A board can also play a round the server did not
 * deal (`start`), which runs the same way and sends nothing.
 *
 * Owns no timer: whoever holds it calls `tick` while a round is in play. Computes nothing the
 * server does not recompute.
 */
export class RoundSession<S, M, C> {
  private round: PuzzleRound<S, M, C> | null = null;
  /** The session of the dealt round in play; null for a local round, and once the verdict is in. */
  private sessionId: string | null = null;
  private lastSecond = -1;
  private shown: RoundView<S>;
  private readonly listeners = new Set<(view: RoundView<S>) => void>();

  constructor(
    private readonly socket: RoundSocket,
    private options: RoundSessionOptions<S, M, C>,
  ) {
    this.shown = { phase: "idle", state: options.initial(), version: 0, outcome: null, secondsLeft: null, resumed: false };
  }

  get view(): RoundView<S> {
    return this.shown;
  }

  /** Replace the options; the callbacks given here are the ones called from now on. */
  configure(options: RoundSessionOptions<S, M, C>): void {
    this.options = options;
  }

  subscribe(fn: (view: RoundView<S>) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Hear the server. The returned detach stops listening and abandons the round in play. */
  attach(): () => void {
    const off = this.socket.onMessage((m) => this.receive(m));
    return () => {
      off();
      this.round?.abandon();
    };
  }

  /** The round in play or last played, for engine queries; null when there is none. */
  current(): PuzzleRound<S, M, C> | null {
    return this.round;
  }

  /** Apply a player move. False when there is no round or the engine refused it. */
  apply(move: M, countsAsInput = true): boolean {
    return this.round !== null && this.round.apply(move, countsAsInput) !== null;
  }

  canApply(move: M): boolean {
    return this.round?.canApply(move) ?? false;
  }

  markRendered(): void {
    this.round?.metrics.markRendered();
  }

  /** Ask the server for a deal. When the request is sent the board is dealing until the deal arrives. */
  ask(request: ClientMessage): boolean {
    if (!this.socket.send(request)) return false;
    this.set({ phase: "dealing" });
    return true;
  }

  /** The ask was refused or went unanswered: a board still dealing is idle again. */
  cancelAsk(): void {
    if (this.shown.phase === "dealing") this.set({ phase: "idle" });
  }

  /** Play a round the server did not deal, in place of any round in play. */
  start(local: LocalRound<C>): void {
    this.round?.abandon();
    const clock = local.clock ?? wallClock;
    const startedAt = clock.now();
    this.begin({ seed: local.seed, config: local.config, startedAt, deadlineAt: startedAt + local.roundMs, clock, sessionId: null, replay: [] });
  }

  /** Show this board while no round runs. */
  show(state: S): void {
    this.set({ state, version: this.shown.version + 1 });
  }

  /** Read the round's clock: keeps `secondsLeft` and finishes the round at its deadline. */
  tick(): void {
    const r = this.round;
    if (!r || this.shown.phase !== "playing") return;
    const left = Math.max(0, Math.ceil(r.msLeft() / 1000));
    this.set({ secondsLeft: left });
    if (left !== this.lastSecond) {
      this.lastSecond = left;
      this.options.onSecond?.(left);
    }
    if (left <= 0) r.finish();
  }

  /**
   * What the board was part of is over on the server: the round in play is abandoned and nothing
   * more is taken for it, while the board stays as it stood until it is dropped or dismissed.
   */
  cutShort(): void {
    this.round?.abandon();
    this.round = null;
    this.sessionId = null;
  }

  /** Abandon the round in play, if any, and clear the board. */
  drop(): void {
    this.cutShort();
    this.set({ phase: "idle", outcome: null, secondsLeft: null });
    this.options.onClear?.();
  }

  /** The player has read the outcome: clear the board, unless a round is still in play. */
  dismiss(): void {
    if (this.round && !this.round.isFinished) return;
    this.drop();
  }

  private receive(m: ServerMessage): void {
    if (m.type === "puzzle.started") {
      this.deal(m);
      return;
    }
    if (!("sessionId" in m) || m.sessionId !== this.sessionId) return;
    if (m.type === "puzzle.result") {
      this.verdict({ kind: "scored", result: m });
    } else if (m.type === "puzzle.rejected") {
      this.round?.abandon();
      this.verdict({ kind: "rejected", reason: m.reason });
    } else if (this.round) {
      const move = this.options.inbound?.(m, this.round) ?? null;
      if (move !== null) this.round.apply(move, false);
    }
  }

  private deal(m: PuzzleStarted): void {
    const answer = this.options.accepts(m);
    if (!answer) return;
    if (answer === "decline") {
      this.socket.send({ type: "puzzle.abandon", sessionId: m.sessionId });
      return;
    }
    // The same board handed back is rebuilt from the server's log; abandoning it would end it there.
    const handedBack = m.sessionId === this.sessionId;
    if (handedBack) this.round?.discard();
    else this.round?.abandon();
    const round = this.begin({
      seed: m.seed,
      config: m.config as C,
      startedAt: this.socket.toLocal(m.serverNow),
      deadlineAt: this.socket.toLocal(m.deadlineAt),
      clock: this.options.clock ?? wallClock,
      sessionId: m.sessionId,
      replay: (m.resume?.moves ?? []) as unknown as readonly M[],
    });
    this.options.onDeal?.(m, round, handedBack);
  }

  private begin(r: { seed: string; config: C; startedAt: number; deadlineAt: number; clock: Clock; sessionId: string | null; replay: readonly M[] }): PuzzleRound<S, M, C> {
    const rated = r.sessionId !== null;
    this.lastSecond = -1;
    const round = new PuzzleRound<S, M, C>({
      def: this.options.def,
      seed: r.seed,
      config: r.config,
      startedAt: r.startedAt,
      deadlineAt: r.deadlineAt,
      clock: r.clock,
      rated: r.sessionId === null ? null : { socket: this.socket, sessionId: r.sessionId },
      replay: r.replay,
      onChange: (state, prev) => {
        this.set({ state, version: this.shown.version + 1 });
        if (prev !== null) this.options.onMove?.(state, prev);
      },
      onFinished: () => {
        this.set({ phase: rated ? "waiting" : "result" });
        this.options.onFinished?.(this.shown.state, rated);
      },
    });
    this.round = round;
    this.sessionId = r.sessionId;
    // A resumed round can be over already: it finished while it was rebuilt, and waits for its verdict.
    this.set({
      outcome: null,
      resumed: r.replay.length > 0,
      secondsLeft: Math.max(0, Math.ceil(round.msLeft() / 1000)),
      ...(round.isFinished ? {} : { phase: "playing" as const }),
    });
    return round;
  }

  private verdict(outcome: RoundOutcome): void {
    this.sessionId = null;
    this.set({ outcome, phase: "result" });
    this.options.onVerdict?.(outcome);
  }

  private set(patch: Partial<RoundView<S>>): void {
    const prev = this.shown;
    const keys = Object.keys(patch) as (keyof RoundView<S>)[];
    if (!keys.some((k) => patch[k] !== prev[k])) return;
    this.shown = { ...prev, ...patch };
    for (const l of this.listeners) l(this.shown);
  }
}
