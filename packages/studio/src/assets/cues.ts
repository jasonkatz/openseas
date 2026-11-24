import type { PuzzleId } from "@openseas/engine";

/**
 * The cues each puzzle's board plays (DESIGN.md 3.14, ADR 0062 decision 5): what the Sounds list shows. A cue is a
 * name `sfx` is asked for, by the puzzle's board in `boards` or by its page here, which is where
 * a core board's sounds are played from. test/cues.test.ts reads those sources and holds this
 * list to them, so a cue added to a board without a row here fails.
 */
export const PUZZLE_CUES: Readonly<Record<PuzzleId, readonly string[]>> = {
  cooling: ["swap", "swapQuiet", "clear", "multi", "streak", "streakLost", "charge", "magnet", "slag", "vent", "rise", "alarm", "beat"],
  engines: ["swapQuiet", "clear", "multi", "slag", "streakLost", "alarm", "tick", "beat"],
  plating: ["welder", "plateLift", "clear", "multi", "crack", "streakLost", "bump", "tick", "beat"],
  gunnery: ["swap", "swapQuiet", "clear", "streak", "streakLost", "charge", "vent", "tick", "beat"],
  navigation: ["swap", "swapQuiet", "clear", "multi", "streak", "streakLost", "charge", "tick", "beat"],
  battle: ["swap", "swapQuiet", "clear", "streak", "streakLost", "charge", "crack", "vent", "alarm", "tick", "end", "beat"],
  swordfight: ["drop", "clash", "heavy", "swing", "scrap", "out", "won", "lost", "swapQuiet", "clear", "multi", "streak", "streakLost", "charge", "slag", "crack", "vent", "alarm", "bump", "thud", "whoosh", "zap", "bad", "tick", "end", "beat"],
  salvage: ["pop", "good", "rise", "slag", "crack", "bump", "thud", "whoosh", "beat"],
  overload: ["pop", "power", "zap", "good", "slag", "streak", "streakLost", "swapQuiet", "bump", "whoosh", "beat"],
  deflectors: ["swap", "pop", "power", "zap", "good", "bad", "multi", "bump", "thud", "tick", "beat"],
  reactor: ["swap", "swapQuiet", "pop", "power", "charge", "clear", "zap", "bad", "streakLost", "bump", "tick", "beat"],
  scanner: ["ping", "pop", "good", "bad", "streakLost", "swapQuiet", "bump", "whoosh", "beat"],
  tug: ["pop", "ping", "clear", "good", "bad", "streak", "swapQuiet", "bump", "thud", "whoosh", "beat"],
  racks: ["swap", "swapQuiet", "pop", "clear", "multi", "crack", "bad", "streakLost", "bump", "thud", "whoosh", "tick", "beat"],
  cutting: ["clear", "crack", "zap", "good", "streakLost", "bump", "thud", "whoosh", "tick", "beat"],
  tractor: ["swap", "swapQuiet", "pop", "clear", "zap", "good", "rise", "thud", "bump", "whoosh", "beat"],
  refining: ["swap", "pop", "clear", "streak", "streakLost", "good", "bad", "thud", "whoosh", "bump", "beat"],
  freefall: ["pop", "thud", "ping", "multi", "whoosh", "good", "bad", "bump", "tick", "beat"],
  showdown: ["swapQuiet", "tick", "pop", "whoosh", "bump", "good", "bad", "beat"],
  forging: ["pop", "good", "streak", "streakLost", "bad", "zap", "bump", "beat"],
  assembly: ["swap", "pop", "clear", "good", "rise", "bump", "beat"],
};

/** What every round sounds, whatever the puzzle: the page plays these around the board (practice/usePractice). */
export const ROUND_CUES: readonly string[] = ["start", "tick", "end"];

/**
 * A puzzle's own cues (`sfx.cue`) are moments of its board with a name of their own and no voice
 * of that name: each names the cues its renderer plays for it, so the list can play them.
 */
export const OWN_CUE_FALLBACKS: Readonly<Partial<Record<PuzzleId, Readonly<Record<string, readonly string[]>>>>> = {
  swordfight: { drop: ["bump"], clash: ["zap"], heavy: ["zap", "thud"], swing: ["whoosh"], scrap: ["thud"], out: ["bad"], won: ["end"], lost: ["streakLost"] },
};

/** Every cue the sound panel lists for a puzzle: its board's, then the round's. */
export function cuesOf(puzzle: PuzzleId): string[] {
  return [...new Set([...PUZZLE_CUES[puzzle], ...ROUND_CUES])];
}

const NOTE_NAMES = ["G", "A", "B", "D", "E"];
/** A step of the one key by name, as the sound editor labels it: 0 is G2, 15 is G5. The octave's number turns at C, so its D and E sit one above its G. */
export const noteName = (n: number): string => `${NOTE_NAMES[n % 5]}${2 + Math.floor(n / 5) + (n % 5 >= 3 ? 1 : 0)}`;
