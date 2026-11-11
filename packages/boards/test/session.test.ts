import { describe, expect, it } from "vitest";
import { InvalidMoveError, type PuzzleDef } from "@openseas/engine";
import type { ClientMessage, PuzzleStarted, ServerMessage } from "@openseas/protocol";
import type { Clock } from "../src/round/clock.js";
import { RoundSession, type RoundOutcome, type RoundSessionOptions, type RoundSocket } from "../src/round/session.js";

// A counting puzzle: each move adds to a count, the round ends at the goal or on an "end" move.
interface CountState {
  readonly seed: string;
  readonly goal: number;
  readonly n: number;
  readonly done: boolean;
}
type CountMove = { type: "add"; by: number } | { type: "end" };
interface CountConfig {
  readonly goal: number;
}

const COUNT_DEF: PuzzleDef<CountState, CountMove, CountConfig> = {
  id: "cooling",
  defaultConfig: { goal: 10 },
  validateConfig: () => undefined,
  create: (seed, config) => ({ seed, goal: config.goal, n: 0, done: false }),
  reduce: (s, m) => {
    if (s.done) throw new InvalidMoveError("the round is over", m);
    if (m.type === "end") return { ...s, done: true };
    if (m.by <= 0) throw new InvalidMoveError("a count only grows", m);
    const n = s.n + m.by;
    return { ...s, n, done: n >= s.goal };
  },
  hash: (s) => `${s.seed}:${s.n}:${s.done}`,
  summarize: (s) => ({ score: s.n, moves: 0, bestCombo: 0 }),
  isFinished: (s) => s.done,
  maxMoves: () => 100,
};

/** The server is this many ms ahead of this machine. */
const SERVER_AHEAD = 5_000;

class FakeSocket implements RoundSocket {
  readonly sent: ClientMessage[] = [];
  open = true;
  private readonly listeners = new Set<(msg: ServerMessage) => void>();

  send(msg: ClientMessage): boolean {
    if (!this.open) return false;
    this.sent.push(msg);
    return true;
  }

