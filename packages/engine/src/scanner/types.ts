/**
 * Scanner (prototype, ADR 0036): a fogged sector hiding a handful of contacts. A ping on a cell
 * answers with one number: how many steps (up, down, left, right) the nearest hidden contact is. So
 * no hidden contact lies nearer than that, and at least one lies exactly that far, somewhere on the
 * diamond of cells at that distance. Rings that cross pin a contact down, and a lock on its cell
 * finds it.
 *
 * The numbers are live. When a contact is found, every ping that was hearing it sounds again and
 * shows how far the nearest contact still hidden is: a number on the board is always true of what is
 * left to find.
 *
 * Both verbs can go wrong, and either mistake costs points and the streak. A lock on empty space is
 * one. The other is a ping that lands on a contact: it spooks the contact, which is given away for
 * no bounty. So a ping belongs on a cell the numbers prove empty, and a lock on a cell they prove
 * taken. Each sector opens with one ping already made on empty space, well away from every contact,
 * to reason from, and a sector is only dealt if it can be cleared from there with no guess.
 *
 * When every contact is found or spooked the sector is cleared and the next is dealt, one contact
 * richer every few sectors. Each sector allows a number of pings (its par), and a ping past par
 * costs. A sector cleared within par with no mistake is clean: it pays for every ping left over and
 * builds a streak that multiplies bounties and savings.
 *
 * Cell index = row * width + col. Row 0 is the top row. Nothing here reads a clock.
 *
 * The contacts sit in the state, which the client holds: a prototype's score counts for nothing
 * (ADR 0036), and a Scanner that did count would need the server to answer pings.
 */
import type { PrngState } from "../prng.js";

export interface ScannerConfig {
  readonly width: number;
  readonly height: number;
  /** Contacts in the first sector. */
  readonly startContacts: number;
  /** One more contact every growEvery sectors cleared, up to maxContacts. */
  readonly growEvery: number;
  readonly maxContacts: number;
  /** A sector of k contacts allows parBase + parPerContact * k pings. */
  readonly parBase: number;
  readonly parPerContact: number;
  /**
   * How far from every contact the sector's opening ping is made, at least; it takes the farthest
   * cell there is when none is that far. 0 deals no opening ping.
   */
  readonly openingMin: number;
  /**
   * A sector is dealt again, up to this many deals in all, until the plain arguments can clear it
   * from the opening ping with no guess (see `plainlySolvable`). 1 takes the first deal as it comes.
   */
  readonly dealTries: number;
  /** Each contact found by a lock. */
  readonly contactPoints: number;
  /** Each ping of the allowance left unspent when a sector is cleared clean: within par, with no mistake. */
  readonly savePoints: number;
  /** Each ping past the allowance. */
  readonly overPenalty: number;
  /** A lock on empty space. */
  readonly wrongPenalty: number;
  /** A ping that lands on a contact. */
  readonly spookPenalty: number;
  /** What the streak multiplies a contact and a sector's savings by, in percent: no streak takes the first entry, a streak past the end takes the last. */
  readonly streakPercent: readonly number[];
  /** Longest move log the server accepts. */
  readonly maxMoves: number;
}

export const DEFAULT_SCANNER_CONFIG: ScannerConfig = {
  width: 6,
  height: 6,
  startContacts: 3,
  growEvery: 2,
  maxContacts: 5,
  parBase: 0,
  parPerContact: 2,
  openingMin: 3,
  dealTries: 12,
  contactPoints: 40,
  savePoints: 20,
  overPenalty: 10,
  wrongPenalty: 60,
  spookPenalty: 60,
  streakPercent: [100, 120, 140, 160, 180, 200],
  maxMoves: 2000,
};

export type ScannerMove =
  /** Ask how far the nearest hidden contact is from `cell`. */
  | { readonly type: "ping"; readonly cell: number }
  /** Say a contact is at `cell`. */
  | { readonly type: "lock"; readonly cell: number }
  | { readonly type: "end" };

/** A ping made this sector on empty space, and what it says now. */
export interface ScannerPing {
  readonly cell: number;
  /** Steps to the nearest contact still hidden: at least 1 while the sector is in play. */
  readonly distance: number;
  /** True for the ping the sector opened with: it was not the player's and is not counted against par. */
  readonly opening: boolean;
}

/** A ping whose number changed because the contact it was hearing became known. */
export interface ScannerResound {
  readonly cell: number;
  readonly from: number;
  readonly to: number;
}

/** A sector as it was cleared, for the board to play before it shows the next. */
export interface ScannerClear {
  /** Which sector it was, counting from 0. */
  readonly sector: number;
  /** Every contact's cell. */
  readonly contacts: readonly number[];
  /** Pings the player spent on it. */
  readonly pings: number;
  readonly par: number;
  /** Pings of the allowance left unspent, when the sector was clean; 0 when it was not. */
  readonly saved: number;
  /** What the unspent pings paid, after the streak. */
  readonly bonus: number;
  /** True when the sector was cleared within par with no wrong lock and no spooked contact: it builds the streak. */
  readonly clean: boolean;
  /** The streak after this sector. */
  readonly streak: number;
}

export interface ScannerMoveReport {
  readonly move: ScannerMove;
  readonly cell: number;
  /** What a ping answered; 0 when it landed on a contact; null for a lock. */
  readonly distance: number | null;
  /** True when this move was a lock on a contact. */
  readonly found: boolean;
  /** True for a lock on empty space. */
  readonly wrong: boolean;
  /** True for a ping that landed on a contact. */
  readonly spooked: boolean;
  /** Pings that sounded again because this move made a contact known, in the order they were made. Empty when the sector was cleared. */
  readonly resound: readonly ScannerResound[];
  /** Points for the contact found, after the streak; 0 when none was. */
  readonly findPoints: number;
  /** What the move cost: a ping past par, a spooked contact, a wrong lock. 0 or less. */
  readonly cost: number;
  /** What the streak multiplied by, in percent, when the move was made. */
  readonly streakPercent: number;
  readonly cleared: ScannerClear | null;
  /** What the score moved by, all told. The score never goes below zero, so a cost may bite less than its size. */
  readonly points: number;
}

export interface ScannerState {
  readonly config: ScannerConfig;
  readonly rng: PrngState;
  /** The sector in play, counting from 0. */
  readonly sector: number;
  /** Hidden from the player: every contact's cell in this sector, in index order. */
  readonly contacts: readonly number[];
  /** Contacts found by a lock this sector, in the order found. */
  readonly found: readonly number[];
  /** Contacts a ping landed on this sector: given away, and known now like the found ones. */
  readonly spooked: readonly number[];
  /** Pings made on empty space this sector, in order, the opening ping first, each with what it says now. */
  readonly pings: readonly ScannerPing[];
  /** Pings the player has spent this sector, the ones that spooked a contact included. The opening ping is not one of them. */
  readonly spent: number;
  /** Cells wrongly locked this sector: known empty now. */
  readonly misses: readonly number[];
  /** Pings this sector allows before each further one costs. */
  readonly par: number;
  readonly score: number;
  /** Pings and locks made, all sectors. */
  readonly moveCount: number;
  /** Sectors cleared in a row within par with no wrong lock and no spooked contact. */
  readonly combo: number;
  readonly bestCombo: number;
  readonly sectorsCleared: number;
  readonly cleanSectors: number;
  readonly contactsFound: number;
  readonly pingsMade: number;
  readonly pingsSaved: number;
  readonly wrongLocks: number;
  readonly contactsSpooked: number;
  readonly lastMove: ScannerMoveReport | null;
  readonly finished: boolean;
}
