/**
 * pnpm --filter @openseas/bots ladder <puzzle|all> [--seeds 32] [--stage full,nets] [--bot "one move,rollout"]
 *   [--set key=value ...] [--json]
 *
 * Plays every bot on every stage of a prototype from its content file and prints the ladder table
 * as Markdown (or JSON). `--set` lays a config number over every stage, to try it before it is
 * written into content. Progress goes to stderr.
 */
import { loadContent } from "@openseas/content";
import { BOT_GAMES } from "./games/index.js";
import { formatLadder, runLadder } from "./ladder.js";

function parseArgs(argv: readonly string[]): { puzzles: string[]; seeds: number; stages?: string[]; bots?: string[]; set: Record<string, unknown>; json: boolean } {
  const rest = [...argv];
  const puzzle = rest.shift();
  if (!puzzle || puzzle.startsWith("--")) throw new Error(`name a puzzle: ${Object.keys(BOT_GAMES).join(", ")} or all`);
  let seeds = 32;
  let stages: string[] | undefined;
  let bots: string[] | undefined;
  const set: Record<string, unknown> = {};
  let json = false;
  while (rest.length) {
    const flag = rest.shift()!;
    const value = (): string => {
      const v = rest.shift();
      if (v === undefined) throw new Error(`${flag} wants a value`);
      return v;
    };
    if (flag === "--seeds") seeds = Number(value());
    else if (flag === "--stage") stages = value().split(",");
    else if (flag === "--bot") bots = value().split(",");
    else if (flag === "--set") {
      const [key, raw] = value().split("=", 2);
      if (!key || raw === undefined) throw new Error("--set wants key=value");
      set[key] = JSON.parse(raw);
    } else if (flag === "--json") json = true;
    else throw new Error(`unknown flag ${flag}`);
  }
  if (!Number.isInteger(seeds) || seeds < 1) throw new Error("--seeds wants a whole number");
  const puzzles = puzzle === "all" ? Object.keys(BOT_GAMES) : [puzzle];
  for (const p of puzzles) if (!BOT_GAMES[p]) throw new Error(`no bots for "${p}"; there are ${Object.keys(BOT_GAMES).join(", ")}`);
  return { puzzles, seeds, ...(stages ? { stages } : {}), ...(bots ? { bots } : {}), set, json };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const content = loadContent();
  const out: unknown[] = [];
  for (const id of args.puzzles) {
    const game = BOT_GAMES[id]!;
    const file = content.puzzles[id as keyof typeof content.puzzles] as unknown as Parameters<typeof runLadder>[1];
    const ladder = runLadder(game, file, content.ratingTiers, {
      seeds: args.seeds,
      ...(args.stages ? { stages: args.stages } : {}),
      ...(args.bots ? { bots: args.bots } : {}),
      set: args.set,
      onCell: (stage, bot, mean, ms) => process.stderr.write(`${id} ${stage} ${bot}: ${mean} (${(ms / 1000).toFixed(1)} s)\n`),
    });
    if (args.json) out.push(ladder);
    else process.stdout.write(`${formatLadder(ladder)}\n\n`);
  }
  if (args.json) process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}

try {
  main();
} catch (e) {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
}
