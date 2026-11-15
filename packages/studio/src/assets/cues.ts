import type { PuzzleId } from "@openseas/engine";

/**
 * The cues each puzzle's board plays (DESIGN.md 3.14): what the sound panel lists. A cue is a
 * name `sfx` is asked for, by the puzzle's board in `boards` or by its page here, which is where
 * a core board's sounds are played from. test/cues.test.ts reads those sources and holds this
 * list to them, so a cue added to a board without a row here fails.
 */
export const PUZZLE_CUES: Readonly<Record<PuzzleId, readonly string[]>> = {
  cooling: ["swap", "swapQuiet", "clear", "multi", "streak", "streakLost", "charge", "magnet", "slag", "vent", "rise", "alarm"],
  engines: ["swapQuiet", "clear", "multi", "slag", "streakLost", "alarm", "tick"],
  plating: ["welder", "plateLift", "clear", "multi", "crack", "streakLost", "bump", "tick"],
  gunnery: ["swap", "swapQuiet", "clear", "streak", "streakLost", "charge", "vent", "tick"],
  navigation: ["swap", "swapQuiet", "clear", "multi", "streak", "streakLost", "charge", "slag", "tick"],
  battle: ["swap", "swapQuiet", "clear", "streak", "streakLost", "charge", "crack", "vent", "alarm", "tick", "end"],
  swordfight: ["drop", "clash", "heavy", "swing", "scrap", "out", "won", "lost", "swapQuiet", "clear", "multi", "streak", "streakLost", "charge", "slag", "crack", "vent", "alarm", "bump", "thud", "whoosh", "zap", "bad", "tick", "end"],
  salvage: ["pop", "good", "slag", "streak", "bump", "thud", "whoosh"],
  overload: ["pop", "power", "charge", "zap", "good", "multi", "slag", "streak", "streakLost", "swapQuiet", "bump", "thud", "whoosh"],
  deflectors: ["swap", "pop", "power", "zap", "good", "bad", "multi", "streak", "bump", "thud", "tick"],
  reactor: ["swap", "swapQuiet", "pop", "power", "charge", "clear", "zap", "bad", "streak", "streakLost", "bump", "tick"],
  scanner: ["ping", "pop", "good", "bad", "streak", "streakLost", "swapQuiet", "bump", "whoosh"],
  tug: ["pop", "ping", "clear", "good", "bad", "streak", "swapQuiet", "bump", "thud", "whoosh"],
  racks: ["swap", "swapQuiet", "pop", "clear", "multi", "crack", "bad", "streak", "streakLost", "bump", "thud", "whoosh", "tick"],
  cutting: ["clear", "crack", "zap", "good", "streak", "streakLost", "bump", "thud", "whoosh", "tick"],
};

/** What every round sounds, whatever the puzzle: the page plays these around the board (practice/usePractice). */
export const ROUND_CUES: readonly string[] = ["start", "tick", "end"];

/**
 * A puzzle's own cues (`sfx.cue`, ADR 0041) have no synthesized voice of their name: each names
 * the synthesized cues its renderer plays behind it, so the panel can play that fallback.
 */
export const OWN_CUE_FALLBACKS: Readonly<Partial<Record<PuzzleId, Readonly<Record<string, readonly string[]>>>>> = {
  swordfight: { drop: ["bump"], clash: ["zap"], heavy: ["zap", "thud"], swing: ["whoosh"], scrap: ["thud"], out: ["bad"], won: ["end"], lost: ["streakLost"] },
};

/** Every cue the sound panel lists for a puzzle: its board's, then the round's. */
export function cuesOf(puzzle: PuzzleId): string[] {
  return [...new Set([...PUZZLE_CUES[puzzle], ...ROUND_CUES])];
}
