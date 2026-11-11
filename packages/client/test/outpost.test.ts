/**
 * An outpost drawn round its layout. How it is drawn may depend on the renderer (a software renderer
 * gets no shadows); where a pirate may walk never does (ADR 0035), so drawing takes the layout as it
 * is and leaves it so.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { loadContent } from "@openseas/content";
import { buildOutpost } from "../src/world/outpost.js";
import { outpostLayout } from "../src/world/outpostLayout.js";

const outposts = loadContent().world.outposts;

describe.each(outposts.map((o) => [o.id, o.landmark] as const))("the outpost %s, drawn", (id, landmark) => {
  it("walks the layout it was given at either render quality, and leaves its ground as laid out", () => {
    const laid = Array.from(outpostLayout(id, landmark).grid.open);
    for (const lowQuality of [true, false]) {
      const layout = outpostLayout(id, landmark);
      const model = buildOutpost(layout, new THREE.Vector2(1, 0.3), { lowQuality });
      expect(model.layout).toBe(layout);
      expect(Array.from(model.layout.grid.open), lowQuality ? "a software renderer" : "a GPU").toEqual(laid);
    }
  });

  it("hangs a door that swings in every doorway a pirate goes in by", () => {
    const layout = outpostLayout(id, landmark);
    const model = buildOutpost(layout, new THREE.Vector2(1, 0.3), { lowQuality: true });
    const entered = Object.entries(layout.doors).filter(([, door]) => door.inside !== null).map(([b]) => b);
    expect(Object.keys(model.doorways).sort()).toEqual(entered.sort());
  });
});
