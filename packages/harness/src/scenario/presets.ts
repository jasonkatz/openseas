import type { PuzzleId } from "@openseas/engine";
import type { Overrides } from "./overrides.js";

/** A named set of conditions worth testing. Names live in the message table under `harness.preset.<id>`. */
export interface Preset {
  readonly id: string;
  readonly overrides: Overrides;
  readonly roundSeconds?: number;
  /** Clock rate for the lab round. */
  readonly speed?: number;
}

/**
 * Presets per puzzle. Every one must pass the engine's validateConfig and the protocol's config
 * schema on top of the content config; test/presets.test.ts checks that. Gunnery's per-deck
 * presets are built from content at runtime (deckPresets) since the deck list is content.
 */
export const PRESETS: Readonly<Record<PuzzleId, readonly Preset[]>> = {
  bilging: [
    { id: "specials_galore", overrides: { "specialChancePerMille.keg": 60, "specialChancePerMille.ink": 40, "specialChancePerMille.barnacle": 50 } },
    { id: "no_specials", overrides: { "specialChancePerMille.keg": 0, "specialChancePerMille.ink": 0, "specialChancePerMille.barnacle": 0 } },
    { id: "high_water", overrides: { initialWaterRow: 9 } },
    { id: "fast_water", overrides: { waterRisePerMoves: 2 } },
    { id: "three_kinds", overrides: { pieceKinds: 3 } },
    { id: "ten_moves", overrides: { maxMoves: 10 }, roundSeconds: 60 },
  ],
  sailing: [
    { id: "one_platform", overrides: { platformsAtOnce: 1 } },
    { id: "no_platforms", overrides: { platformsAtOnce: 0 } },
    { id: "two_kinds", overrides: { pieceKinds: 2 } },
    { id: "long_bars", overrides: { platformSpanMin: 4, platformSpanMax: 4 } },
    { id: "five_pairs", overrides: { maxMoves: 5 }, roundSeconds: 60 },
  ],
  carpentry: [
    { id: "single_planks", overrides: { minHolePieces: 1, maxHolePieces: 1 } },
    { id: "big_holes", overrides: { minHolePieces: 3, maxHolePieces: 3 } },
    { id: "grows_fast", overrides: { growAfterMoves: 1 } },
    { id: "one_hole", overrides: { holesAtOnce: 1 } },
    { id: "five_planks", overrides: { maxMoves: 5 }, roundSeconds: 60 },
  ],
  gunnery: [
    { id: "slow_chute", overrides: { spawnEveryTicks: 20, spawnEveryTicksMin: 16 } },
    { id: "fast_chute", overrides: { spawnEveryTicks: 3, spawnEveryTicksMin: 2 } },
    { id: "quiet_deck", overrides: { spawnEveryTicks: 1000, spawnEveryTicksMin: 1000 } },
    { id: "no_water", overrides: { bag: [2, 2, 2, 0] } },
    { id: "slow_motion", overrides: {}, speed: 0.25 },
  ],
  navigation: [
    { id: "big_constellation", overrides: { startStars: 8 } },
    { id: "slow_falls", overrides: { fallTicks: 90, fallTicksMin: 90 } },
    { id: "fast_falls", overrides: { fallTicks: 10, fallTicksMin: 6 } },
    { id: "one_shape", overrides: { shapes: 1 } },
    { id: "no_reuse", overrides: { reuseChancePercent: 0 } },
    { id: "slow_motion", overrides: {}, speed: 0.25 },
  ],
  battle: [
    { id: "cutpurse", overrides: { "brigand.tokensPerTurn": 2, "brigand.reloadPerTurn": 1, "brigand.accuracy": 50, "brigand.aggression": 40 } },
    { id: "reaver", overrides: { "brigand.tokensPerTurn": 4, "brigand.reloadPerTurn": 2, "brigand.accuracy": 80, "brigand.aggression": 80 } },
    { id: "dead_eye", overrides: { "brigand.tokensPerTurn": 4, "brigand.reloadPerTurn": 4, "brigand.accuracy": 100, "brigand.aggression": 100 } },
    { id: "quick_turns", overrides: { turnSeconds: 6 } },
    { id: "long_turns", overrides: { turnSeconds: 30 }, roundSeconds: 600 },
    { id: "full_magazine", overrides: { "supply.cannons": 4 } },
    { id: "three_turns", overrides: { maxTurns: 3 }, roundSeconds: 60 },
  ],
};

/** One preset per Sea Battle board, so a fight can be pinned to a board the seed would not have picked. */
export function boardPresets(boards: ReadonlyArray<readonly string[]>): Preset[] {
  return boards.map((board, i) => ({ id: `board_${i + 1}`, overrides: { boards: [board] } }));
}

/** One preset per Gunnery deck, so a round can be pinned to a deck the seed would not have picked. */
export function deckPresets(decks: ReadonlyArray<readonly string[]>): Preset[] {
  return decks.map((deck, i) => ({ id: `deck_${i + 1}`, overrides: { decks: [deck] } }));
}
