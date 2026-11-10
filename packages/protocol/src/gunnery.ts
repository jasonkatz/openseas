import { z } from "zod";

const Dir = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
const Tick = z.int().min(0).max(100_000);
const Cell = z.int().min(0).max(63);

export const GunneryMoveSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("arrow"), col: Cell, row: Cell, dir: Dir, tick: Tick }),
  z.object({ type: z.literal("remove"), col: Cell, row: Cell, tick: Tick }),
  z.object({ type: z.literal("wait"), tick: Tick }),
  z.object({ type: z.literal("end"), tick: Tick }),
]);
export type GunneryMoveWire = z.infer<typeof GunneryMoveSchema>;

/**
 * One deck, a string per row. Its shape is checked here; the engine's `deckProblems` checks that it
 * plays (no loop built in, a stream that leaves, every gun within reach).
 */
const DeckSchema = z
  .array(z.string().regex(/^[#.XBCH]+$/, "deck rows use # . X B C H").min(5).max(64))
  .min(5)
  .max(64)
  .superRefine((rows, ctx) => {
    const width = rows[0]?.length ?? 0;
    if (rows.some((r) => r.length !== width)) ctx.addIssue({ code: "custom", message: "deck rows must be the same width" });
    if (rows.join("").split("B").length !== 2) ctx.addIssue({ code: "custom", message: "deck needs exactly one feeder" });
  });

export const GunneryConfigSchema = z.object({
  decks: z
    .array(DeckSchema)
    .min(1)
    .max(32)
    .superRefine((decks, ctx) => {
      const [height, width] = [decks[0]?.length, decks[0]?.[0]?.length];
      if (decks.some((d) => d.length !== height || d[0]?.length !== width)) ctx.addIssue({ code: "custom", message: "every deck must be the same size" });
    }),
  tickMs: z.int().min(20).max(5000),
  maxTick: z.int().min(1).max(100_000),
  maxMoves: z.int().min(1).max(10_000),
  maxOnDeck: z.int().min(1).max(64),
  spawnEveryTicks: z.int().min(1).max(1000),
  spawnEveryTicksMin: z.int().min(1).max(1000),
  queueLength: z.int().min(0).max(8),
  bag: z.array(z.int().min(0).max(64)).length(4),
  fireAfterTicks: z.int().min(1).max(10_000),
  stepPoints: z.int().min(0).max(100_000),
  loadPoints: z.int().min(0).max(100_000),
  comboStep: z.int().min(0).max(100_000),
  comboCap: z.int().min(0).max(1000),
  broadsidePoints: z.int().min(0).max(100_000),
});
export type GunneryConfigWire = z.infer<typeof GunneryConfigSchema>;
