/**
 * The world's layout, walked without drawing it. Every client lays out the same place (ADR 0032): a
 * walk target one pirate sends is walked on everyone else's grid. So a layout that came out
 * differently twice, or a door, a berth or a station nobody could reach, would only ever show as a
 * pirate standing in a wall on somebody else's screen. Nothing here loads three.js: a layout draws
 * nothing, so no renderer and no render setting can reach it. The boards and the shell are smoked by
 * Playwright.
 */
import { describe, expect, it, vi } from "vitest";
import { loadContent } from "@openseas/content";
import { STATION_ORDER, skiffDeck } from "../src/world/deck.js";
import { outpostLayout } from "../src/world/outpostLayout.js";
import type { Spot } from "../src/world/walk.js";

// This file does not load if a layout reaches for three.js.
vi.mock("three", () => {
  throw new Error("a layout draws nothing, so it never needs three.js");
});

const outposts = loadContent().world.outposts;

describe.each(outposts.map((o) => [o.id, o.landmark] as const))("the outpost %s", (id, landmark) => {
  const layout = outpostLayout(id, landmark);
  const reached = (to: Spot): boolean => layout.grid.isOpen(to.x, to.z) && layout.grid.path(layout.arrival, to) !== null;

  it("is laid out the same every time, from its id and its landmark alone", () => {
    const again = outpostLayout(id, landmark);
    expect(Array.from(again.grid.open)).toEqual(Array.from(layout.grid.open));
    expect(again.doors).toEqual(layout.doors);
    expect(again.arrival).toEqual(layout.arrival);
    expect([0, 1, 2, 3].map((n) => again.berth(n))).toEqual([0, 1, 2, 3].map((n) => layout.berth(n)));
  });

  it("lets a pirate who has just arrived walk to every door and into every room", () => {
    expect(layout.grid.isOpen(layout.arrival.x, layout.arrival.z)).toBe(true);
    for (const [building, door] of Object.entries(layout.doors)) {
      expect(reached(door.at), `the ${building}'s door`).toBe(true);
      // Inside is out of sight, stepped to straight through the door; it need not be open ground.
      if (door.inside) expect(Math.hypot(door.inside.x - door.at.x, door.inside.z - door.at.z), `inside the ${building}`).toBeLessThan(0.3);
    }
  });

  it("lets them walk out along the dock to the foot of a boarding tube on either side", () => {
    for (const n of [0, 1]) {
      const berth = layout.berth(n);
      expect(berth.foot, `berth ${n}`).not.toBeNull();
      expect(reached(berth.foot!), `berth ${n}'s boarding tube`).toBe(true);
    }
    // Ships rafted further out have no tube of their own.
    expect(layout.berth(2).foot).toBeNull();
  });

  it("stands every ship clear of the rock and of her neighbours", () => {
    const berths = [0, 1, 2, 3].map((n) => layout.berth(n));
    for (const [i, a] of berths.entries()) for (const b of berths.slice(i + 1)) expect(Math.abs(a.w - b.w)).toBeGreaterThan(0.7);
    // Her stern, engines and all, lies outside the rim.
    for (const b of berths) expect(layout.grid.isOpen(b.u - 0.86, b.w)).toBe(false);
  });
});

describe("the skiff's deck", () => {
  const deck = skiffDeck();
  const from = deck.airlock(1);
  const reached = (to: Spot): boolean => deck.grid.isOpen(to.x, to.z) && deck.grid.path(from, to) !== null;

  it("can be walked from either airlock to every station, the helm and every place to stand", () => {
    expect(reached(deck.airlock(-1)), "the port airlock").toBe(true);
    for (const station of STATION_ORDER) expect(reached(deck.stations[station].at), station).toBe(true);
    expect(reached(deck.helm.at), "the helm").toBe(true);
    for (const [i, spot] of deck.idle.entries()) expect(reached(spot), `idle spot ${i}`).toBe(true);
  });

  it("gives every post a place of its own", () => {
    const posts = [...STATION_ORDER.map((s) => deck.stations[s].at), deck.helm.at, ...deck.idle];
    for (const [i, a] of posts.entries()) for (const b of posts.slice(i + 1)) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(0.04);
  });

  it("has the bridge forward, two steps up, and the main deck level", () => {
    expect(deck.heightAt(deck.helm.at.x, deck.helm.at.z)).toBeGreaterThan(deck.heightAt(0, 0));
    expect(deck.helm.at.x).toBeGreaterThan(0);
    for (const station of ["cooling", "engines", "plating", "gunnery"] as const) expect(deck.heightAt(deck.stations[station].at.x, deck.stations[station].at.z)).toBe(deck.heightAt(0, 0));
  });
});
