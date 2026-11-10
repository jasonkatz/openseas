import { z } from "zod";
import starSystem from "../data/world/star-system.json" with { type: "json" };
import outposts from "../data/world/outposts.json" with { type: "json" };
import lanes from "../data/world/lanes.json" with { type: "json" };
import raiderTiers from "../data/world/raider-tiers.json" with { type: "json" };
import shipClasses from "../data/world/ship-classes.json" with { type: "json" };
import shipGrants from "../data/world/ship-grants.json" with { type: "json" };
import crews from "../data/world/crews.json" with { type: "json" };
import pirates from "../data/world/pirates.json" with { type: "json" };
import cooling from "../data/puzzles/cooling.json" with { type: "json" };
import engines from "../data/puzzles/engines.json" with { type: "json" };
import plating from "../data/puzzles/plating.json" with { type: "json" };
import gunnery from "../data/puzzles/gunnery.json" with { type: "json" };
import navigation from "../data/puzzles/navigation.json" with { type: "json" };
import battle from "../data/puzzles/battle.json" with { type: "json" };
import swordfight from "../data/puzzles/swordfight.json" with { type: "json" };
import ratingTiers from "../data/rating-tiers.json" with { type: "json" };
import names from "../data/names.json" with { type: "json" };
import en from "../data/messages/en.json" with { type: "json" };
import {
  BattleContentSchema,
  CoolingContentSchema,
  PlatingContentSchema,
  GunneryContentSchema,
  MessagesSchema,
  NamesSchema,
  NavigationContentSchema,
  RatingTierSchema,
  EnginesContentSchema,
  SwordfightContentSchema,
  WorldSchema,
  type BattleContent,
  type CrewFlag,
  type CrewRules,
  type PirateLook,
  type PirateRules,
  type CoolingContent,
  type PlatingContent,
  type GunneryContent,
  type NavigationContent,
  type PieceStyle,
  type RatingTier,
  type EnginesContent,
  type SwordfightContent,
  type World,
} from "./schema.js";

import { PROTOTYPE_CONTENT, PROTOTYPE_PUZZLE_CONTENT_IDS, type PrototypePuzzleContent } from "./prototypes/index.js";

export * from "./schema.js";
export * from "./prototypes/index.js";

/** Content for every duty puzzle, keyed by puzzle id. */
export interface DutyPuzzleContent {
  readonly cooling: CoolingContent;
  readonly engines: EnginesContent;
  readonly plating: PlatingContent;
  readonly gunnery: GunneryContent;
  readonly navigation: NavigationContent;
}
export type DutyPuzzleContentId = keyof DutyPuzzleContent;

/** Every puzzle's content: the duty puzzles, the captain's space battle, the boarding fight, and the prototypes (ADR 0036). */
export interface PuzzleContent extends DutyPuzzleContent, PrototypePuzzleContent {
  readonly battle: BattleContent;
  readonly swordfight: SwordfightContent;
}
export type PuzzleContentId = keyof PuzzleContent;
export const DUTY_PUZZLE_CONTENT_IDS: readonly DutyPuzzleContentId[] = ["cooling", "engines", "plating", "gunnery", "navigation"];

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
    ...starSystem,
    outposts,
    lanes,
    raiderTiers,
    shipClasses,
    shipGrants,
    crews,
    pirates,
  });
  const puzzles: PuzzleContent = {
    cooling: parse("puzzles/cooling", CoolingContentSchema, cooling),
    engines: parse("puzzles/engines", EnginesContentSchema, engines),
    plating: parse("puzzles/plating", PlatingContentSchema, plating),
    gunnery: parse("puzzles/gunnery", GunneryContentSchema, gunnery),
    navigation: parse("puzzles/navigation", NavigationContentSchema, navigation),
    battle: parse("puzzles/battle", BattleContentSchema, battle),
    swordfight: parse("puzzles/swordfight", SwordfightContentSchema, swordfight),
    ...prototypePuzzles(),
  };
  const tiers = parse("rating-tiers", z.array(RatingTierSchema).min(1), ratingTiers);
  const nameLists = parse("names", NamesSchema, names);
  const messages = mergeMessages(parse("messages/en", MessagesSchema, en));

  const content: Content = { world, puzzles, ratingTiers: tiers, names: nameLists, messages };
  const problems = contentProblems(content);
  if (problems.length) throw new ContentError(problems.join("\n"));
  return content;
}

