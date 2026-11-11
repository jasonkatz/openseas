import { REACTOR_DEF } from "@openseas/engine";
import { harnessPuzzle } from "../puzzles.js";

/** What the bench needs to know about Reactor: its seed probes. */
export const REACTOR = harnessPuzzle(REACTOR_DEF, {
  probes: [
    { id: "ports_one_wall", test: (s) => s.ports.length >= 2 && s.ports.every((p) => p.side === s.ports[0]!.side) },
    { id: "two_first", test: (s) => s.next === 2 },
    { id: "corner_ports", test: (s) => s.ports.every((p) => p.lane === 0 || p.lane === s.config.size - 1) },
  ],
  hints: true,
});
