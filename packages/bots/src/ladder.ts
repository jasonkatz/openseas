/**
 * The ladder table (ADR 0066, ADR 0067): every bot on every stage of a puzzle, each over the same
 * seeds, its mean score read as a tier against that stage's thresholds. And the checks the bar asks
 * of the numbers: careless play lands a tier below plain thinking play (rule 17), and each bait
 * loses to the bot it is set against (rule 26).
 */
import { FULL_STAGE, stageNumbers, type Stage } from "@openseas/content";
import { performanceRating, tierFor, type RatingTier } from "@openseas/engine";
import { botsFor, playRound, type AnyBotGame, type Bot } from "./core.js";

/** What the table needs of a puzzle's content file. */
export interface LadderFile {
  readonly config: object;
  readonly roundSeconds: number;
  readonly thresholds: readonly { score: number; rating: number }[];
  readonly stages?: readonly Stage[];
}

export interface LadderOptions {
  readonly seeds: number;
  /** Stage ids to run, `full` for the whole puzzle. All of them when absent. */
  readonly stages?: readonly string[];
  /** Bot names to run. All of them when absent. */
  readonly bots?: readonly string[];
  /** Config keys laid over every stage's, for trying a number without editing content. */
  readonly set?: Readonly<Record<string, unknown>>;
  /** Called after each cell, for progress. */
  readonly onCell?: (stage: string, bot: string, mean: number, ms: number) => void;
}

export interface LadderCell {
  readonly mean: number;
  readonly scores: readonly number[];
  readonly tier: string;
}

export interface LadderStage {
  readonly id: string;
  readonly roundSeconds: number;
  readonly thresholds: readonly { score: number; rating: number }[];
  /** The score each tier above the first starts at, read back from the thresholds. */
  readonly tierScores: ReadonlyArray<{ readonly tier: string; readonly score: number }>;
  readonly cells: Readonly<Record<string, LadderCell>>;
}

export interface LadderCheck {
  readonly ok: boolean;
  readonly text: string;
}

export interface Ladder {
  readonly id: string;
  readonly seeds: number;
  readonly pace: string;
  readonly bots: ReadonlyArray<{ readonly name: string; readonly about: string }>;
  readonly stages: readonly LadderStage[];
  readonly checks: readonly LadderCheck[];
}

