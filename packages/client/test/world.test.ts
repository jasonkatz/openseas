/**
 * The world's layout, walked without drawing it. Every client builds the same place (ADR 0032): a
 * walk target one pirate sends is walked on everyone else's grid. So a grid that depended on the
 * renderer, or a door, a berth or a station nobody could reach, would only ever show as a pirate
 * standing in a wall on somebody else's screen. The boards and the shell are smoked by Playwright.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { loadContent } from "@openseas/content";
import { STATION_ORDER, skiffDeck } from "../src/world/deck.js";
import { buildOutpost, type OutpostModel } from "../src/world/outpost.js";
import type { Spot } from "../src/world/walk.js";

const content = loadContent();
const outposts = content.world.outposts;

/** An outpost as the scene builds it: its dock turned toward the middle of the chart. */
function outpost(id: string, lowQuality: boolean): OutpostModel {
  const here = outposts.find((o) => o.id === id)!;
  const cx = outposts.reduce((n, o) => n + o.x, 0) / outposts.length;
  const cy = outposts.reduce((n, o) => n + o.y, 0) / outposts.length;
  return buildOutpost(id, new THREE.Vector2(cx - here.x, cy - here.y), here.landmark, { lowQuality });
}

describe.each(outposts.map((o) => o.id))("the outpost %s", (id) => {
  const model = outpost(id, false);
  const reached = (to: Spot): boolean => model.grid.isOpen(to.x, to.z) && model.grid.path(model.arrival, to) !== null;

  it("is the same ground to walk on a software renderer as on a GPU", () => {
    expect(Array.from(outpost(id, true).grid.open)).toEqual(Array.from(model.grid.open));
  });

  it("lets a pirate who has just arrived walk to every door and into every room", () => {
    expect(model.grid.isOpen(model.arrival.x, model.arrival.z)).toBe(true);
    for (const [building, door] of Object.entries(model.doors)) {
      expect(reached(door.at), `the ${building}'s door`).toBe(true);
      // Inside is out of sight, stepped to straight through the door; it need not be open ground.
      if (door.inside) expect(Math.hypot(door.inside.x - door.at.x, door.inside.z - door.at.z), `inside the ${building}`).toBeLessThan(0.3);
    }
  });

  it("lets them walk out along the dock to the foot of a boarding tube on either side", () => {
    for (const n of [0, 1]) {
      const berth = model.berth(n);
      expect(berth.foot, `berth ${n}`).not.toBeNull();
      expect(reached(berth.foot!), `berth ${n}'s boarding tube`).toBe(true);
    }
    // Ships rafted further out have no tube of their own.
    expect(model.berth(2).foot).toBeNull();
  });

  it("stands every ship clear of the rock and of her neighbours", () => {
    const berths = [0, 1, 2, 3].map((n) => model.berth(n));
    for (const [i, a] of berths.entries()) for (const b of berths.slice(i + 1)) expect(Math.abs(a.w - b.w)).toBeGreaterThan(0.7);
    // Her stern, engines and all, lies outside the rim.
    for (const b of berths) expect(model.grid.isOpen(b.u - 0.86, b.w)).toBe(false);
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
