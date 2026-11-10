import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { loadContent } from "@openseas/content";
import { battlePlanIllegalReason, chooseCaptainPlan, seedFromString, shipSupply, type BattleMove, type ShipMove } from "@openseas/engine";
import { defaultScenario, resolveScenario, SWORD_HAND_BOUNDS, SWORD_HANDS, type CrewSpec, type VoyageScenario, type VoyageSetup } from "../src/voyage/scenario.js";
import { needsPlot, flyOn, flyVoyage, startVoyage, step, type VoyageSim } from "../src/voyage/sim.js";
import { batchStats, proveVoyage, runBatch, summarize } from "../src/voyage/batch.js";
import { formatVoyage, parseVoyage } from "../src/voyage/codec.js";

const content = loadContent();
const base = defaultScenario(content);
const tier = content.world.raiderTiers[0]!.id;
/** Clear flying: no raider on the leg. */
const CLEAR = { "lane.encounterChance": 0 };
/** A raider of the first tier on every leg. */
const HAILED = { "lane.encounterChance": 1, "lane.raiders": [{ tierId: tier, weight: 1 }] };

function setup(over: Partial<VoyageScenario> = {}): VoyageSetup {
  const r = resolveScenario(content, { ...base, ...over });
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return r.setup;
}

const pirate = (station: CrewSpec["station"], duty = 100, spread = 0): CrewSpec => ({ name: "", station, duty, spread, sword: SWORD_HANDS.able });
const shipMoves = (sim: VoyageSim, type: ShipMove["type"]) => sim.shipMoves.filter((m) => m.type === type);

describe("a voyage scenario is held to the server's checks", () => {
  it("resolves the default scenario", () => {
    const r = resolveScenario(content, base);
    expect(r.ok).toBe(true);
  });

  it("refuses a world content would refuse", () => {
    const bad = (world: Record<string, unknown>) => resolveScenario(content, { ...base, world });
    expect(bad({ "rules.nope": 1 }).ok).toBe(false);
    // A leg must be a whole number of turns (content's cross-check).
    expect(bad({ "lane.durationSeconds": 215 }).ok).toBe(false);
    expect(bad({ "rules.maxSpeed": 100 }).ok).toBe(false);
    expect(bad({ "ship.minCrew": 99 }).ok).toBe(false);
    expect(bad({ "lane.raiders": [{ tierId: "nobody", weight: 1 }] }).ok).toBe(false);
    expect(bad({ "rules.ventPerTurn": 120, "lane.durationSeconds": 300 }).ok).toBe(true);
  });

  it("refuses a crew the ship would refuse", () => {
    expect(resolveScenario(content, { ...base, crew: [] }).ok).toBe(false);
    expect(resolveScenario(content, { ...base, crew: [pirate("engines"), pirate("engines")] }).ok).toBe(false);
    expect(resolveScenario(content, { ...base, crew: Array.from({ length: 7 }, () => pirate(null)) }).ok).toBe(false);
    expect(resolveScenario(content, { ...base, crew: [{ ...pirate("engines"), sword: { ...SWORD_HANDS.able, blade: 9 } }] }).ok).toBe(false);
    // A hand is held to the wire's bounds for an AI swordsman, the same the melee's config is held to.
    const hand = (sword: Partial<CrewSpec["sword"]>) => resolveScenario(content, { ...base, crew: [{ ...pirate("engines"), sword: { ...SWORD_HANDS.able, ...sword } }] }).ok;
    expect(hand({ skill: SWORD_HAND_BOUNDS.skill.max, thinkTicks: SWORD_HAND_BOUNDS.thinkTicks.max })).toBe(true);
    expect(hand({ skill: SWORD_HAND_BOUNDS.skill.max + 1 })).toBe(false);
    expect(hand({ thinkTicks: SWORD_HAND_BOUNDS.thinkTicks.min - 1 })).toBe(false);
  });
});

