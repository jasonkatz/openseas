/**
 * Overload (prototype, ADR 0036): a bank of capacitors, each holding a charge of 0 to 3. A tap adds
 * one charge to a capacitor. A capacitor that reaches 4 bursts: it empties and passes one charge to
 * each neighbour above, below, left and right (charge passed off the edge is lost). Every capacitor
 * at 4 or more bursts in the next wave, and so on until none is left. A capacitor bursts once in a
 * chain: after that it is spent, and charge passed to it is lost. So a capacitor goes when its
 * charge plus its bursting neighbours reach 4, and a chain can be read before the tap.
 *
 * Everything one tap sets off is one chain, and a chain of n bursts scores n times n, so one chain
 * of ten is worth far more than two of five. When the chain ends, every spent capacitor is swapped
 * for a fresh one with a random charge, so the bank never drains.
 *
 * Taps are scarce: the player holds a few, and one comes back every `tapRegenTicks`. A tap that sets
 * nothing off still charges a capacitor, and spending one to join two clusters before the tap that
 * sets them off is the skill. A long chain gives taps back. A booster is a rare capacitor that
 * passes two charges to each neighbour when it bursts.
 *
 * The draw (M11): the ship asks for a chain of a size, a band from `drawSizes[i]` to that plus
 * `drawSpan` bursts. A chain whose bursts land in the band meets the draw, scores `drawPercent` on
 * top of the streak, and the next draw is asked for. A chain past the band is only a chain. The draw
 * has a stream of its own, so turning it on deals the same bank; with `drawSizes` empty nothing is
 * drawn and a round hashes as it did before there was a draw.
 *
 * Cell index = row * width + col. Row 0 is the top row.
 *
 * Time is data: every move carries the integer `tick` it happens at, and the reducer counts the
 * taps that have come back by that tick first. Nothing here reads a clock (ADR 0003, ADR 0015).
 */
import type { PrngState } from "../prng.js";

/** A capacitor bursts when its charge reaches this: one for each neighbour it passes to. */
export const OVERLOAD_FULL = 4;

export interface OverloadConfig {
  readonly width: number;
  readonly height: number;
  /** How likely a fresh capacitor is to hold 0, 1, 2 or 3 charges, as weights. */
  readonly refill: readonly number[];
  /** Chance, per thousand, that a fresh capacitor is a booster. */
  readonly boosterPermille: number;
  /** A chain of n bursts scores burstPoints * n * n, and burstPoints * n * chainCap past the cap. */
  readonly burstPoints: number;
  readonly chainCap: number;
  /** A chain this long or longer builds the streak; a shorter chain breaks it. A tap that bursts nothing does neither. */
  readonly streakMin: number;
  /** What the streak multiplies a chain by, in percent: the first long chain takes the first entry, a streak past the end takes the last. */
  readonly streakPercent: readonly number[];
  /** The most taps the player can hold, and how many the round opens with. */
  readonly tapCap: number;
  readonly startTaps: number;
  /** Ticks for one tap to come back. Nothing is banked while the player holds tapCap. */
  readonly tapRegenTicks: number;
  /** A chain gives one tap back for every `refundEvery` bursts in it. 0 gives none back. */
  readonly refundEvery: number;
  /**
   * The draw (M11): the ship asks for a chain of `drawSizes[i]` to that plus `drawSpan` bursts. A
   * chain in that band meets the draw: it scores `drawPercent` and the next draw is asked for, picked
   * from `drawSizes` from a stream of its own when `drawRandom`, else the next in the list, round and
   * round. Empty: no draw, and nothing is drawn for it.
   */
  readonly drawSizes: readonly number[];
  readonly drawSpan: number;
  readonly drawPercent: number;
  readonly drawRandom: boolean;
  /** Wall-clock ms per tick on the client; the server uses it to bound claimed ticks. */
  readonly tickMs: number;
  /** No move may claim a tick beyond this; the round is over by then. */
  readonly maxTick: number;
  /** Longest move log the server accepts: taps and waits. */
  readonly maxMoves: number;
}

export const DEFAULT_OVERLOAD_CONFIG: OverloadConfig = {
  width: 6,
  height: 7,
  refill: [30, 35, 25, 10],
  boosterPermille: 40,
  burstPoints: 1,
  chainCap: 20,
  streakMin: 4,
  streakPercent: [100, 125, 150, 175, 200, 225, 250, 275, 300],
  tapCap: 5,
  startTaps: 5,
  tapRegenTicks: 25,
  refundEvery: 4,
  drawSizes: [],
  drawSpan: 0,
  drawPercent: 100,
  drawRandom: false,
  tickMs: 100,
  maxTick: 1200,
  maxMoves: 1000,
};