/** The lowest score that reads as `min` or better against `thresholds`. */
export function scoreForRating(min: number, thresholds: readonly { score: number; rating: number }[]): number {
  let lo = 0;
  let hi = 1;
  while (performanceRating(hi, thresholds) < min) {
    hi *= 2;
    if (hi > 1e12) return Infinity;
  }
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (performanceRating(mid, thresholds) >= min) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

export function stageIds(file: LadderFile): string[] {
  return [...(file.stages ?? []).map((s) => s.id), FULL_STAGE];
}

export function runLadder<S, M>(game: AnyBotGame<S, M>, file: LadderFile, tiers: readonly RatingTier[], options: LadderOptions): Ladder {
  const all = botsFor(game);
  const bots: Bot<S, M>[] = options.bots ? options.bots.map((name) => {
    const bot = all.find((b) => b.name === name);
    if (!bot) throw new Error(`${game.id} has no bot "${name}"; it has ${all.map((b) => `"${b.name}"`).join(", ")}`);
    return bot;
  }) : all;
  const ids = options.stages ?? stageIds(file);
  const stages: LadderStage[] = [];
  for (const id of ids) {
    if (!stageIds(file).includes(id)) throw new Error(`${game.id} has no stage "${id}"; it has ${stageIds(file).join(", ")}`);
    const numbers = stageNumbers(file, id === FULL_STAGE ? null : id);
    const config = { ...numbers.config, ...(options.set ?? {}) };
    game.def.validateConfig(config);
    const cells: Record<string, LadderCell> = {};
    for (const bot of bots) {
      const started = performance.now();
      const scores: number[] = [];
      for (let i = 0; i < options.seeds; i++) scores.push(playRound(game, bot, `ladder-${i}`, config, numbers.roundSeconds).score);
      const mean = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
      cells[bot.name] = { mean, scores, tier: tierFor(performanceRating(mean, numbers.thresholds), tiers).key };
      options.onCell?.(id, bot.name, mean, performance.now() - started);
    }
    const tierScores = tiers.slice(1).map((t) => ({ tier: t.key, score: scoreForRating(t.min, numbers.thresholds) }));
    stages.push({ id, roundSeconds: numbers.roundSeconds, thresholds: numbers.thresholds, tierScores, cells });
  }
  return { id: game.id, seeds: options.seeds, pace: game.pace, bots: bots.map((b) => ({ name: b.name, about: b.about })), stages, checks: checks(game, stages, tiers) };
}

function checks<S, M>(game: AnyBotGame<S, M>, stages: readonly LadderStage[], tiers: readonly RatingTier[]): LadderCheck[] {
  const out: LadderCheck[] = [];
  const rank = (key: string): number => tiers.findIndex((t) => t.key === key);
  const plain = game.open ? "one move" : (game.bots?.[0]?.name ?? null);
  for (const stage of stages) {
    const careless = stage.cells["careless"];
    const thinking = plain ? stage.cells[plain] : undefined;
    if (!careless || !thinking) continue;
    const ok = rank(careless.tier) < rank(thinking.tier);
    out.push({ ok, text: `${stage.id}: careless (${careless.tier}, ${careless.mean}) lands a tier below ${plain} (${thinking.tier}, ${thinking.mean})` });
  }
  const full = stages.find((s) => s.id === FULL_STAGE);
  for (const { bait, beats } of game.baits ?? []) {
    const b = full?.cells[bait];
    const a = full?.cells[beats];
    if (!a || !b) continue;
    const gap = a.mean === 0 ? 0 : Math.round((1000 * (a.mean - b.mean)) / a.mean) / 10;
    out.push({ ok: b.mean < a.mean, text: `full: the bait "${bait}" (${b.mean}) loses to "${beats}" (${a.mean}), ${gap} percent under` });
  }
  return out;
}

const title = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The table as Markdown, ready for a design file's tuning notes. */
export function formatLadder(ladder: Ladder): string {
  const lines: string[] = [];
  lines.push(`## ${title(ladder.id)}`, "");
  lines.push(`${ladder.seeds} seeds a cell; a person's pace modelled as ${ladder.pace}. Each cell is the mean score and the tier it reads as on that stage.`, "");
  lines.push(`| Bot | ${ladder.stages.map((s) => `${title(s.id)} (${s.roundSeconds} s)`).join(" | ")} |`);
  lines.push(`|---|${ladder.stages.map(() => "---").join("|")}|`);
  for (const bot of ladder.bots) {
    lines.push(`| ${bot.name} | ${ladder.stages.map((s) => {
      const c = s.cells[bot.name];
      return c ? `${c.mean.toLocaleString("en-US")} ${title(c.tier)}` : "";
    }).join(" | ")} |`);
  }
  const tierNames = ladder.stages[0]?.tierScores.map((t) => t.tier) ?? [];
  for (const tier of tierNames) {
    lines.push(`| *${title(tier)} from* | ${ladder.stages.map((s) => {
      const t = s.tierScores.find((x) => x.tier === tier);
      return t ? `*${t.score.toLocaleString("en-US")}*` : "";
    }).join(" | ")} |`);
  }
  lines.push("");
  for (const bot of ladder.bots) lines.push(`- **${bot.name}**: ${bot.about}`);
  if (ladder.checks.length) {
    lines.push("", "Checks:", "");
    for (const c of ladder.checks) lines.push(`- ${c.ok ? "met" : "**broken**"}: ${c.text}`);
  }
  return lines.join("\n");
}
