import { describe, expect, it } from "vitest";
import { ContentError, contentProblems, defaultLook, loadContent, msg, pirateLookProblem, WorldSchema } from "../src/index.js";

describe("content", () => {
  it("loads and cross-validates every file", () => {
    const c = loadContent();
    expect(c.world.outposts.length).toBe(3);
    expect(c.world.shipClasses.map((s) => s.id)).toEqual(["skiff"]);
    expect(c.world.shipGrants[0]?.price).toBe(0);
    expect(c.puzzles.cooling.config.width).toBe(6);
    expect(c.ratingTiers[0]?.min).toBe(0);
    expect(c.world.startOutpostId).toBe("tinwick");
    expect(c.world.ship.turnSeconds).toBe(10);
    for (const p of Object.values(c.puzzles)) if ("parScore" in p) expect(p.parScore).toBeGreaterThan(0);
    expect(c.puzzles.battle.config.boards.length).toBeGreaterThan(0);
  });

  it("every leg is a whole number of ship turns, so a ship at full speed lands on a turn", () => {
    const c = loadContent();
    for (const r of c.world.lanes) expect(r.durationSeconds % c.world.ship.turnSeconds).toBe(0);
  });

  it("every outpost is reachable from every other", () => {
    const c = loadContent();
    const adj = new Map<string, Set<string>>();
    for (const r of c.world.lanes) {
      if (!adj.has(r.from)) adj.set(r.from, new Set());
      adj.get(r.from)!.add(r.to);
    }
    for (const start of c.world.outposts) {
      const seen = new Set([start.id]);
      const stack = [start.id];
      while (stack.length) {
        const cur = stack.pop()!;
        for (const n of adj.get(cur) ?? []) if (!seen.has(n)) (seen.add(n), stack.push(n));
      }
      expect(seen.size).toBe(c.world.outposts.length);
    }
  });

  it("legs fit the design's 3 to 5 minute window", () => {
    for (const r of loadContent().world.lanes) {
      expect(r.durationSeconds).toBeGreaterThanOrEqual(180);
      expect(r.durationSeconds).toBeLessThanOrEqual(300);
    }
  });

  it("rejects a lane to an unknown outpost at the schema level", () => {
    expect(() => WorldSchema.parse({ version: 1, startOutpostId: "x", outposts: [], lanes: [], raiderTiers: [], shipClasses: [], shipGrants: [] })).toThrow();
  });

  it("message lookup substitutes variables and surfaces misses", () => {
    const c = loadContent();
    expect(msg(c, "home.welcome", { name: "Salty Gull" })).toBe("Welcome aboard, Salty Gull.");
    expect(msg(c, "does.not.exist")).toBe("does.not.exist");
  });

  it("ContentError is what loud startup failures throw", () => {
    expect(new ContentError("x")).toBeInstanceOf(Error);
  });

  it("pirate looks: every jacket and headgear is a choice, a default look is drawn from the id and always allowed", () => {
    const rules = loadContent().world.pirates;
    expect(pirateLookProblem(rules, { jacket: rules.jackets[0]!.id, headgear: rules.headgear[0]!.id })).toBeNull();
    expect(pirateLookProblem(rules, { jacket: "gold-lame", headgear: rules.headgear[0]!.id })).toMatch(/jacket/);
    expect(pirateLookProblem(rules, { jacket: rules.jackets[0]!.id, headgear: "crown" })).toMatch(/headgear/);
    const looks = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const look = defaultLook(rules, `pirate-${i}`);
      expect(pirateLookProblem(rules, look)).toBeNull();
      expect(defaultLook(rules, `pirate-${i}`)).toEqual(look);
      looks.add(`${look.jacket}/${look.headgear}`);
    }
    // A deck of new pirates is a mixed crew, not one uniform.
    expect(looks.size).toBeGreaterThan(20);
  });

  it("pirate titles name real puzzles and tiers, and no two ask the same thing", () => {
    const c = loadContent();
    expect(c.world.pirates.titles.some((t) => t.requires.kind === "start")).toBe(true);
    const bad = structuredClone(c) as typeof c & { world: { pirates: { titles: unknown[] } } };
    bad.world.pirates.titles.push(
      { id: "kraken-tamer", nameKey: "title.void_hound", requires: { kind: "standing", puzzle: "core", tier: "sharp" } },
      { id: "twice", nameKey: "title.void_hound", requires: { kind: "voyages", count: 10 } },
    );
    const problems = contentProblems(bad);
    expect(problems.some((p) => p.includes("unknown puzzle core"))).toBe(true);
    expect(problems.some((p) => p.includes("twice: asks the same"))).toBe(true);
  });
});