export interface OverloadCell {
  /** Stable identity for animation. A capacitor that bursts is swapped for one with a new id. */
  readonly id: number;
  /** 0 to 3 once a move has settled. */
  readonly charge: number;
  readonly booster: boolean;
}

export type OverloadMove =
  /** Add one charge to the capacitor at `cell`. Costs one tap. */
  | { readonly type: "tap"; readonly cell: number; readonly tick: number }
  /** Nothing but time passing, so the taps that came back reach the server. */
  | { readonly type: "wait"; readonly tick: number }
  /** The round is over. Without a tick it ends at the tick the round has reached. */
  | { readonly type: "end"; readonly tick?: number };

/** One wave of a chain: the capacitors that burst together, and every capacitor's charge once their charge has been passed on. */
export interface OverloadWave {
  /** Cells that burst in this wave, in index order. */
  readonly bursts: readonly number[];
  /** Which of those burst as boosters, passing two charges a neighbour. */
  readonly boosted: readonly number[];
  /** The charge on every cell after this wave, by cell index: 0 for a spent cell. A live cell at 4 or more bursts in the next wave. */
  readonly charges: readonly number[];
}

/** A capacitor swapped in when a chain ends. */
export interface OverloadFresh {
  readonly cell: number;
  readonly id: number;
  readonly charge: number;
  readonly booster: boolean;
}

export type OverloadEvent =
  /** A tap landed: the capacitor's charge after it. `burst` is true when that set off a chain. */
  | { readonly seq: number; readonly tick: number; readonly type: "tap"; readonly cell: number; readonly charge: number; readonly burst: boolean }
  /** A chain ran its course. */
  | {
      readonly seq: number;
      readonly tick: number;
      readonly type: "chain";
      /** The capacitor that was tapped. */
      readonly cell: number;
      readonly waves: readonly OverloadWave[];
      /** Bursts in all. */
      readonly size: number;
      /** What the chain scored before the streak. */
      readonly base: number;
      /** The streak this chain was scored at, and what it multiplied by, in percent. */
      readonly streak: number;
      readonly streakPercent: number;
      /** True when this chain broke a streak that was running. */
      readonly brokeStreak: boolean;
      /** Taps given back. */
      readonly refund: number;
      /** True when the chain met the draw; what the draw added to its points; the draw asked for after it (its smallest chain), 0 with no draw. */
      readonly drawMet: boolean;
      readonly drawPoints: number;
      readonly draw: number;
      /** The fresh capacitors swapped in for the spent ones, in index order. */
      readonly fresh: readonly OverloadFresh[];
      readonly points: number;
    };

export interface OverloadMoveReport {
  readonly move: OverloadMove;
  readonly events: readonly OverloadEvent[];
  readonly points: number;
}

export interface OverloadState {
  readonly config: OverloadConfig;
  readonly tick: number;
  /** Always full: every cell holds a capacitor. */
  readonly cells: readonly OverloadCell[];
  readonly rng: PrngState;
  readonly nextId: number;
  /** Taps held at `tick`. */
  readonly taps: number;
  /** The tick the tap now coming back started from. Equal to `tick` while the player holds tapCap. */
  readonly regenFrom: number;
  /** The `seq` of the last event made. Events are numbered from 1, so a board can tell which it has shown. */
  readonly eventSeq: number;
  readonly score: number;
  /** Taps made. */
  readonly moveCount: number;
  /** Every move in the log, waits included. */
  readonly logLength: number;
  /** Long chains in a row: the streak. */
  readonly combo: number;
  readonly bestCombo: number;
  /** Chains set off, of any size. */
  readonly chains: number;
  /** The longest chain, in bursts. */
  readonly bestChain: number;
  /** Bursts in all. */
  readonly bursts: number;
  /** Taps given back by long chains. */
  readonly refunds: number;
  /** The draw asked for now: the smallest chain that meets it, and which of `drawSizes` it is. 0 and 0 with no draw. */
  readonly draw: number;
  readonly drawIndex: number;
  /** The draw's own stream, apart from the bank's, so a draw changes nothing that is dealt. Unused with no draw. */
  readonly drawRng: PrngState;
  /** Draws met, and the points the draw added. */
  readonly draws: number;
  readonly drawScore: number;
  readonly lastMove: OverloadMoveReport | null;
  readonly finished: boolean;
}
