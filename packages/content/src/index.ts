import { z } from "zod";
import ocean from "../data/world/ocean.json" with { type: "json" };
import islands from "../data/world/islands.json" with { type: "json" };
import routes from "../data/world/routes.json" with { type: "json" };
import brigandTiers from "../data/world/brigand-tiers.json" with { type: "json" };
import shipClasses from "../data/world/ship-classes.json" with { type: "json" };
import shipGrants from "../data/world/ship-grants.json" with { type: "json" };
import bilging from "../data/puzzles/bilging.json" with { type: "json" };
import sailing from "../data/puzzles/sailing.json" with { type: "json" };
import carpentry from "../data/puzzles/carpentry.json" with { type: "json" };
import gunnery from "../data/puzzles/gunnery.json" with { type: "json" };
import navigation from "../data/puzzles/navigation.json" with { type: "json" };
import battle from "../data/puzzles/battle.json" with { type: "json" };
import ratingTiers from "../data/rating-tiers.json" with { type: "json" };
import names from "../data/names.json" with { type: "json" };
import en from "../data/messages/en.json" with { type: "json" };
import {
  BattleContentSchema,
  BilgingContentSchema,
  CarpentryContentSchema,
  GunneryContentSchema,
  MessagesSchema,
  NamesSchema,
  NavigationContentSchema,
  RatingTierSchema,
  SailingContentSchema,
  WorldSchema,
  type BattleContent,
  type BilgingContent,
  type CarpentryContent,
  type GunneryContent,
  type NavigationContent,
  type PieceStyle,
  type RatingTier,
  type SailingContent,
  type World,
} from "./schema.js";

export * from "./schema.js";

/** Content for every duty puzzle, keyed by puzzle id. */
export interface DutyPuzzleContent {
  readonly bilging: BilgingContent;
  readonly sailing: SailingContent;
  readonly carpentry: CarpentryContent;
  readonly gunnery: GunneryContent;
  readonly navigation: NavigationContent;
}
export type DutyPuzzleContentId = keyof DutyPuzzleContent;

