import { REACTOR_DEF, type ReactorConfig, type ReactorMove, type ReactorState } from "@openseas/engine";
import { content } from "@openseas/boards";
import type { HarnessPuzzle } from "../puzzles.js";
import { REACTOR_PRESETS } from "../scenario/prototypes/reactor.js";

/** What the bench needs to know about Reactor: its content config, presets and seed probes. */
export const REACTOR: HarnessPuzzle<ReactorState, ReactorMove, ReactorConfig> = {
  id: "reactor",
  def: REACTOR_DEF,
  config: content.puzzles.reactor.config,
  roundSeconds: content.puzzles.reactor.roundSeconds,
  presets: REACTOR_PRESETS,
  probes: [
    { id: "ports_one_wall", test: (s) => s.ports.length >= 2 && s.ports.every((p) => p.side === s.ports[0]!.side) },
    { id: "two_first", test: (s) => s.next === 2 },
    { id: "corner_ports", test: (s) => s.ports.every((p) => p.lane === 0 || p.lane === s.config.size - 1) },
  ],
  locked: [],
  ticked: null,
  hints: true,
};
