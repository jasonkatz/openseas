import { z } from "zod";

const Cell = z.int().min(0).max(119);

export const AssemblyMoveSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("swap"), a: Cell, b: Cell }),
  z.object({ type: z.literal("fit"), slot: z.int().min(0).max(7), cell: Cell }),
  z.object({ type: z.literal("end") }),
]);
export type AssemblyMoveWire = z.infer<typeof AssemblyMoveSchema>;

const Weight = z.int().min(0).max(100);

export const AssemblyConfigSchema = z.object({
  width: z.int().min(4).max(10).describe("Columns in the bay."),
  height: z.int().min(4).max(12).describe("Rows in the bay."),
  kindWeights: z
    .array(Weight)
    .length(4)
    .refine((w) => w.some((x) => x > 0) && w[1]! + w[2]! + w[3]! > 0, "some part must move")
    .describe("How often each kind is dealt: panel, girder, strut, cable. Panels move only when pushed."),
  traySize: z.int().min(1).max(8).describe("Blueprints in the tray at once: the most a chain can be set up for."),
  fitPoints: z.int().min(0).max(1000).describe("Points a fit earns for each part over two, times its place in the chain."),
  chainCap: z.int().min(1).max(20).describe("The place in a chain counts up to this and holds. 1 switches chains off: every fit counts as the first."),
  corePoints: z.int().min(0).max(1000).describe("Points for each core a fit takes, times its place in the chain."),
  startCores: z.int().min(0).max(10).describe("Cores in the opening bay. No more than the most cores."),
  corePermille: z.int().min(0).max(500).describe("Chance, per mille, that a new part is a core, while the bay holds fewer than its most."),
  maxCores: z.int().min(0).max(10).describe("The most cores in the bay at once. 0, with no start cores: no cores."),
  maxMoves: z.int().min(1).max(1_000_000).describe("Longest move log the server accepts."),
});
export type AssemblyConfigWire = z.infer<typeof AssemblyConfigSchema>;
