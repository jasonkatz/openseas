// Assembly, played beside the engine the studio deals. Both are dealt from the same luck, and are held to the same bay,
// tray, chain and score after every swap and fit.
import { assemblyHint, assemblyLegalFits, assemblyLegalSwaps, createAssemblyGame, DEFAULT_ASSEMBLY_CONFIG, reduceAssembly, type AssemblyConfig, type AssemblyMove, type AssemblyState } from "@openseas/engine";
import { describe, expect, it } from "vitest";
import assembly, { PARTS, type FitMove, type SwapMove, type Yard } from "../examples/assembly.puzzle.js";
import { expand, explain, listMoves, nextInt, play, read, replay, seedFromString, start, type Round, type Setting } from "../src/index.js";

const SEEDS = Number(process.env.SEEDS ?? 12);
const MOVES = 150;
/** Hands the event loop back for a moment. */
const breathe = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

const settingsOf = (c: AssemblyConfig): Record<string, Setting> => ({
  width: c.width,
  height: c.height,
  maxMoves: c.maxMoves,
  kindWeights: c.kindWeights,
  traySize: c.traySize,
  fitPoints: c.fitPoints,
  corePoints: c.corePoints,
  chainPercent: Array.from({ length: c.chainCap }, (_, k) => 100 * (k + 1)),
  startCores: c.startCores,
  corePermille: c.corePermille,
  maxCores: c.maxCores,
});
const streamsOf = (seed: number) => ({ parts: seedFromString(`assembly:parts:seed-${seed}`), cores: seedFromString(`assembly:cores:seed-${seed}`), prints: seedFromString(`assembly:prints:seed-${seed}`) });
const CONFIGS: Record<string, AssemblyConfig> = {
  "as shipped": DEFAULT_ASSEMBLY_CONFIG,
  // Cores everywhere and a short cap: chains held at the cap, cores paid.
  "many cores, a short cap": { ...DEFAULT_ASSEMBLY_CONFIG, chainCap: 2, startCores: 5, maxCores: 8, corePermille: 300, corePoints: 25 },
  // A narrow, tall bay, a small tray, lopsided weights: deals tried again, and a bag refilled many times.
  "a narrow bay, a small tray": { ...DEFAULT_ASSEMBLY_CONFIG, width: 4, height: 9, traySize: 2, kindWeights: [60, 5, 30, 5], startCores: 0, corePermille: 0 },
};

const kindName = (k: number): string => (k === 100 ? "core" : PARTS[k]!);
const shippedBay = (s: AssemblyState): string[][] => Array.from({ length: s.config.height }, (_, y) => Array.from({ length: s.config.width }, (_, x) => kindName(s.cells[y * s.config.width + x]!.kind)));
const at = (c: AssemblyConfig, i: number) => ({ x: i % c.width, y: Math.floor(i / c.width) });