describe("a voyage flies as the server would fly it", () => {
  it("is deterministic and its logs replay hash for hash", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 6 }), fc.integer({ min: 0, max: 200 }), fc.constantFrom("engage", "evade", "ignore") as fc.Arbitrary<"engage" | "evade" | "ignore">, (seed, duty, hail) => {
        const s = setup({ seed, hail, crew: [pirate("navigation", duty, 20), pirate("cooling", 100, 20)], world: { "lane.encounterChance": 0.8 } });
        const a = flyVoyage(s);
        const b = flyVoyage(s);
        expect(a.shipHashes).toEqual(b.shipHashes);
        expect(a.log).toEqual(b.log);
        expect(a.done).toBe(true);
        expect(proveVoyage(a).ok).toBe(true);
      }),
      { numRuns: 12 },
    );
  });

  it("boots up bots up to the class's minimum crew", () => {
    const sim = startVoyage(setup({ crew: [pirate("navigation")], world: CLEAR }));
    expect(sim.ship.crew.filter((c) => c.bot).length).toBe(content.world.shipClasses[0]!.minCrew - 1);
    expect(sim.log.filter((e) => e.kind === "booted_up").length).toBe(3);
  });

  it("a better crew makes port sooner, up to the ship's top speed", () => {
    const turns = (duty: number) => flyVoyage(setup({ crew: [pirate("engines", duty), pirate("cooling", duty), pirate("plating", duty), pirate("navigation", duty)], world: CLEAR })).samples.length;
    expect(turns(100)).toBeLessThan(turns(60));
    expect(turns(60)).toBeLessThan(turns(20));
    // At par with a navigator the skiff is already at `maxSpeed`: more skill buys no more speed.
    expect(turns(150)).toBe(turns(100));
  });

  it("changing one pirate leaves every other pirate's rolls alone", () => {
    const duty = (sim: VoyageSim) => shipMoves(sim, "duty").filter((m) => m.type === "duty" && m.station === "engines");
    const a = flyOn(startVoyage(setup({ crew: [pirate("engines", 100, 30), pirate("cooling", 100, 30)], world: CLEAR })), { limit: 10 });
    const b = flyOn(startVoyage(setup({ crew: [pirate("engines", 100, 30), pirate("cooling", 20, 5)], world: CLEAR })), { limit: 10 });
    expect(duty(a)).toEqual(duty(b));
  });

  it("evades, lets the hail lapse, or engages, as ordered", () => {
    const first = (hail: "engage" | "evade" | "ignore") => flyVoyage(setup({ hail, world: HAILED })).log.map((e) => e.kind);
    expect(first("evade")).toContain("evaded");
    expect(first("evade")).not.toContain("engaged");
    expect(first("ignore")).toContain("evaded_auto");
    expect(first("engage")).toContain("engaged");
  });

  it("wires the battle to the ship: the deal, the supplies, the shots and the hits", () => {
    let sim = startVoyage(setup({ hail: "engage", world: HAILED }));
    while (!sim.battle && !sim.done) sim = step(sim);
    expect(sim.battle).not.toBeNull();
    const rec = sim.battles[0]!;
    // Dealt on the ship as it stood, and supplied at once with the ship's word.
    expect(rec.config.supply).toBeNull();
    expect(rec.config.startLoaded).toBe(Math.min(rec.config.turrets, sim.ship.loaded));
    expect(rec.moves[0]).toEqual({ type: "supply", ...shipSupply(sim.ship) });
    while (sim.battle && !sim.done) {
      const before = sim.ship;
      sim = step(sim);
      // After every turn of the fight, the board's last word from the ship is the ship as it now stands.
      const moves = sim.battles[0]!.moves;
      const last = moves[moves.length - 1]!;
      if (sim.battle) expect(last).toEqual({ type: "supply", ...shipSupply(sim.ship) });
      // A fight holds the ship where she is.
      if (sim.battle && before.voyage && sim.ship.voyage) expect(sim.ship.voyage.progress).toBe(before.voyage.progress);
    }
    // Every shot fired and every hit taken on the board reached the ship.
    const states = sim.battles[0]!.states;
    const shots = states.reduce((n, s, i) => n + (i > 0 && s.lastTurn && s.turn > states[i - 1]!.turn ? s.lastTurn.shots : 0), 0);
    const fired = shipMoves(sim, "fired").reduce((n, m) => n + (m.type === "fired" ? m.shots : 0), 0);
    expect(fired).toBe(shots);
    const taken = states.reduce((n, s, i) => n + (i > 0 && s.lastTurn && s.turn > states[i - 1]!.turn ? s.lastTurn.damageTaken : 0), 0);
    const hit = shipMoves(sim, "hit").reduce((n, m) => n + (m.type === "hit" ? m.damage : 0), 0);
    expect(hit).toBe(taken);
  });

  it("holds the ship in place while it fights, and pays the purse to the pirates on a win", () => {
    const runs = Array.from({ length: 6 }, (_, i) => flyVoyage(setup({ seed: `fight-${i}`, hail: "engage", world: HAILED, captain: { accuracy: 100, aggression: 100 } })));
    for (const sim of runs) {
      const fighting = sim.samples.filter((s) => s.phase !== "flying");
      for (let i = 1; i < fighting.length; i++) if (fighting[i]!.turn === fighting[i - 1]!.turn + 1) expect(fighting[i]!.progress).toBe(fighting[i - 1]!.progress);
      const outcome = summarize(sim).outcome;
      const paid = Object.values(sim.plunder).reduce((a, b) => a + b, 0);
      const won = outcome === "boarded" || outcome === "crippled";
      expect(paid).toBe(won ? content.world.raiderTiers.find((t) => t.id === tier)!.plunder : 0);
      expect(Object.keys(sim.plunder).every((id) => !id.startsWith("bot:"))).toBe(true);
    }
  });

  it("fights the boarding melee with every pirate at the airlock", () => {
    // A bold captain against a raider that boards: most fights end at the airlock.
    const sims = Array.from({ length: 6 }, (_, i) => flyVoyage(setup({ seed: `rail-${i}`, hail: "engage", world: HAILED, captain: { accuracy: 100, aggression: 100 } })));
    const melees = sims.flatMap((s) => s.melees);
    expect(melees.length).toBeGreaterThan(0);
    for (const m of melees) {
      expect(m.config.player).toBe(false);
      expect(m.config.allies.length).toBe(m.fighters.length);
      expect(m.config.foes.length).toBe(m.fighters.length);
      expect(["boarded", "boarded_by", "broke_off"]).toContain(m.outcome);
    }
  });

  it("a scripted drop holds the ship while the captain is away, and the seat is given up after the grace period", () => {
    const grace = content.world.ship.graceTurns;
    const sim = flyOn(startVoyage(setup({ crew: [pirate("navigation"), pirate("engines")], script: [{ turn: 3, who: 0, action: "away", station: null }], world: CLEAR })), { limit: grace + 4 });
    expect(sim.samples.slice(2, 2 + grace - 1).every((s) => s.held)).toBe(true);
    expect(sim.log.map((e) => e.kind)).toContain("timed_out");
    expect(sim.log.map((e) => e.kind)).toContain("helm");
    expect(sim.samples[sim.samples.length - 1]!.held).toBe(false);
  });

  it("logs a script step the ship refuses instead of failing", () => {
    const sim = flyOn(startVoyage(setup({ script: [{ turn: 2, who: 1, action: "back", station: null }], world: CLEAR })), { limit: 3 });
    expect(sim.log.find((e) => e.kind === "refused")?.vars).toMatchObject({ action: "back", who: "p2" });
  });

  it("waits for the tester's plot when the tester has the helm, and flies it", () => {
    let sim = startVoyage(setup({ hail: "engage", helm: "you", world: HAILED }));
    while (!needsPlot(sim) && !sim.done) sim = step(sim);
    expect(needsPlot(sim)).toBe(true);
    const plan = chooseCaptainPlan(sim.battle!, { accuracy: 50, aggression: 50 }, seedFromString("tester")).plan;
    expect(battlePlanIllegalReason(sim.battle!, plan)).toBeNull();
    const after = step(sim, { plan });
    const rec = after.battles[0]!;
    expect(rec.plotters).toEqual(["you"]);
    expect(rec.moves.find((m): m is Extract<BattleMove, { type: "commit" }> => m.type === "commit")).toEqual({ type: "commit", ...plan });
  });
});

