import {
  BATTLE_DEF,
  COOLING_DEF,
  PLATING_DEF,
  GUNNERY_DEF,
  NAVIGATION_DEF,
  ENGINES_DEF,
  SWORDFIGHT_DEF,
  Special,
  advanceGunnery,
  advanceNavigation,
  advanceSwordfight,
  navigationShapeOf,
  type BattleState,
  type GunneryMove,
  type GunneryState,
  type NavigationMove,
  type PuzzleDef,
  type PuzzleId,
  type SwordfightMove,
} from "@openseas/engine";
import { content } from "@openseas/boards";
import { PRESETS, boardPresets, deckPresets, type Preset } from "./scenario/presets.js";

/** A condition on an opening state the seed finder can search for. Named by `harness.probe.<puzzle>.<id>`. */
export interface SeedProbe<S> {
  readonly id: string;
  readonly vars?: Record<string, string | number>;
  test(state: S): boolean;
}

/** The tick clock of an engine whose moves carry ticks (ADR 0015), as `useTicked` runs it. */
export interface TickedPuzzle<S, M, C> {
  /** The tick length and last tick of a round on this config. */
  clock(config: C): { readonly tickMs: number; readonly maxTick: number };
  /** The engine's state at a later tick, without logging a move. */
  advance(state: S, tick: number): S;
  /** The engine's wait move at a tick. */
  wait(tick: number): M;
  /** Log a wait after this many ticks without input; `useTicked` says how many by default. */
  readonly waitEveryTicks?: number;
}

/** A config that names its own tick length and last tick, as every ticked engine's does. */
interface Clocked {
  readonly tickMs: number;
  readonly maxTick: number;
}

/** The tick clock of a ticked engine, on its config's own tick length and last tick. */
export function ticks<S extends { readonly tick: number }, M>(advance: (state: S, tick: number) => S, wait: (tick: number) => M, waitEveryTicks?: number): TickedPuzzle<S, M, Clocked> {
  return { clock: (c) => ({ tickMs: c.tickMs, maxTick: c.maxTick }), advance, wait, ...(waitEveryTicks === undefined ? {} : { waitEveryTicks }) };
}

/** What the bench needs to know about a puzzle beyond its engine definition. */
export interface HarnessPuzzle<S, M, C> {
  readonly id: PuzzleId;
  readonly def: PuzzleDef<S, M, C>;
  /** The content config and round length: what the server issues for recorded rounds. */
  readonly config: C;
  readonly roundSeconds: number;
  readonly presets: readonly Preset[];
  readonly probes: readonly SeedProbe<S>[];
  /** Config fields the form keeps read-only because the boards' animation timing is built on them. */
  readonly locked: readonly string[];
  /** Set for engines whose moves carry ticks (ADR 0015). */
  readonly ticked: TickedPuzzle<S, M, C> | null;
  /** Whether the puzzle has idle hints in unrated practice. */
  readonly hints: boolean;
}

/** What a puzzle's bench entry says for itself. Its config and round length are content's. */
export interface PuzzleBits<S, M, C> {
  /** Default: the puzzle's lab presets (`PRESETS`). */
  readonly presets?: readonly Preset[];
  readonly probes: readonly SeedProbe<S>[];
  /** Fields locked beyond `tickMs`, which a ticked engine always locks (ADR 0019). */
  readonly locked?: readonly string[];
  /** The engine's definition alone says what S, M and C are. */
  readonly ticked?: TickedPuzzle<NoInfer<S>, NoInfer<M>, NoInfer<C>>;
  readonly hints: boolean;
}

/** A puzzle's bench entry: its engine, the config and round length content deals it with, and what it says for itself. */
export function harnessPuzzle<S, M, C>(def: PuzzleDef<S, M, C>, bits: PuzzleBits<S, M, C>): HarnessPuzzle<S, M, C> {
  // Content holds this puzzle's config, loaded through the same wire schema the engine's type follows.
  const { config, roundSeconds } = content.puzzles[def.id];
  return {
    id: def.id,
    def,
    config: config as C,
    roundSeconds,
    presets: bits.presets ?? PRESETS[def.id],
    probes: bits.probes,
    locked: [...(bits.ticked ? ["tickMs"] : []), ...(bits.locked ?? [])],
    ticked: bits.ticked ?? null,
    hints: bits.hints,
  };
}

const c = content.puzzles;

export const COOLING = harnessPuzzle(COOLING_DEF, {
  probes: [
    { id: "charge_on_board", test: (s) => s.cells.some((p) => p.kind === Special.Charge) },
    { id: "magnet_on_board", test: (s) => s.cells.some((p) => p.kind === Special.Magnet) },
  ],
  hints: true,
});

export const ENGINES = harnessPuzzle(ENGINES_DEF, {
  probes: [
    { id: "double_first", test: (s) => s.current.a === s.current.b },
    {
      id: "square_injector",
      test: (s) => s.injectors.some((p) => p.cells.length === 4 && new Set(p.cells.map((x) => x.col)).size === 2 && new Set(p.cells.map((x) => x.row)).size === 2),
    },
  ],
  hints: false,
});

export const PLATING = harnessPuzzle(PLATING_DEF, {
  probes: [
    { id: "big_breach", test: (s) => s.breaches.some((h) => h.cells.length >= 15) },
    { id: "small_breach", test: (s) => s.breaches.some((h) => h.cells.length === 5) },
  ],
  hints: false,
});

export const GUNNERY = harnessPuzzle(GUNNERY_DEF, {
  presets: [...deckPresets(c.gunnery.config.decks), ...PRESETS.gunnery],
  probes: c.gunnery.config.decks.map((_, i) => ({ id: "deck", vars: { n: i + 1 }, test: (s: GunneryState) => s.deckIndex === i })),
  ticked: ticks(advanceGunnery, (tick): GunneryMove => ({ type: "wait", tick })),
  hints: false,
});

export const NAVIGATION = harnessPuzzle(NAVIGATION_DEF, {
  probes: [
    { id: "comet_first", test: (s) => navigationShapeOf(s.config, s.falling.kind) === 2 },
    { id: "repeat_kind", test: (s) => new Set(s.markers.map((m) => m.kind)).size < s.markers.length },
  ],
  ticked: ticks(advanceNavigation, (tick): NavigationMove => ({ type: "wait", tick })),
  hints: true,
});

export const BATTLE = harnessPuzzle(BATTLE_DEF, {
  presets: [...PRESETS.battle, ...boardPresets(c.battle.config.boards)],
  probes: [
    ...c.battle.config.boards.map((_, i) => ({ id: "board", vars: { n: i + 1 }, test: (s: BattleState) => s.boardIndex === i })),
    { id: "skiff_ahead", test: (s) => s.ships[0].x === s.ships[1].x },
  ],
  hints: false,
});

export const SWORDFIGHT = harnessPuzzle(SWORDFIGHT_DEF, {
  probes: [
    { id: "breaker_first", test: (s) => s.boards[0]!.current.a.breaker || s.boards[0]!.current.b.breaker },
    { id: "double_first", test: (s) => s.boards[0]!.current.a.color === s.boards[0]!.current.b.color && !s.boards[0]!.current.a.breaker && !s.boards[0]!.current.b.breaker },
  ],
  locked: ["player"],
  // A wait every five ticks without input, as the melee aboard logs them.
  ticked:ticks(advanceSwordfight, (tick): SwordfightMove => ({ type: "wait", tick }), 5),
  hints: false,
});