describe("Assembly on the new engine, beside the engine the studio deals", () => {
  for (const [name, config] of Object.entries(CONFIGS)) {
    it(`holds the same bay, tray, chain and score, move for move: ${name}`, async () => {
      const seen = { fits: 0, chains: 0, capped: 0, cores: 0, big: 0, swaps: 0 };
      for (let seed = 1; seed <= SEEDS; seed++) {
        await breathe();
        let shipped = createAssemblyGame(`seed-${seed}`, config);
        let round: Round<SwapMove | FitMove> = start(assembly, { seed, settings: settingsOf(config), streams: streamsOf(seed) });
        let picks = seedFromString(`picks-${seed}`);
        const pick = (n: number): number => {
          const r = nextInt(picks, n);
          picks = r.state;
          return r.value;
        };
        const level = (where: string): void => {
          const now = read(round);
          const yard = (now.state as { yard: Yard }).yard;
          expect(now.board.map((r) => r.map((p) => p!.piece)), where).toEqual(shippedBay(shipped));
          expect(yard.tray, where).toEqual(shipped.tray.map((b) => b.shape));
          expect(yard.bag, where).toEqual(shipped.bag);
          expect(now.score, where).toBe(shipped.score);
          expect(now.streak, where).toBe(shipped.chain);
          expect(now.stats, where).toMatchObject({ swaps: shipped.swaps, fits: shipped.fits, bigFits: shipped.bigFits, coresUsed: shipped.coresUsed });
        };
        level(`seed ${seed}, the deal`);
        for (let m = 0; m < MOVES && !shipped.finished; m++) {
          const where = `seed ${seed}, move ${m + 1}`;
          const fits = assemblyLegalFits(shipped);
          const swaps = assemblyLegalSwaps(shipped);
          const listed = listMoves(round);
          expect(listed.filter((x) => x.move === "fit").length, where).toBe(fits.length);
          expect(listed.filter((x) => x.move === "swap").length, where).toBe(swaps.length);
          // Mostly the move the shipped hint gives, else any fit, else any swap.
          const kind = pick(10);
          const hint = assemblyHint(shipped);
          const move: AssemblyMove | null =
            kind < 6 && hint ? hint : kind < 8 && fits.length > 0 ? { type: "fit", ...fits[pick(fits.length)]! } : swaps.length > 0 ? { type: "swap", ...swaps[pick(swaps.length)]! } : null;
          if (!move) break;
          shipped = reduceAssembly(shipped, move);
          round = play(round, move.type === "fit" ? { move: "fit", slot: move.slot, at: at(config, move.cell) } : { move: "swap", a: at(config, (move as { a: number }).a), b: at(config, (move as { b: number }).b) });
          expect(round.last.refused, where).toBeNull();
          const fit = shipped.lastMove!.fit;
          if (fit) {
            seen.fits++;
            if (fit.place > 1) seen.chains++;
            if (shipped.chain > config.chainCap) seen.capped++;
            if (fit.cores > 0) seen.cores++;
            if (fit.taken.length >= 5) seen.big++;
          } else seen.swaps++;
          level(where);
        }
      }
      // The comparison means something only if the rounds reached every rule.
      expect(seen.fits, "fits").toBeGreaterThan(10);
      if (name !== "a narrow bay, a small tray") expect(seen.chains, "chains").toBeGreaterThan(0);
      expect(seen.swaps, "swaps").toBeGreaterThan(0);
      expect(seen.big, "fits of five").toBeGreaterThan(0);
      if (name === "many cores, a short cap") expect(seen.capped, "chains past the cap").toBeGreaterThan(0), expect(seen.cores, "cores fitted").toBeGreaterThan(0);
    }, 180_000);
  }
});

describe("Assembly as a puzzle of its own", () => {
  it("deals, plays and replays from its seed, settings and log", () => {
    for (let seed = 1; seed <= 3; seed++) {
      let round = start(assembly, { seed });
      for (let m = 0; m < 40; m++) {
        const moves = listMoves(round);
        if (moves.length === 0) break;
        round = play(round, moves[(m * 7) % moves.length]!);
      }
      expect(read(round).stats.fits).toBeGreaterThan(0);
      expect(replay(assembly, String(seed), {}, round.log).state).toEqual(round.state);
    }
  });

  it("refuses a swap the parts cannot make, and a fit that hangs off or does not match", () => {
    const round = start(assembly, { seed: 1 });
    expect(play(round, { move: "swap", a: { x: 0, y: 0 }, b: { x: 2, y: 0 } }).last.refused).toBe("reason.not_neighbours");
    expect(play(round, { move: "fit", slot: 9, at: { x: 0, y: 0 } }).last.refused).toBe("reason.no_blueprint");
    expect(play(round, { move: "fit", slot: 0, at: { x: 5, y: 5 } }).last.refused).toBe("reason.hangs_off");
  });

  it("is all there to read: its scoring declared, each hook explained", () => {
    const doc = JSON.parse(expand(assembly)) as { payouts: { id: string }[]; streak: unknown };
    expect(doc.payouts.map((p) => p.id)).toEqual(["fit", "cores"]);
    expect(doc.streak).toEqual({ builds: { event: "fit" }, counts: "events", grace: 0, breaksOn: ["swap"] });
    expect(explain(assembly)).toMatchInlineSnapshot(`
      "onStart    yard
      canMove    yard (swap, fit)
      onMove     yard (swap, fit)
      listMoves  yard"
    `);
  });
});