describe("a batch", () => {
  it("flies each run on its own seed and adds them up", async () => {
    const s = setup({ hail: "evade", world: { "lane.encounterChance": 0.5 } });
    let progress = 0;
    const runs = await runBatch(s, 6, (n) => (progress = n));
    expect(progress).toBe(6);
    expect(new Set(runs.map((r) => r.seed)).size).toBe(6);
    const stats = batchStats(runs);
    expect(stats.runs).toBe(6);
    expect(stats.arrived).toBe(6);
    expect(stats.engaged).toBe(0);
    expect(stats.turns!.min).toBeLessThanOrEqual(stats.turns!.median);
    expect(stats.turns!.median).toBeLessThanOrEqual(stats.turns!.max);
  });
});

describe("a voyage is a link", () => {
  it("round-trips through the query string, carrying only what differs", () => {
    expect(formatVoyage(content, base)).toBe("");
    const sc: VoyageScenario = {
      ...base,
      seed: "x~y",
      hail: "ignore",
      helm: "you",
      captain: { accuracy: 90, aggression: 10 },
      crew: [{ ...pirate("engines", 120, 10), name: "Ann ~ Bonny" }, pirate(null, 0, 0)],
      script: [{ turn: 4, who: 1, action: "station", station: "plating" }],
      world: { "rules.ventPerTurn": 90, "lane.raiders": [{ tierId: tier, weight: 2 }] },
      runs: 20,
    };
    const qs = formatVoyage(content, sc, "batch");
    expect(parseVoyage(content, qs)).toEqual({ scenario: sc, autostart: "batch" });
  });
});
