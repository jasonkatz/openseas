import { describe, expect, it } from "vitest";
import { PRACTICE, bindingPolicy, type SessionBinding } from "../src/puzzles/binding.js";

const fight = { shipId: "ship-1", voyageId: "v-1", tierId: "junker" };

describe("bindingPolicy", () => {
  it.each<[string, SessionBinding, ReturnType<typeof bindingPolicy>]>([
    [
      "a practice round is never rated, thrown out on a missing move, abandoned when quit, and plays the lone ship",
      PRACTICE,
      { rated: "never", handsBack: false, loneShip: true, quit: "abandon", voyageId: null, wire: {}, startedEvent: {}, completedEvent: {} },
    ],
    [
      "a duty board is rated when it ran full, thrown out on a missing move, cut short when quit, and plays the ship's heat",
      { kind: "duty", shipId: "ship-1", station: "cooling", voyageId: "v-1", heat: 4 },
      {
        rated: "ran_full",
        handsBack: false,
        loneShip: false,
        quit: "cut_short",
        voyageId: "v-1",
        wire: { duty: { shipId: "ship-1", station: "cooling", heat: 4 } },
        startedEvent: { voyageId: "v-1" },
        completedEvent: { voyageId: "v-1", shipId: "ship-1" },
      },
    ],
    [
      "the captain's battle is always rated, handed back on a missing move and abandoned when quit",
      { kind: "battle", ...fight },
      {
        rated: "always",
        handsBack: true,
        loneShip: false,
        quit: "abandon",
        voyageId: "v-1",
        wire: { battle: { shipId: "ship-1", tierId: "junker" } },
        startedEvent: { voyageId: "v-1", tierId: "junker" },
        completedEvent: { voyageId: "v-1", shipId: "ship-1", tierId: "junker" },
      },
    ],
    [
      "a melee board is always rated, handed back on a missing move and abandoned when quit",
      { kind: "melee", ...fight },
      {
        rated: "always",
        handsBack: true,
        loneShip: false,
        quit: "abandon",
        voyageId: "v-1",
        wire: { melee: { shipId: "ship-1", tierId: "junker" } },
        startedEvent: { voyageId: "v-1", tierId: "junker" },
        completedEvent: { voyageId: "v-1", shipId: "ship-1", tierId: "junker" },
      },
    ],
  ])("%s", (_name, binding, policy) => {
    expect(bindingPolicy(binding)).toEqual(policy);
  });

  it("a duty board dealt off the Cooling station names no heat on the wire", () => {
    expect(bindingPolicy({ kind: "duty", shipId: "ship-1", station: "engines", voyageId: "v-1" }).wire).toStrictEqual({ duty: { shipId: "ship-1", station: "engines" } });
  });
});
