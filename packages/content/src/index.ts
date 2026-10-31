import { z } from "zod";
import islands from "../data/world/islands.json" with { type: "json" };
import routes from "../data/world/routes.json" with { type: "json" };
import brigandTiers from "../data/world/brigand-tiers.json" with { type: "json" };
import shipClasses from "../data/world/ship-classes.json" with { type: "json" };
import shipGrants from "../data/world/ship-grants.json" with { type: "json" };
import bilging from "../data/puzzles/bilging.json" with { type: "json" };
import sailing from "../data/puzzles/sailing.json" with { type: "json" };
import ratingTiers from "../data/rating-tiers.json" with { type: "json" };
import names from "../data/names.json" with { type: "json" };
import en from "../data/messages/en.json" with { type: "json" };
import {
  BilgingContentSchema,
  MessagesSchema,
  NamesSchema,
  RatingTierSchema,
  SailingContentSchema,
  WorldSchema,
  type BilgingContent,
  type PieceStyle,
  type RatingTier,
  type SailingContent,
  type World,
} from "./schema.js";

export * from "./schema.js";

/** Content for every duty puzzle, keyed by puzzle id. */
export interface PuzzleContent {
  readonly bilging: BilgingContent;
  readonly sailing: SailingContent;
}
export type PuzzleContentId = keyof PuzzleContent;

export interface Content {
  readonly world: World;
  readonly puzzles: PuzzleContent;
  readonly ratingTiers: readonly RatingTier[];
  readonly names: z.infer<typeof NamesSchema>;
  readonly messages: Readonly<Record<string, string>>;
}

export class ContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentError";
  }
}

/**
 * Validate every content file and cross-reference ids. Throws ContentError on any problem so the
 * server fails loudly at start (ADR 0009). Cheap enough to call on the client too.
 */
export function loadContent(): Content {
  const world = parse("world", WorldSchema, {
    version: 1,
    islands,
    routes,
    brigandTiers,
    shipClasses,
    shipGrants,
  });
  const puzzles: PuzzleContent = {
    bilging: parse("puzzles/bilging", BilgingContentSchema, bilging),
    sailing: parse("puzzles/sailing", SailingContentSchema, sailing),
  };
  const tiers = parse("rating-tiers", z.array(RatingTierSchema).min(1), ratingTiers);
  const nameLists = parse("names", NamesSchema, names);
  const messages = parse("messages/en", MessagesSchema, en);

  crossCheck(world, puzzles, tiers, messages);
  return { world, puzzles, ratingTiers: tiers, names: nameLists, messages };
}

function parse<T>(file: string, schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) throw new ContentError(`${file}: ${z.prettifyError(r.error)}`);
  return r.data;
}

function crossCheck(world: World, puzzles: PuzzleContent, tiers: RatingTier[], messages: Record<string, string>): void {
  const problems: string[] = [];
  const need = (key: string, where: string): void => {
    if (!(key in messages)) problems.push(`${where}: missing message key "${key}"`);
  };
  const islandIds = new Set(world.islands.map((i) => i.id));
  const classIds = new Set(world.shipClasses.map((c) => c.id));
  const tierIds = new Set(world.brigandTiers.map((t) => t.id));
  const ratingTierKeys = new Set(tiers.map((t) => t.key));

  for (const i of world.islands) need(i.nameKey, `island ${i.id}`);
  for (const r of world.routes) {
    if (!islandIds.has(r.from)) problems.push(`route ${r.id}: unknown island ${r.from}`);
    if (!islandIds.has(r.to)) problems.push(`route ${r.id}: unknown island ${r.to}`);
    if (r.from === r.to) problems.push(`route ${r.id}: from and to are the same island`);
    for (const b of r.brigands) if (!tierIds.has(b.tierId)) problems.push(`route ${r.id}: unknown brigand tier ${b.tierId}`);
  }
  for (const t of world.brigandTiers) {
    need(t.nameKey, `brigand tier ${t.id}`);
    if (!classIds.has(t.shipClassId)) problems.push(`brigand tier ${t.id}: unknown ship class ${t.shipClassId}`);
  }
  for (const c of world.shipClasses) need(c.nameKey, `ship class ${c.id}`);
  for (const g of world.shipGrants) {
    if (!classIds.has(g.shipClassId)) problems.push(`ship grant ${g.id}: unknown ship class ${g.shipClassId}`);
    if (g.requires.minTier !== null && !ratingTierKeys.has(g.requires.minTier)) {
      problems.push(`ship grant ${g.id}: unknown rating tier ${g.requires.minTier}`);
    }
  }
  for (const t of tiers) need(t.nameKey, `rating tier ${t.key}`);
  if (tiers[0]!.min !== 0) problems.push("rating-tiers: the first tier must start at 0");
  for (let i = 1; i < tiers.length; i++) {
    if (tiers[i]!.min <= tiers[i - 1]!.min) problems.push("rating-tiers: tiers must be in ascending order");
  }
  for (const id of Object.keys(puzzles) as PuzzleContentId[]) {
    const p = puzzles[id];
    const where = `puzzles/${id}`;
    checkPieces(where, p.pieces, p.config.pieceKinds, messages, problems);
    for (let i = 1; i < p.thresholds.length; i++) {
      const a = p.thresholds[i - 1]!;
      const b = p.thresholds[i]!;
      if (b.score <= a.score || b.rating <= a.rating) problems.push(`${where}: thresholds must ascend in score and rating`);
    }
    need(`home.practice_${id}`, where);
    need(`home.practice_${id}_blurb`, where);
  }
  for (const s of Object.values(puzzles.bilging.specials)) need(s.nameKey, "bilging special");
  if (puzzles.sailing.config.platformSpanMax > puzzles.sailing.config.width) problems.push("puzzles/sailing: platform span exceeds the board width");
  if (problems.length) throw new ContentError(problems.join("\n"));
}

/** Every kind must differ by mark, color, and texture so pieces stay apart without color (rule 6). */
function checkPieces(where: string, pieces: ReadonlyArray<Pick<PieceStyle, "nameKey" | "mark" | "color"> & { texture: string }>, kinds: number, messages: Record<string, string>, problems: string[]): void {
  if (pieces.length < kinds) problems.push(`${where}: ${kinds} kinds but only ${pieces.length} piece definitions`);
  const marks = new Set<string>();
  const colors = new Set<string>();
  const textures = new Set<string>();
  for (const p of pieces) {
    if (!(p.nameKey in messages)) problems.push(`${where}: missing message key "${p.nameKey}"`);
    if (marks.has(p.mark)) problems.push(`${where}: mark "${p.mark}" used twice; every kind must differ by mark (rule 6)`);
    if (colors.has(p.color)) problems.push(`${where}: color "${p.color}" used twice`);
    if (textures.has(p.texture)) problems.push(`${where}: texture "${p.texture}" used twice; every kind must differ by texture`);
    marks.add(p.mark);
    colors.add(p.color);
    textures.add(p.texture);
  }
}

/** Look up a player-facing string. Unknown keys return the key itself so a miss is visible, never silent. */
export function msg(content: Content, key: string, vars?: Record<string, string | number>): string {
  const template = content.messages[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}
