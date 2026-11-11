import { SCANNER_DEF, scannerDistance, scannerProvenCells } from "@openseas/engine";
import { harnessPuzzle } from "../puzzles.js";

/** What the bench needs to know about Scanner: its seed probes. */
export const SCANNER = harnessPuzzle(SCANNER_DEF, {
  probes: [
    { id: "wide_open", test: (s) => (s.pings[0]?.distance ?? 0) >= 5 },
    { id: "one_ring", test: (s) => scannerProvenCells(s).length > 0 },
    { id: "huddle", test: (s) => s.contacts.some((a) => s.contacts.some((b) => scannerDistance(s.config, a, b) === 1)) },
  ],
  hints: true,
});