/** Every puzzle's content: the duty puzzles and the captain's sea battle. */
export interface PuzzleContent extends DutyPuzzleContent {
  readonly battle: BattleContent;
}
export type PuzzleContentId = keyof PuzzleContent;
export const DUTY_PUZZLE_CONTENT_IDS: readonly DutyPuzzleContentId[] = ["bilging", "sailing", "carpentry", "gunnery", "navigation"];

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
    ...ocean,
    islands,
    routes,
    brigandTiers,
    shipClasses,
    shipGrants,
  });
  const puzzles: PuzzleContent = {
    bilging: parse("puzzles/bilging", BilgingContentSchema, bilging),
    sailing: parse("puzzles/sailing", SailingContentSchema, sailing),
    carpentry: parse("puzzles/carpentry", CarpentryContentSchema, carpentry),
    gunnery: parse("puzzles/gunnery", GunneryContentSchema, gunnery),
    navigation: parse("puzzles/navigation", NavigationContentSchema, navigation),
    battle: parse("puzzles/battle", BattleContentSchema, battle),
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

  for (const i of world.islands) {
    need(i.nameKey, `island ${i.id}`);
    need(i.blurbKey, `island ${i.id}`);
  }
  if (!islandIds.has(world.startIslandId)) problems.push(`ocean: unknown start island ${world.startIslandId}`);
  if (world.ship.maxSpeed < world.ship.idleSpeed) problems.push("ocean: ship.maxSpeed below ship.idleSpeed");
  if (world.ship.encounterWindow.to < world.ship.encounterWindow.from) problems.push("ocean: ship.encounterWindow ends before it starts");
  for (const r of world.routes) {
    if (r.durationSeconds % world.ship.turnSeconds !== 0) problems.push(`route ${r.id}: durationSeconds must be a whole number of turns of ${world.ship.turnSeconds}s`);
  }
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
    if ("pieces" in p) checkPieces(where, p.pieces, "pieceKinds" in p.config ? p.config.pieceKinds : p.pieces.length, messages, problems);
    for (let i = 1; i < p.thresholds.length; i++) {
      const a = p.thresholds[i - 1]!;
      const b = p.thresholds[i]!;
      if (b.score <= a.score || b.rating <= a.rating) problems.push(`${where}: thresholds must ascend in score and rating`);
    }
    need(`home.practice_${id}`, where);
    need(`home.practice_${id}_blurb`, where);
    if (!("parScore" in p)) continue;
    need(`station.${id}`, where);
    need(`station.${id}_blurb`, where);
    const first = p.thresholds[0]!.score;
    const last = p.thresholds[p.thresholds.length - 1]!.score;
    if (p.parScore < first || p.parScore > last) problems.push(`${where}: parScore must sit within the thresholds (${first}..${last})`);
  }
  {
    const b = puzzles.battle;
    if (b.config.maxTurns * b.config.turnSeconds > b.roundSeconds) problems.push("puzzles/battle: roundSeconds must cover maxTurns turns of turnSeconds");
    if (b.config.startLoaded > b.config.cannons) problems.push("puzzles/battle: startLoaded exceeds cannons");
    for (const t of world.brigandTiers) {
      const cls = world.shipClasses.find((c) => c.id === t.shipClassId);
      if (cls && t.reloadPerTurn > cls.cannons) problems.push(`brigand tier ${t.id}: reloads more cannons than its ${cls.id} carries`);
    }
  }
  for (const s of Object.values(puzzles.bilging.specials)) need(s.nameKey, "bilging special");
  for (const sh of puzzles.carpentry.shapes) need(sh.nameKey, "carpentry shape");
  if (puzzles.carpentry.config.maxHolePieces < puzzles.carpentry.config.minHolePieces) problems.push("puzzles/carpentry: maxHolePieces below minHolePieces");
  if (puzzles.gunnery.config.maxTick * puzzles.gunnery.config.tickMs < puzzles.gunnery.roundSeconds * 1000) {
    problems.push("puzzles/gunnery: maxTick * tickMs must cover roundSeconds");
  }
  if (puzzles.sailing.config.platformSpanMax > puzzles.sailing.config.width) problems.push("puzzles/sailing: platform span exceeds the board width");
  {
    const nav = puzzles.navigation;
    if (nav.colors.length < nav.config.colors) problems.push(`puzzles/navigation: ${nav.config.colors} colors but only ${nav.colors.length} defined`);
    if (nav.shapes.length < nav.config.shapes) problems.push(`puzzles/navigation: ${nav.config.shapes} shapes but only ${nav.shapes.length} defined`);
    if (nav.config.maxTick * nav.config.tickMs < nav.roundSeconds * 1000) problems.push("puzzles/navigation: maxTick * tickMs must cover roundSeconds");
    if (nav.config.fallTicksMin > nav.config.fallTicks) problems.push("puzzles/navigation: fallTicksMin above fallTicks");
    if (nav.config.maxStars > nav.config.rings * nav.config.octants) problems.push("puzzles/navigation: maxStars exceeds the chart's slots");
    const seenColor = new Set<string>();
    const seenMark = new Set<string>();
    for (const c of nav.colors) {
      need(c.nameKey, "navigation color");
      if (seenColor.has(c.color)) problems.push(`puzzles/navigation: color "${c.color}" used twice`);
      if (seenMark.has(c.mark)) problems.push(`puzzles/navigation: mark "${c.mark}" used twice; every color must differ by mark (rule 6)`);
      seenColor.add(c.color);
      seenMark.add(c.mark);
    }
    const seenShape = new Set<string>();
    for (const sh of nav.shapes) {
      need(sh.nameKey, "navigation shape");
      if (seenShape.has(sh.shape)) problems.push(`puzzles/navigation: shape "${sh.shape}" used twice`);
      seenShape.add(sh.shape);
    }
  }
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