/** Every prototype's content file, parsed against its own schema (ADR 0036). */
function prototypePuzzles(): PrototypePuzzleContent {
  const out: Partial<Record<keyof PrototypePuzzleContent, unknown>> = {};
  for (const id of PROTOTYPE_PUZZLE_CONTENT_IDS) out[id] = parse(`puzzles/${id}`, PROTOTYPE_CONTENT[id].schema as z.ZodType<unknown>, PROTOTYPE_CONTENT[id].data);
  return out as PrototypePuzzleContent;
}

/**
 * The one message table (CLAUDE.md rule 5): `en.json` and each prototype's own file, which holds
 * that puzzle's strings so the prototype is removed or promoted by its own files. A key may live in
 * one file only.
 */
function mergeMessages(base: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  const out: Record<string, string> = { ...base };
  for (const id of PROTOTYPE_PUZZLE_CONTENT_IDS) {
    const file = `messages/prototypes/${id}`;
    const own = parse(file, MessagesSchema, PROTOTYPE_CONTENT[id].messages);
    for (const [key, text] of Object.entries(own)) {
      if (key in out) throw new ContentError(`${file}: "${key}" is already in the message table`);
      out[key] = text;
    }
  }
  return out;
}

function parse<T>(file: string, schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) throw new ContentError(`${file}: ${z.prettifyError(r.error)}`);
  return r.data;
}

/**
 * Everything wrong with content that each file's schema cannot see on its own: ids that refer to
 * nothing, numbers that must agree across files. `loadContent` refuses content with any; the
 * harness's voyage bench holds an edited world to the same list (ADR 0027).
 */
