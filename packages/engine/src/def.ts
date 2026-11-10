/**
 * The shape every puzzle engine registers (ADR 0015). It lives apart from the registry so an engine
 * module can export its own definition without importing the registry that lists it.
 */
import type { PuzzleId } from "./registry.js";

/** What every finished round reports. The database row and the result message share this shape. */
export interface PuzzleSummary {
  readonly score: number;
  readonly moves: number;
  readonly bestCombo: number;
}

/**
 * How a board logs the server's word for one kind of vouched move (ADR 0042).
 * - `standing`: a reading, such as the ship's heat. The latest word replaces the last and stands
 *   until the next, so the board may log it more than once.
 * - `latest`: a deal, such as the battle's supply at a turn. The latest word replaces any the board
 *   has not logged, and the board logs it once.
 * - `queue`: a stream, such as a melee's incoming scrap. The board logs each word once, in the order
 *   the server said them.
 * - `server`: the server's own move, such as a melee board's win (ADR 0022). The server writes it
 *   into the log itself, and a board never logs it.
 */
export type VouchedRule = "standing" | "latest" | "queue" | "server";

/**
 * A kind of move the player does not make (ADR 0022, ADR 0042): the server puts it in the board's
 * log on the ship's word, and accepts it from the board only as it said it.
 */
export type VouchedKind<M> =
  | {
      /** Names the kind within its puzzle. */
      readonly kind: string;
      readonly rule: "standing" | "latest" | "queue";
      /**
       * True when the board's `move` says what the server said in `said`. A field the board fills in
       * itself, such as the tick a move lands at, is not compared.
       */
      same(said: M, move: M): boolean;
    }
  | {
      readonly kind: string;
      readonly rule: "server";
    };

export interface PuzzleDef<S, M, C> {
  readonly id: PuzzleId;
  readonly defaultConfig: C;
  validateConfig(config: C): void;
  create(seed: string, config: C): S;
  /** Throws InvalidMoveError on an illegal move. Never mutates `state`. */
  reduce(state: S, move: M): S;
  hash(state: S): string;
  summarize(state: S): PuzzleSummary;
  isFinished(state: S): boolean;
  /** The longest move log the server accepts for this config. */
  maxMoves(config: C): number;
  /**
   * For engines whose moves carry their own clock (ticks): the ms since round start this move
   * claims to happen at. The server rejects claims ahead of the wall clock. Undefined when moves
   * are untimed.
   */
  moveTimeMs?(move: M, config: C): number;
  /**
   * For engines with moves the player does not make (ADR 0042): which kind of vouched move this is,
   * or null for one of the player's own. Undefined when every move is the player's.
   */
  vouched?(move: M): VouchedKind<M> | null;
}
