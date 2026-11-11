import { RACKS_DEF, racksCrateFits, racksTopGroup } from "@openseas/engine";
import { harnessPuzzle } from "../puzzles.js";

/** What the bench needs to know about Racks: its seed probes. */
export const RACKS = harnessPuzzle(RACKS_DEF, {
  probes: [
    { id: "no_room", test: (s) => !racksCrateFits(s) },
    { id: "one_kind_crate", test: (s) => s.crate.cells.every((c) => c.kind === s.crate.cells[0]!.kind) },
    { id: "crate_joins", test: (s) => racksTopGroup(s.racks[s.crate.rack]!)?.kind === s.crate.cells[0]!.kind },
  ],
  hints: true,
});