export function contentProblems(content: Content): string[] {
  const { world, puzzles, ratingTiers: tiers, messages } = content;
  const problems: string[] = [];
  const need = (key: string, where: string): void => {
    if (!(key in messages)) problems.push(`${where}: missing message key "${key}"`);
  };
  const outpostIds = new Set(world.outposts.map((i) => i.id));
  const classIds = new Set(world.shipClasses.map((c) => c.id));
  const tierIds = new Set(world.raiderTiers.map((t) => t.id));
  const ratingTierKeys = new Set(tiers.map((t) => t.key));

  for (const i of world.outposts) {
    need(i.nameKey, `outpost ${i.id}`);
    need(i.blurbKey, `outpost ${i.id}`);
  }
  if (!outpostIds.has(world.startOutpostId)) problems.push(`star system: unknown start outpost ${world.startOutpostId}`);
  if (world.ship.maxSpeed < world.ship.idleSpeed) problems.push("star system: ship.maxSpeed below ship.idleSpeed");
  if (world.ship.encounterWindow.to < world.ship.encounterWindow.from) problems.push("star system: ship.encounterWindow ends before it starts");
  for (const r of world.lanes) {
    if (r.durationSeconds % world.ship.turnSeconds !== 0) problems.push(`lane ${r.id}: durationSeconds must be a whole number of turns of ${world.ship.turnSeconds}s`);
  }
  for (const r of world.lanes) {
    if (!outpostIds.has(r.from)) problems.push(`lane ${r.id}: unknown outpost ${r.from}`);
    if (!outpostIds.has(r.to)) problems.push(`lane ${r.id}: unknown outpost ${r.to}`);
    if (r.from === r.to) problems.push(`lane ${r.id}: from and to are the same outpost`);
    for (const b of r.raiders) if (!tierIds.has(b.tierId)) problems.push(`lane ${r.id}: unknown raider tier ${b.tierId}`);
  }
  for (const t of world.raiderTiers) {
    need(t.nameKey, `raider tier ${t.id}`);
    if (!classIds.has(t.shipClassId)) problems.push(`raider tier ${t.id}: unknown ship class ${t.shipClassId}`);
    if (t.swordsmen.blade >= puzzles.swordfight.config.blades.length) problems.push(`raider tier ${t.id}: unknown blade ${t.swordsmen.blade}`);
  }
  for (const c of world.shipClasses) {
    need(c.nameKey, `ship class ${c.id}`);
    if (c.minCrew > c.maxCrew) problems.push(`ship class ${c.id}: minCrew above maxCrew`);
    for (const st of c.botStations) if (!c.stations.includes(st)) problems.push(`ship class ${c.id}: bots would work ${st}, which it does not have`);
    if (new Set(c.botStations).size !== c.botStations.length) problems.push(`ship class ${c.id}: botStations repeats a station`);
  }
  if (world.ship.botOutput.max < world.ship.botOutput.min) problems.push("star system: ship.botOutput ends below where it starts");
  if (Object.values(world.ship.outputCapPercent).some((cap) => world.ship.botOutput.max > cap)) problems.push("star system: ship.botOutput exceeds a station's outputCapPercent");
  for (const g of world.shipGrants) {
    if (!classIds.has(g.shipClassId)) problems.push(`ship grant ${g.id}: unknown ship class ${g.shipClassId}`);
    if (g.requires.minTier !== null && !ratingTierKeys.has(g.requires.minTier)) {
      problems.push(`ship grant ${g.id}: unknown rating tier ${g.requires.minTier}`);
    }
  }
  {
    const c = world.crews;
    if (c.name.max < c.name.min) problems.push("crews: name.max below name.min");
    for (const [kind, parts] of [["color", c.colors], ["pattern", c.patterns], ["emblem", c.emblems]] as const) {
      const ids = new Set<string>();
      for (const p of parts) {
        need(p.nameKey, `crew ${kind} ${p.id}`);
        if (ids.has(p.id)) problems.push(`crews: ${kind} "${p.id}" twice`);
        ids.add(p.id);
      }
    }
    const hexes = new Set(c.colors.map((x) => x.hex));
    if (hexes.size !== c.colors.length) problems.push("crews: two flag colors share a hex");
    const problem = crewFlagProblem(c, c.defaultFlag);
    if (problem) problems.push(`crews: defaultFlag ${problem}`);
  }
  {
    const p = world.pirates;
    for (const [kind, parts] of [["jacket", p.jackets], ["headgear", p.headgear], ["title", p.titles]] as const) {
      const ids = new Set<string>();
      for (const x of parts) {
        need(x.nameKey, `pirate ${kind} ${x.id}`);
        if (ids.has(x.id)) problems.push(`pirates: ${kind} "${x.id}" twice`);
        ids.add(x.id);
      }
    }
    if (new Set(p.jackets.map((x) => x.hex)).size !== p.jackets.length) problems.push("pirates: two jackets share a hex");
    const puzzleIds = new Set<string>(Object.keys(puzzles));
    const seen = new Set<string>();
    for (const t of p.titles) {
      const r = t.requires;
      if (r.kind === "standing") {
        if (!puzzleIds.has(r.puzzle)) problems.push(`pirate title ${t.id}: unknown puzzle ${r.puzzle}`);
        if (!ratingTierKeys.has(r.tier)) problems.push(`pirate title ${t.id}: unknown rating tier ${r.tier}`);
      }
      const key = r.kind === "standing" ? `standing:${r.puzzle}:${r.tier}` : r.kind === "start" ? `start:${t.id}` : `${r.kind}:${r.count}`;
      if (seen.has(key)) problems.push(`pirate title ${t.id}: asks the same as another title`);
      seen.add(key);
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
    if ("pieces" in p) checkPieces(where, p.pieces, "pieceKinds" in p.config ? p.config.pieceKinds : "colors" in p.config ? p.config.colors : p.pieces.length, messages, problems);
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
    if (b.config.startLoaded > b.config.turrets) problems.push("puzzles/battle: startLoaded exceeds turrets");
    for (const t of world.raiderTiers) {
      const cls = world.shipClasses.find((c) => c.id === t.shipClassId);
      if (cls && t.reloadPerTurn > cls.turrets) problems.push(`raider tier ${t.id}: reloads more turrets than its ${cls.id} carries`);
    }
  }
  {
    const sf = puzzles.swordfight;
    const c = sf.config;
    if (c.maxTick * c.tickMs < sf.roundSeconds * 1000) problems.push("puzzles/swordfight: maxTick * tickMs must cover roundSeconds");
    if (!c.player) problems.push("puzzles/swordfight: content plays with the player at board 0");
    if (c.blade >= c.blades.length) problems.push("puzzles/swordfight: the player's blade is not in blades");
    for (const a of [...c.allies, ...c.foes]) if (a.blade >= c.blades.length) problems.push("puzzles/swordfight: an AI's blade is not in blades");
    const seen = new Set<string>();
    for (const b of c.blades) {
      need(`swordfight.blade.${b.id}`, "swordfight blade");
      if (seen.has(b.id)) problems.push(`puzzles/swordfight: blade "${b.id}" twice`);
      seen.add(b.id);
      for (const col of b.columns) if (col >= c.width) problems.push(`puzzles/swordfight: blade "${b.id}" lands past the board`);
    }
    if (c.incomingCapRows > c.height) problems.push("puzzles/swordfight: incomingCapRows exceeds the board");
  }
  for (const s of Object.values(puzzles.cooling.specials)) need(s.nameKey, "cooling special");
  for (const sh of puzzles.plating.shapes) need(sh.nameKey, "plating shape");
  if (puzzles.plating.config.maxBreachPieces < puzzles.plating.config.minBreachPieces) problems.push("puzzles/plating: maxBreachPieces below minBreachPieces");
  if (puzzles.gunnery.config.maxTick * puzzles.gunnery.config.tickMs < puzzles.gunnery.roundSeconds * 1000) {
    problems.push("puzzles/gunnery: maxTick * tickMs must cover roundSeconds");
  }
  if (puzzles.engines.config.injectorSpanMax > puzzles.engines.config.width) problems.push("puzzles/engines: injector span exceeds the board width");
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
  return problems;
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

/**
 * Why a flag is not one the crew rules allow, or null when it is. The server checks every flag a
 * founder sends with this; the field and accent must differ so the emblem always shows.
 */
export function crewFlagProblem(rules: CrewRules, flag: CrewFlag): string | null {
  if (!rules.colors.some((x) => x.id === flag.field)) return `unknown field color "${flag.field}"`;
  if (!rules.colors.some((x) => x.id === flag.accent)) return `unknown accent color "${flag.accent}"`;
  if (flag.field === flag.accent) return "field and accent are the same color";
  if (!rules.patterns.some((x) => x.id === flag.pattern)) return `unknown pattern "${flag.pattern}"`;
  if (!rules.emblems.some((x) => x.id === flag.emblem)) return `unknown emblem "${flag.emblem}"`;
  return null;
}

/** Why a look is not one the pirate rules allow, or null when it is. The server checks every look a pirate picks with this. */
export function pirateLookProblem(rules: PirateRules, look: PirateLook): string | null {
  if (!rules.jackets.some((x) => x.id === look.jacket)) return `unknown jacket "${look.jacket}"`;
  if (!rules.headgear.some((x) => x.id === look.headgear)) return `unknown headgear "${look.headgear}"`;
  return null;
}

/**
 * The look a pirate wears before they pick one: a jacket and a headgear drawn from their id, so a deck of
 * pirates who never opened their sheet is still a mixed crew. Deterministic, so every viewer agrees.
 */
export function defaultLook(rules: PirateRules, pirateId: string): PirateLook {
  // FNV-1a, 32-bit: small, stable and plenty for spreading ids over a handful of choices.
  let h = 0x811c9dc5;
  for (let i = 0; i < pirateId.length; i++) {
    h ^= pirateId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return { jacket: rules.jackets[h % rules.jackets.length]!.id, headgear: rules.headgear[Math.floor(h / rules.jackets.length) % rules.headgear.length]!.id };
}

/** Look up a player-facing string. Unknown keys return the key itself so a miss is visible, never silent. */
export function msg(content: Content, key: string, vars?: Record<string, string | number>): string {
  const template = content.messages[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}
