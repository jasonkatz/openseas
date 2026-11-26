// Made from tricks.puzzle.json: a game of bids and tricks for four seats in two sides.
import type { GridCell, Outcome, Points, Puzzle, Seat, Side } from "@openseas/engine";

export interface Tricks extends Puzzle {
  cell: GridCell;
  settings: { target: number; nilBonus: number; turnSeconds: number };
  moves: { bid: { tricks: number }; play: { card: number } };
  events: {
    dealt: { seat: Seat };
    bid: { seat: Seat; tricks: number };
    played: { seat: Seat; card: number };
    took: { seat: Seat; cards: number };
    counted: { side: Side; made: number; points: Points };
    passed: { seat: Seat };
    won: { side: Side };
  };
  signals: { stakes: number; rematch: Outcome };
  pieces: "card";
  states: never;
  terrain: never;
  phases: "hand" | "bids" | "tricks" | "trick";
  zones: "deck" | "hand" | "trick" | "won";
  draws: "shuffle";
  payouts: "contract" | "bags" | "leftover";
  endings: "target";
  standIns: "careful" | "bold";
}
