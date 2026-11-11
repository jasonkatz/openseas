import type { DutyPuzzleId } from "@openseas/engine";
import type { PuzzleStarted } from "@openseas/protocol";

/** A round on a practice page, bound to no ship. */
export interface PracticeBinding {
  readonly kind: "practice";
}

/** A round played at a ship's station rather than on a practice page. */
export interface DutyBinding {
  readonly kind: "duty";
  readonly shipId: string;
  readonly station: DutyPuzzleId;
  readonly voyageId: string;
  /** Cooling only: the ship's heat in rows when the board is dealt. */
  readonly heat?: number;
}

/** The captain's space battle aboard a ship (M4). Its tokens, loads and hull come from the ship. */
export interface BattleBinding {
  readonly kind: "battle";
  readonly shipId: string;
  readonly voyageId: string;
  readonly tierId: string;
}

/** A pirate's board in a boarding melee aboard a ship (M5). Its foes are outside it; the server lanes the attacks. */
export interface MeleeBinding {
  readonly kind: "melee";
  readonly shipId: string;
  readonly voyageId: string;
  readonly tierId: string;
}

/** What a puzzle session is played for. Every session has exactly one, fixed when it is dealt. */
export type SessionBinding = PracticeBinding | DutyBinding | BattleBinding | MeleeBinding;

export const PRACTICE: PracticeBinding = { kind: "practice" };

/**
 * What a kind of board means to the server. Everything that treats a practice round, a duty board,
 * the captain's battle and a melee board differently reads it here rather than asking which
 * binding a session has.
 */
export interface BindingPolicy {
  /**
   * When a scored round moves standing (ADR 0028): the battle and a melee board always, a duty
   * board only when it ran its full clock or the engine ended it, a practice round never.
   */
  readonly rated: "always" | "ran_full" | "never";
  /**
   * Whether a missing move hands the board back instead of throwing the round out (ADR 0024). Only
   * the boards whose client rebuilds from a resumed deal: the battle and a melee board.
   */
  readonly handsBack: boolean;
  /** Whether a Cooling board plays a lone ship's heat (ADR 0029). Aboard, the heat is the ship's. */
  readonly loneShip: boolean;
  /**
   * What becomes of the round when its pirate quits it (abandons it or starts another): a duty board
   * is cut short and counts, as when the ship docks; any other round is abandoned.
   */
  readonly quit: "cut_short" | "abandon";
  /**
   * Whether the board is a fight aboard: the captain's battle or a melee board. A station never
   * takes a pirate out of one: a duty board is refused while their fight board is open.
   */
  readonly fight: boolean;
  /** The voyage the round was played on, recorded with it. */
  readonly voyageId: string | null;
  /** The deal's field that says which ship the board belongs to. A practice deal has none. */
  readonly wire: Pick<PuzzleStarted, "duty" | "battle" | "melee">;
  /** What the `puzzle.started` event records about the binding. */
  readonly startedEvent: Readonly<Record<string, string>>;
  /** What the `puzzle.completed` event records about the binding. */
  readonly completedEvent: Readonly<Record<string, string>>;
}

export function bindingPolicy(b: SessionBinding): BindingPolicy {
  switch (b.kind) {
    case "practice":
      return { rated: "never", handsBack: false, loneShip: true, quit: "abandon", fight: false, voyageId: null, wire: {}, startedEvent: {}, completedEvent: {} };
    case "duty":
      return {
        rated: "ran_full",
        handsBack: false,
        loneShip: false,
        quit: "cut_short",
        fight: false,
        voyageId: b.voyageId,
        wire: { duty: { shipId: b.shipId, station: b.station, ...(b.heat !== undefined ? { heat: b.heat } : {}) } },
        startedEvent: { voyageId: b.voyageId },
        completedEvent: { voyageId: b.voyageId, shipId: b.shipId },
      };
    case "battle":
      return {
        rated: "always",
        handsBack: true,
        loneShip: false,
        quit: "abandon",
        fight: true,
        voyageId: b.voyageId,
        wire: { battle: { shipId: b.shipId, tierId: b.tierId } },
        startedEvent: { voyageId: b.voyageId, tierId: b.tierId },
        completedEvent: { voyageId: b.voyageId, shipId: b.shipId, tierId: b.tierId },
      };
    case "melee":
      return {
        rated: "always",
        handsBack: true,
        loneShip: false,
        quit: "abandon",
        fight: true,
        voyageId: b.voyageId,
        wire: { melee: { shipId: b.shipId, tierId: b.tierId } },
        startedEvent: { voyageId: b.voyageId, tierId: b.tierId },
        completedEvent: { voyageId: b.voyageId, shipId: b.shipId, tierId: b.tierId },
      };
  }
}
