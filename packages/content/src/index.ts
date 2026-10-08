import { z } from "zod";
import islands from "../data/world/islands.json" with { type: "json" };
import routes from "../data/world/routes.json" with { type: "json" };
import brigandTiers from "../data/world/brigand-tiers.json" with { type: "json" };
import shipClasses from "../data/world/ship-classes.json" with { type: "json" };
import shipGrants from "../data/world/ship-grants.json" with { type: "json" };
import bilging from "../data/puzzles/bilging.json" with { type: "json" };
import ratingTiers from "../data/rating-tiers.json" with { type: "json" };
import names from "../data/names.json" with { type: "json" };
import en from "../data/messages/en.json" with { type: "json" };
import {
  BilgingContentSchema,
  MessagesSchema,
  NamesSchema,
  RatingTierSchema,
  WorldSchema,
  type BilgingContent,
  type RatingTier,
  type World,
} from "./schema.js";

export * from "./schema.js";

export interface Content {
  readonly world: World;
  readonly puzzles: { readonly bilging: BilgingContent };
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
  const bilgingContent = parse("puzzles/bilging", BilgingContentSchema, bilging);
  const tiers = parse("rating-tiers", z.array(RatingTierSchema).min(1), ratingTiers);
  const nameLists = parse("names", NamesSchema, names);
  const messages = parse("messages/en", MessagesSchema, en);

  crossCheck(world, bilgingContent, tiers, messages);
  return { world, puzzles: { bilging: bilgingContent }, ratingTiers: tiers, names: nameLists, messages };
}

function parse<T>(file: string, schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) throw new ContentError(`${file}: ${z.prettifyError(r.error)}`);
  return r.data;
}

function crossCheck(world: World, bilgingContent: BilgingContent, tiers: RatingTier[], messages: Record<string, string>): void {
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
  if (bilgingContent.pieces.length < bilgingContent.config.pieceKinds) {
    problems.push(`puzzles/bilging: ${bilgingContent.config.pieceKinds} kinds but only ${bilgingContent.pieces.length} piece definitions`);
  }
  const marks = new Set<string>();
  const colors = new Set<string>();
  for (const p of bilgingContent.pieces) {
    need(p.nameKey, "bilging piece");
    if (marks.has(p.mark)) problems.push(`puzzles/bilging: mark "${p.mark}" used twice; every kind must differ by mark (rule 6)`);
    if (colors.has(p.color)) problems.push(`puzzles/bilging: color "${p.color}" used twice`);
    marks.add(p.mark);
    colors.add(p.color);
  }
  for (const s of Object.values(bilgingContent.specials)) need(s.nameKey, "bilging special");
  for (let i = 1; i < bilgingContent.thresholds.length; i++) {
    const a = bilgingContent.thresholds[i - 1]!;
    const b = bilgingContent.thresholds[i]!;
    if (b.score <= a.score || b.rating <= a.rating) problems.push("puzzles/bilging: thresholds must ascend in score and rating");
  }
  if (problems.length) throw new ContentError(problems.join("\n"));
}

/** Look up a player-facing string. Unknown keys return the key itself so a miss is visible, never silent. */
export function msg(content: Content, key: string, vars?: Record<string, string | number>): string {
  const template = content.messages[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}
