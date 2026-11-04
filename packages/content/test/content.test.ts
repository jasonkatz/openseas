import { describe, expect, it } from "vitest";
import { ContentError, loadContent, msg, WorldSchema } from "../src/index.js";

describe("content", () => {
  it("loads and cross-validates every file", () => {
    const c = loadContent();
    expect(c.world.islands.length).toBe(3);
    expect(c.world.shipClasses.map((s) => s.id)).toEqual(["sloop"]);
    expect(c.world.shipGrants[0]?.price).toBe(0);
    expect(c.puzzles.bilging.config.width).toBe(6);
    expect(c.ratingTiers[0]?.min).toBe(0);
    expect(c.world.startIslandId).toBe("saltwick");
    expect(c.world.ship.turnSeconds).toBe(10);
    for (const p of Object.values(c.puzzles)) if ("parScore" in p) expect(p.parScore).toBeGreaterThan(0);
    expect(c.puzzles.battle.config.boards.length).toBeGreaterThan(0);
  });

  it("every leg is a whole number of ship turns, so a ship at full speed lands on a turn", () => {
    const c = loadContent();
    for (const r of c.world.routes) expect(r.durationSeconds % c.world.ship.turnSeconds).toBe(0);
  });

  it("every island is reachable from every other", () => {
    const c = loadContent();
    const adj = new Map<string, Set<string>>();
    for (const r of c.world.routes) {
      if (!adj.has(r.from)) adj.set(r.from, new Set());
      adj.get(r.from)!.add(r.to);
    }
    for (const start of c.world.islands) {
      const seen = new Set([start.id]);
      const stack = [start.id];
      while (stack.length) {
        const cur = stack.pop()!;
        for (const n of adj.get(cur) ?? []) if (!seen.has(n)) (seen.add(n), stack.push(n));
      }
      expect(seen.size).toBe(c.world.islands.length);
    }
  });

  it("legs fit the design's 3 to 5 minute window", () => {
    for (const r of loadContent().world.routes) {
      expect(r.durationSeconds).toBeGreaterThanOrEqual(180);
      expect(r.durationSeconds).toBeLessThanOrEqual(300);
    }
  });

  it("rejects a route to an unknown island at the schema level", () => {
    expect(() => WorldSchema.parse({ version: 1, startIslandId: "x", islands: [], routes: [], brigandTiers: [], shipClasses: [], shipGrants: [] })).toThrow();
  });

  it("message lookup substitutes variables and surfaces misses", () => {
    const c = loadContent();
    expect(msg(c, "home.welcome", { name: "Salty Gull" })).toBe("Welcome aboard, Salty Gull.");
    expect(msg(c, "does.not.exist")).toBe("does.not.exist");
  });

  it("ContentError is what loud startup failures throw", () => {
    expect(new ContentError("x")).toBeInstanceOf(Error);
  });
});
