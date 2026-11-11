import { useEffect, useMemo, useState } from "react";
import type { ClientMessage } from "@openseas/protocol";
import { sfx } from "../audio.js";
import { usePirate } from "../state/PirateProvider.jsx";
import type { PuzzleRound } from "./round.js";
import { RoundSession, type LocalRound, type RoundSessionOptions, type RoundView } from "./session.js";

export interface UseRoundSessionOptions<S, M, C> extends Omit<RoundSessionOptions<S, M, C>, "onSecond"> {
  /** Sound a tick for each of the last ten seconds of a round, sharper in the last five. */
  countdown?: boolean;
  /**
   * True once what the board is part of is over on the server (the melee, the space battle). A
   * round still in play is cut short at once and the board goes idle after a beat; a verdict
   * already in stays until it is dismissed.
   */
  over?: boolean;
}

/** The round session as a board uses it. It is also the host `useTicked` reads. */
export interface RoundSessionApi<S, M, C> extends RoundView<S> {
  apply(move: M, countsAsInput?: boolean): boolean;
  canApply(move: M): boolean;
  markRendered(): void;
  /** The round in play or last played, for engine queries (ghost pieces, previews, ticks). */
  current(): PuzzleRound<S, M, C> | null;
  /** Ask the server for a deal; true when the request was sent and the board is dealing. */
  ask(request: ClientMessage): boolean;
  cancelAsk(): void;
  /** Play a round the server did not deal: unrated, nothing sent. */
  start(local: LocalRound<C>): void;
  /** Show this board while no round runs. */
  show(state: S): void;
  /** Abandon the round in play, if any, and clear the board. */
  drop(): void;
  /** Clear the board once its round is over; ignored while one is in play. */
  dismiss(): void;
}

const countdownTick = (left: number): void => {
  if (left > 0 && left <= 10) sfx.tick(left <= 5);
};

/** How often the round's clock is read while it plays. */
const CLOCK_MS = 100;
/** How long a board cut short stays as it stood before it goes idle. */
const CUT_SHORT_MS = 2400;

/**
 * The round a board plays, on the pirate's connection: a `RoundSession` held for the life of the
 * component. Reads the round's clock while it plays, cuts the round short when the caller says what
 * it belongs to is over, and abandons it on unmount. Callbacks are always the latest render's.
 */
export function useRoundSession<S, M, C>(options: UseRoundSessionOptions<S, M, C>): RoundSessionApi<S, M, C> {
  const { socket } = usePirate();
  const { countdown = false, over = false, ...rest } = options;
  const core: RoundSessionOptions<S, M, C> = countdown ? { ...rest, onSecond: countdownTick } : rest;
  const [session] = useState(() => new RoundSession<S, M, C>(socket, core));
  session.configure(core);
  const [view, setView] = useState(() => session.view);

  useEffect(() => {
    setView(session.view);
    return session.subscribe(setView);
  }, [session]);
  useEffect(() => session.attach(), [session]);

  const playing = view.phase === "playing";
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => session.tick(), CLOCK_MS);
    return () => window.clearInterval(id);
  }, [playing, session]);

  const { phase } = view;
  useEffect(() => {
    if (!over || phase === "idle" || phase === "result") return;
    session.cutShort();
    const id = window.setTimeout(() => session.drop(), CUT_SHORT_MS);
    return () => window.clearTimeout(id);
  }, [over, phase, session]);

  const actions = useMemo(
    () => ({
      apply: (move: M, countsAsInput = true) => session.apply(move, countsAsInput),
      canApply: (move: M) => session.canApply(move),
      markRendered: () => session.markRendered(),
      current: () => session.current(),
      ask: (request: ClientMessage) => session.ask(request),
      cancelAsk: () => session.cancelAsk(),
      start: (local: LocalRound<C>) => session.start(local),
      show: (state: S) => session.show(state),
      drop: () => session.drop(),
      dismiss: () => session.dismiss(),
    }),
    [session],
  );

  return { ...view, ...actions };
}