  onMessage(fn: (msg: ServerMessage) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  toLocal(serverMs: number): number {
    return serverMs - SERVER_AHEAD;
  }

  emit(msg: ServerMessage): void {
    for (const l of this.listeners) l(msg);
  }

  /** The kinds of message sent, in order, with their session. */
  kinds(): string[] {
    return this.sent.map((m) => ("sessionId" in m ? `${m.type} ${m.sessionId}` : m.type));
  }
}

class ManualClock implements Clock {
  t = 1_000_000;
  now(): number {
    return this.t;
  }
}

function setup(extra: Partial<RoundSessionOptions<CountState, CountMove, CountConfig>> = {}) {
  const socket = new FakeSocket();
  const clock = new ManualClock();
  const calls = { deals: [] as { sessionId: string; handedBack: boolean }[], verdicts: [] as RoundOutcome[], finished: [] as { n: number; rated: boolean }[], seconds: [] as number[], clears: 0 };
  const session = new RoundSession<CountState, CountMove, CountConfig>(socket, {
    def: COUNT_DEF,
    initial: () => COUNT_DEF.create("menu", { goal: 10 }),
    clock,
    accepts: (m) => m.puzzle === "cooling",
    onDeal: (m, _r, handedBack) => calls.deals.push({ sessionId: m.sessionId, handedBack }),
    onVerdict: (o) => calls.verdicts.push(o),
    onFinished: (s, rated) => calls.finished.push({ n: s.n, rated }),
    onSecond: (left) => calls.seconds.push(left),
    onClear: () => calls.clears++,
    ...extra,
  });
  const detach = session.attach();
  /** The server deals a round of `seconds`, starting now on its clock. */
  const deal = (sessionId: string, opts: { seconds?: number; resume?: CountMove[]; puzzle?: string; goal?: number } = {}): void => {
    const serverNow = clock.t + SERVER_AHEAD;
    socket.emit({
      type: "puzzle.started",
      puzzle: opts.puzzle ?? "cooling",
      sessionId,
      seed: `seed-${sessionId}`,
      config: { goal: opts.goal ?? 10 },
      serverNow,
      deadlineAt: serverNow + (opts.seconds ?? 60) * 1000,
      ...(opts.resume ? { resume: { moves: opts.resume } } : {}),
    } as unknown as PuzzleStarted);
  };
  const result = (sessionId: string): void =>
    socket.emit({ type: "puzzle.result", sessionId, score: 3, moves: 1, bestCombo: 0, verified: true, rating: null, tierChange: null, performance: { rating: 1500, tier: "steady" } });
  return { socket, clock, session, calls, deal, result, detach };
}

const add = (by: number): CountMove => ({ type: "add", by });

describe("RoundSession", () => {
  it("plays a deal it accepts on the server's time read as local time, and streams its moves", () => {
    const { session, socket, clock, deal } = setup();
    deal("s1", { seconds: 60 });
    const r = session.current()!;
    expect(session.view.phase).toBe("playing");
    expect(r.startedAt).toBe(clock.t);
    expect(r.msLeft()).toBe(60_000);
    expect(session.view.secondsLeft).toBe(60);
    expect(session.view.state.seed).toBe("seed-s1");

    expect(session.apply(add(2))).toBe(true);
    expect(session.apply(add(-1))).toBe(false);
    expect(socket.sent).toEqual([{ type: "puzzle.move", sessionId: "s1", seq: 0, move: add(2), hash: "seed-s1:2:false" }]);
    expect(session.view.state.n).toBe(2);
  });

  it("lets another board's deal pass, and answers a deal it declines without playing it", () => {
    let wanted = true;
    const { session, socket, deal } = setup({ accepts: (m) => (m.puzzle !== "cooling" ? false : wanted ? true : "decline") });
    deal("s1", { puzzle: "engines" });
    expect(session.view.phase).toBe("idle");
    expect(socket.sent).toEqual([]);

    wanted = false;
    deal("s2");
    expect(session.view.phase).toBe("idle");
    expect(session.current()).toBeNull();
    expect(socket.kinds()).toEqual(["puzzle.abandon s2"]);
  });

  it("takes the verdict for the session in play and no other", () => {
    const { session, socket, calls, deal, result } = setup();
    deal("s1");
    result("s0");
    expect(session.view.phase).toBe("playing");

    session.apply({ type: "end" });
    expect(session.view.phase).toBe("waiting");
    expect(socket.kinds()).toEqual(["puzzle.move s1", "puzzle.finish s1"]);
    expect(calls.finished).toEqual([{ n: 0, rated: true }]);

    result("s1");
    result("s1");
    expect(session.view.phase).toBe("result");
    expect(session.view.outcome).toMatchObject({ kind: "scored", result: { sessionId: "s1", score: 3 } });
    expect(calls.verdicts).toHaveLength(1);
  });

  it("abandons a round the server rejects", () => {
    const { session, socket, deal } = setup();
    deal("s1");
    socket.emit({ type: "puzzle.rejected", sessionId: "s1", reason: "divergence" });
    expect(session.view.phase).toBe("result");
    expect(session.view.outcome).toEqual({ kind: "rejected", reason: "divergence" });
    expect(socket.kinds()).toEqual(["puzzle.abandon s1"]);
    expect(session.apply(add(1))).toBe(false);
  });

  it("rebuilds a board handed back from the server's log without a word, and abandons one replaced by a new deal (ADR 0024)", () => {
    const { session, socket, calls, deal } = setup();
    deal("s1");
    session.apply(add(1));
    session.apply(add(2));
    socket.sent.length = 0;

    deal("s1", { resume: [add(1), add(2)] });
    expect(socket.sent).toEqual([]);
    expect(session.view.resumed).toBe(true);
    expect(session.view.state.n).toBe(3);
    expect(session.current()!.log.map((m) => m.seq)).toEqual([0, 1]);
    session.apply(add(1));
    expect(socket.sent).toEqual([{ type: "puzzle.move", sessionId: "s1", seq: 2, move: add(1), hash: "seed-s1:4:false" }]);

    socket.sent.length = 0;
    deal("s2");
    expect(socket.kinds()).toEqual(["puzzle.abandon s1"]);
    expect(session.view.resumed).toBe(false);
    expect(session.view.state.n).toBe(0);
    expect(calls.deals).toEqual([
      { sessionId: "s1", handedBack: false },
      { sessionId: "s1", handedBack: true },
      { sessionId: "s2", handedBack: false },
    ]);
  });

  it("waits for the verdict on a board that was over when it was rebuilt", () => {
    const { session, deal } = setup();
    deal("s1", { goal: 3, resume: [add(3)] });
    expect(session.view.phase).toBe("waiting");
    expect(session.current()!.isFinished).toBe(true);
  });

  it("logs the moves the server vouches for in the round in play, and nothing for another round", () => {
    const seen: string[] = [];
    const { session, socket, deal } = setup({
      inbound: (m, r) => {
        seen.push(m.type);
        if (m.type === "duty.heat") return add(m.row);
        if (m.type === "melee.over") r.settleLocal({ type: "end" });
        return null;
      },
    });
    socket.emit({ type: "duty.heat", sessionId: "s1", row: 4 });
    deal("s1");
    socket.emit({ type: "duty.heat", sessionId: "s0", row: 4 });
    socket.emit({ type: "duty.heat", sessionId: "s1", row: 4 });
    expect(seen).toEqual(["duty.heat"]);
    expect(session.view.state.n).toBe(4);
    expect(socket.sent).toEqual([{ type: "puzzle.move", sessionId: "s1", seq: 0, move: add(4), hash: "seed-s1:4:false" }]);

    // A move the server already logged settles the round here, and nothing is sent for it.
    socket.emit({ type: "melee.over", sessionId: "s1", won: true, tick: 0 });
    expect(session.view.phase).toBe("waiting");
    expect(session.view.state.done).toBe(true);
    expect(socket.sent).toHaveLength(1);
  });

  it("reads the clock: counts the whole seconds down and finishes the round at its deadline", () => {
    const { session, socket, clock, calls, deal } = setup();
    deal("s1", { seconds: 3 });
    session.tick();
    clock.t += 400;
    session.tick();
    clock.t += 700;
    session.tick();
    expect(session.view.secondsLeft).toBe(2);
    clock.t += 1_000;
    session.tick();
    expect(session.view.phase).toBe("playing");
    clock.t += 900;
    session.tick();
    expect(calls.seconds).toEqual([3, 2, 1, 0]);
    expect(session.view.phase).toBe("waiting");
    expect(socket.kinds()).toEqual(["puzzle.finish s1"]);
    session.tick();
    expect(socket.sent).toHaveLength(1);
  });

  it("plays a round the server did not deal, on the caller's clock, and sends nothing", () => {
    const { session, socket, calls } = setup();
    const lab = new ManualClock();
    lab.t = 50;
    session.start({ seed: "local", config: { goal: 2 }, roundMs: 2_000, clock: lab });
    expect(session.view.phase).toBe("playing");
    expect(session.current()!.rated).toBe(false);
    session.apply(add(1));
    lab.t += 2_000;
    session.tick();
    expect(session.view.phase).toBe("result");
    expect(session.view.outcome).toBeNull();
    expect(calls.finished).toEqual([{ n: 1, rated: false }]);
    expect(socket.sent).toEqual([]);
  });

  it("asks for a deal, and is idle again when none comes", () => {
    const { session, socket, deal } = setup();
    socket.open = false;
    expect(session.ask({ type: "duty.start" })).toBe(false);
    expect(session.view.phase).toBe("idle");

    socket.open = true;
    expect(session.ask({ type: "duty.start" })).toBe(true);
    expect(session.view.phase).toBe("dealing");
    session.cancelAsk();
    expect(session.view.phase).toBe("idle");

    session.ask({ type: "duty.start" });
    deal("s1");
    session.cancelAsk();
    expect(session.view.phase).toBe("playing");
    expect(socket.kinds()).toEqual(["duty.start", "duty.start"]);
  });

  it("cuts a round short: abandoned at once, nothing more taken for it, the board as it stood until dropped", () => {
    const { session, socket, calls, deal, result } = setup();
    deal("s1");
    session.apply(add(2));
    session.cutShort();
    expect(socket.kinds()).toEqual(["puzzle.move s1", "puzzle.abandon s1"]);
    result("s1");
    expect(session.view.phase).toBe("playing");
    expect(session.view.state.n).toBe(2);
    expect(session.apply(add(1))).toBe(false);

    session.drop();
    expect(session.view.phase).toBe("idle");
    expect(session.view.secondsLeft).toBeNull();
    expect(calls.clears).toBe(1);
  });

  it("dismisses a board only once its round is over", () => {
    const { session, calls, deal, result } = setup();
    deal("s1");
    session.dismiss();
    expect(session.view.phase).toBe("playing");
    expect(calls.clears).toBe(0);

    session.apply({ type: "end" });
    result("s1");
    session.dismiss();
    expect(session.view.phase).toBe("idle");
    expect(session.view.outcome).toBeNull();
    expect(session.current()).toBeNull();
    expect(calls.clears).toBe(1);
  });

  it("shows a board between rounds, bumping the version even for the same state", () => {
    const { session } = setup();
    const board = COUNT_DEF.create("preview", { goal: 5 });
    const before = session.view.version;
    session.show(board);
    session.show(board);
    expect(session.view.state).toBe(board);
    expect(session.view.version).toBe(before + 2);
  });

  it("tells its subscribers of each change, and only of changes", () => {
    const { session, deal } = setup();
    const phases: string[] = [];
    const off = session.subscribe((v) => phases.push(v.phase));
    session.cancelAsk();
    session.dismiss();
    expect(phases).toEqual([]);
    deal("s1");
    expect(phases.at(-1)).toBe("playing");
    const heard = phases.length;
    off();
    session.drop();
    expect(phases).toHaveLength(heard);
  });

  it("abandons the round in play and stops listening when detached", () => {
    const { session, socket, deal, detach, result } = setup();
    deal("s1");
    detach();
    expect(socket.kinds()).toEqual(["puzzle.abandon s1"]);
    result("s1");
    deal("s2");
    expect(session.view.phase).toBe("playing");
    expect(session.view.outcome).toBeNull();
    expect(session.view.state.seed).toBe("seed-s1");
  });
});
