import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { judge, Refused, TIERS, type Engine, type Entry, type Move, type PuzzleDoc, type Read, type Round, type Scale, type Skin, type Tier } from "@openseas/puzzle";
import type { CueData } from "@openseas/protocol";
import { playCueData } from "../audio.js";
import { content } from "../content.js";
import type { PlayFrame } from "./renderer.js";

/**
 * The host's scale (docs/puzzles/DOMAIN.md, "Judgement"): where each tier starts, from the game's
 * own rating tiers, a tier's width below Steady and above Legendary.
 */
export function hostScale(): Scale {
  const at = (tier: Tier): number => content.ratingTiers.find((x) => x.key === tier)?.min ?? 0;
  const width = at("sharp") - at("steady");
  return { floor: at("steady") - width, steady: at("steady"), sharp: at("sharp"), masterful: at("masterful"), legendary: at("legendary"), ceiling: at("legendary") + width };
}

export interface PlayResult {
  readonly read: Read;
  /** The score the round's log gives when it is played again from its seed, or null when the log would not replay. */
  readonly replayed: number | null;
}

export interface PlayRound {
  readonly phase: "idle" | "playing" | "result";
  readonly frame: PlayFrame;
  readonly read: Read;
  readonly seed: string;
  readonly stage: string;
  /** Seconds the round's clock runs, and those left. Null for a round with no clock. */
  readonly seconds: number | null;
  readonly timeLeft: number | null;
  /** The tier the last stretch of play would make of a whole round. */
  readonly pace: { readonly tier: Tier; readonly index: number; readonly count: number } | null;
  readonly result: PlayResult | null;
  /** Deal a round and start its clock. */
  start(seed: string, stage: string): void;
  /** Lay a round out without starting it, to look at. */
  preview(seed: string, stage: string): void;
  move(move: Move): boolean;
}

interface Live<S> {
  round: Round<S>;
  entries: Entry[];
  /** `performance.now()` at the round's start. */
  t0: number;
  running: boolean;
  /** The last whole second the countdown sounded. */
  counted: number;
}

const clockOf = (doc: PuzzleDoc, values: Readonly<Record<string, unknown>>): number | null => {
  const setting = doc.round.ends.find((e) => e.by === "clock")?.setting;
  const v = setting === undefined ? undefined : values[setting];
  return typeof v === "number" ? v : null;
};

/**
 * A local round of a domain puzzle (ADR 0080): the page's clock stamps each move, the engine plays
 * it, and when the round ends its log is played again from the seed and judged, as a host does.
 * Nothing here scores: every number shown is the engine's read of the round.
 */
export function usePlayRound<S>(engine: Engine<S>, skin: Skin, first: { seed: string; stage: string }): PlayRound {
  const live = useRef<Live<S> | null>(null);
  const count = useRef(0);
  const deal = useCallback(
    (seed: string, stage: string, running: boolean): { live: Live<S>; frame: PlayFrame } => {
      const round = engine.start(seed, engine.settings({ stage }));
      const frame: PlayFrame = { round: ++count.current, seq: 0, board: round.board, events: [], gauges: engine.read(round).gauges, values: round.settings.values };
      return { live: { round, entries: [], t0: performance.now(), running, counted: Infinity }, frame };
    },
    [engine],
  );
  const opening = useMemo(() => deal(first.seed, first.stage, false), []); // eslint-disable-line react-hooks/exhaustive-deps
  if (live.current === null) live.current = opening.live;

  const [phase, setPhase] = useState<PlayRound["phase"]>("idle");
  const [frame, setFrame] = useState<PlayFrame>(opening.frame);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<PlayResult | null>(null);

  const sound = useCallback(
    (event: string, values: Readonly<Record<string, number>> = {}): void => {
      for (const name of skin.events[event]?.cues ?? []) {
        const cue = skin.cues[name] as unknown as CueData | undefined;
        if (cue) playCueData(name, cue, values);
      }
    },
    [skin],
  );

  const finish = useCallback(
    (l: Live<S>): void => {
      l.running = false;
      const read = engine.read(l.round);
      let replayed: number | null = null;
      try {
        replayed = judge(engine, { seed: l.round.seed, layers: l.round.settings.layers, settings: l.round.settings.values, log: { entries: l.entries, end: l.round.ended?.at ?? l.round.at } }).score;
      } catch {
        replayed = null;
      }
      setResult({ read, replayed });
      setPhase("result");
      sound("end");
    },
    [engine, sound],
  );

  /** Take what an entry or a mark made of the round. */
  const take = useCallback(
    (l: Live<S>, round: Round<S>, events: PlayFrame["events"], entry: boolean): void => {
      l.round = round;
      if (entry || events.length > 0) setFrame((f) => ({ round: f.round, seq: f.seq + 1, board: round.board, events, gauges: engine.read(round).gauges, values: round.settings.values }));
      if (round.ended) finish(l);
    },
    [engine, finish],
  );

  const begin = useCallback(
    (seed: string, stage: string, running: boolean): void => {
      const next = deal(seed, stage, running);
      live.current = next.live;
      setFrame(next.frame);
      setElapsed(0);
      setResult(null);
      setPhase(running ? "playing" : "idle");
      if (running) sound("start");
    },
    [deal, sound],
  );
  const start = useCallback((seed: string, stage: string) => begin(seed, stage, true), [begin]);
  const preview = useCallback((seed: string, stage: string) => begin(seed, stage, false), [begin]);

  const move = useCallback(
    (m: Move): boolean => {
      const l = live.current;
      if (!l || !l.running || engine.allows(l.round, m) !== null) return false;
      const entry: Entry = { at: Math.max(l.round.at, Math.floor(performance.now() - l.t0)), move: m };
      try {
        const played = engine.play(l.round, entry);
        l.entries.push(entry);
        take(l, played.round, played.events, true);
        return true;
      } catch (e) {
        if (e instanceof Refused) return false;
        throw e;
      }
    },
    [engine, take],
  );

  // The clock: time passes with nothing played, ticks fall due and the round can end.
  useEffect(() => {
    if (phase !== "playing") return;
    const timer = window.setInterval(() => {
      const l = live.current;
      if (!l || !l.running) return;
      const at = Math.max(l.round.at, Math.floor(performance.now() - l.t0));
      const marked = engine.mark(l.round, at);
      if (marked.events.length > 0 || marked.round.ended) take(l, marked.round, marked.events, false);
      setElapsed(at);
      const seconds = clockOf(engine.doc, l.round.settings.values);
      const left = seconds === null ? null : Math.ceil(seconds - at / 1000);
      if (left !== null && left <= 10 && left > 0 && left < l.counted) {
        l.counted = left;
        sound("countdown", { seconds: left });
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [phase, engine, take, sound]);

  const l = live.current;
  const seconds = clockOf(engine.doc, l.round.settings.values);
  const at = l.round.ended ? l.round.ended.at : phase === "playing" ? elapsed : 0;
  const pace = phase === "playing" ? engine.pace(l.round, Math.max(l.round.at, at)) : null;
  // The round is read again only when it changes, which the frame's sequence says.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const read = useMemo(() => engine.read(l.round), [engine, frame, phase]);
  return {
    phase,
    frame,
    read,
    seed: l.round.seed,
    stage: l.round.settings.stage,
    seconds,
    timeLeft: seconds === null ? null : Math.max(0, Math.ceil(seconds - at / 1000)),
    pace: pace ? { tier: pace.tier, index: TIERS.indexOf(pace.tier), count: TIERS.length } : null,
    result,
    start,
    preview,
    move,
  };
}
