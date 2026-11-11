import type { PuzzleId } from "@openseas/engine";

/**
 * What a guide is made of (ADR 0038). One file per puzzle exports one `Guide`. The page lays every
 * guide out the same way, so a reader who has read one knows where to look in the next.
 *
 * Writing rules, held by `test/guides.test.ts` where a test can hold them:
 * - Plain words, short sentences, second person. Say what to do and why it pays.
 * - Every number comes from the puzzle's content or its engine: import `content` and write it
 *   into the sentence, so a retune changes the guide. Never type a tuned number by hand.
 * - `**bold**` is the only markup, for the one term a sentence introduces.
 * - A guide is one sitting: the limits below are the budget, not a target.
 */
export interface Guide {
  readonly id: PuzzleId;
  /** One line under the title: the puzzle's verb. At most 90 characters. */
  readonly tagline: string;
  /** The board, at the top of the page. */
  readonly hero: Media;
  readonly theme: {
    /** What this is aboard the ship, in the game's world. Two or three sentences. */
    readonly setting: string;
    /** What playing it well does for the ship and the crew. For a prototype: what it is trying out. */
    readonly purpose: string;
  };
  /** The card beside the hero: board size, round length, what a round is rated against. Three or four. */
  readonly facts: readonly Fact[];
  /** The rules a first round needs, in the order a player meets them. Four to seven. */
  readonly rules: readonly string[];
  /** One picture of the basic move, shown with the rules. */
  readonly rulesMedia?: Media;
  /** Every input, for touch and for mouse and keyboard. */
  readonly controls: readonly Control[];
  /** How points are made, shortest true version. Two to four. */
  readonly scoring: readonly string[];
  /** The ladder, in this order: beginner, intermediate, advanced, expert. */
  readonly stages: readonly [Stage, Stage, Stage, Stage];
  /** What goes wrong, and what to do about it. Three to five. */
  readonly mistakes: readonly string[];
}

export interface Fact {
  readonly label: string;
  readonly value: string;
}

export interface Control {
  readonly action: string;
  readonly touch: string;
  readonly desktop: string;
}

export const LEVELS = ["beginner", "intermediate", "advanced", "expert"] as const;
export type Level = (typeof LEVELS)[number];

/** One rung of the ladder: what to aim for at this level, how, and what to practise. */
export interface Stage {
  readonly level: Level;
  /** What a player at this level is trying to get good at, in one sentence. */
  readonly goal: string;
  /** Two to four. Each is one idea. */
  readonly tips: readonly Tip[];
  /** One thing to practise in the next few rounds, and how to know it worked. */
  readonly drill: string;
}

export interface Tip {
  readonly title: string;
  /** Two to four sentences. */
  readonly body: string;
  readonly media?: Media;
}

/**
 * A picture captured from the real board (`capture/<id>.capture.ts`): `public/media/<id>/<name>.webp`,
 * and for a clip `<name>.mp4` beside it. `alt` says what is on the board for someone who cannot see
 * it; `caption` says what to notice.
 */
export interface Media {
  readonly kind: "still" | "clip";
  readonly name: string;
  readonly alt: string;
  readonly caption: string;
}
