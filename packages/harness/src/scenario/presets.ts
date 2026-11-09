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
  cooling: [
    { id: "specials_galore", overrides: { "specialChancePerMille.charge": 60, "specialChancePerMille.magnet": 40, "specialChancePerMille.slag": 50 } },
    { id: "no_specials", overrides: { "specialChancePerMille.charge": 0, "specialChancePerMille.magnet": 0, "specialChancePerMille.slag": 0 } },
    // The board plays on a lone ship's heat (ADR 0029): high heat raises the heat's floor.
    { id: "high_heat", overrides: { minHeatRow: 9, initialHeatRow: 9 } },
    // The board's own practice heat instead: it rises with every swap and drains with points.
    { id: "fast_heat", overrides: { shipHeat: false, heatRisePerMoves: 2 } },
    { id: "three_kinds", overrides: { pieceKinds: 3 } },
    { id: "ten_moves", overrides: { maxMoves: 10 }, roundSeconds: 60 },
  ],
  engines: [
    { id: "one_injector", overrides: { injectorsAtOnce: 1 } },
    { id: "no_injectors", overrides: { injectorsAtOnce: 0 } },
    { id: "two_kinds", overrides: { pieceKinds: 2 } },
    { id: "long_bars", overrides: { injectorSpanMin: 4, injectorSpanMax: 4 } },
    { id: "five_pairs", overrides: { maxMoves: 5 }, roundSeconds: 60 },
  ],
  plating: [
    { id: "single_plates", overrides: { minBreachPieces: 1, maxBreachPieces: 1 } },
    { id: "big_breaches", overrides: { minBreachPieces: 3, maxBreachPieces: 3 } },
    { id: "grows_fast", overrides: { growAfterMoves: 1 } },
    { id: "one_breach", overrides: { breachesAtOnce: 1 } },
    { id: "five_plates", overrides: { maxMoves: 5 }, roundSeconds: 60 },
  ],
  gunnery: [
    { id: "slow_feeder", overrides: { spawnEveryTicks: 20, spawnEveryTicksMin: 16 } },
    { id: "fast_feeder", overrides: { spawnEveryTicks: 3, spawnEveryTicksMin: 2 } },
    { id: "quiet_deck", overrides: { spawnEveryTicks: 1000, spawnEveryTicksMin: 1000 } },
    { id: "no_coolant", overrides: { bag: [2, 2, 2, 0] } },
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
    { id: "junker", overrides: { "raider.tokensPerTurn": 2, "raider.reloadPerTurn": 1, "raider.accuracy": 50, "raider.aggression": 40 } },
    { id: "corsair", overrides: { "raider.tokensPerTurn": 4, "raider.reloadPerTurn": 2, "raider.accuracy": 80, "raider.aggression": 80 } },
    { id: "dead_eye", overrides: { "raider.tokensPerTurn": 4, "raider.reloadPerTurn": 4, "raider.accuracy": 100, "raider.aggression": 100 } },
    { id: "quick_turns", overrides: { turnSeconds: 6 } },
    { id: "long_turns", overrides: { turnSeconds: 30 }, roundSeconds: 600 },
    { id: "full_magazine", overrides: { "supply.turrets": 4 } },
    { id: "three_turns", overrides: { maxTurns: 3 }, roundSeconds: 60 },
  ],
  swordfight: [
    { id: "duel_quick", overrides: { foes: [{ thinkTicks: 10, skill: 60, blade: 1 }] } },
    { id: "duel_sharp", overrides: { foes: [{ thinkTicks: 12, skill: 100, blade: 2 }] } },
    { id: "duel_dull", overrides: { foes: [{ thinkTicks: 20, skill: 30, blade: 0 }] } },
    {
      id: "two_foes",
      overrides: {
        foes: [
          { thinkTicks: 14, skill: 60, blade: 1 },
          { thinkTicks: 16, skill: 50, blade: 0 },
        ],
      },
    },
    {
      id: "crew_melee",
      overrides: {
        allies: [
          { thinkTicks: 14, skill: 60, blade: 0 },
          { thinkTicks: 16, skill: 50, blade: 2 },
        ],
        foes: [
          { thinkTicks: 14, skill: 60, blade: 1 },
          { thinkTicks: 14, skill: 55, blade: 1 },
          { thinkTicks: 16, skill: 50, blade: 0 },
        ],
      },
    },
    { id: "no_offset", overrides: { offset: false } },
    { id: "breakers_galore", overrides: { breakerPermille: 400 } },
    { id: "five_colors", overrides: { colors: 5 } },
    { id: "sabre", overrides: { blade: 1 } },
    { id: "one_minute", overrides: {}, roundSeconds: 60 },
    { id: "slow_motion", overrides: {}, speed: 0.25 },
  ],
};

/** One preset per Space Battle board, so a fight can be pinned to a board the seed would not have picked. */
export function boardPresets(boards: ReadonlyArray<readonly string[]>): Preset[] {
  return boards.map((board, i) => ({ id: `board_${i + 1}`, overrides: { boards: [board] } }));
}

/** One preset per Gunnery deck, so a round can be pinned to a deck the seed would not have picked. */
export function deckPresets(decks: ReadonlyArray<readonly string[]>): Preset[] {
  return decks.map((deck, i) => ({ id: `deck_${i + 1}`, overrides: { decks: [deck] } }));
}
