// The three commands that take a puzzle from valid to promoted (ADR 0096). Run through tsx, so a puzzle's
// TypeScript loads as it is written. Everything that decides anything is in src/ready.ts: this file only
// reads and writes.
//
//   pnpm --filter @openseas/puzzle ready   <file>             what the puzzle still lacks
//   pnpm --filter @openseas/puzzle witness <file>             record a witness round at each stage
//   pnpm --filter @openseas/puzzle promote <file> [--out dir] write its document out whole, once
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promote, ready, witnessPlayed } from "../src/index.ts";

/** Witness rounds as they are kept: a round a line, so a change to one reads as one line changed. */
const written = (rounds) => `[\n${rounds.map((w) => JSON.stringify(w)).join(",\n")}\n]\n`;

const [command, given, ...rest] = process.argv.slice(2);
const stop = (text) => {
  console.error(text);
  process.exit(1);
};
if (!["ready", "witness", "promote"].includes(command) || !given) stop("usage: ready | witness | promote <a puzzle's file> [--out <dir>]");

// pnpm runs a script from its package, so a path is taken from where the command was typed.
const file = resolve(process.env.INIT_CWD ?? process.cwd(), given);
if (!existsSync(file)) stop(`no file at ${file}`);
const puzzle = (await import(pathToFileURL(file).href)).default;
if (!puzzle?.document || !puzzle.rules || !puzzle.parts) stop(`${given} does not export a puzzle as its default`);
const id = puzzle.document.id;
const kept = join(dirname(file), `${id}.witness.json`);
const witnesses = existsSync(kept) ? JSON.parse(readFileSync(kept, "utf8")) : [];
const said = (lacks) => `${id} is not ready:\n${lacks.map((line) => `  - ${line}`).join("\n")}`;

if (command === "witness") {
  const rounds = puzzle.document.ladder.map((s) => witnessPlayed(puzzle, `witness-${s.stage}`, s.stage));
  writeFileSync(kept, written(rounds));
  console.log(`${id}: recorded ${rounds.length} witness ${rounds.length === 1 ? "round" : "rounds"} in ${kept}`);
  for (const w of rounds) console.log(`  ${w.stage}: ${w.log.length} moves, score ${w.read.score}${w.read.tier ? `, ${w.read.tier}` : ""}`);
} else if (command === "ready") {
  const lacks = ready(puzzle, witnesses);
  if (lacks.length > 0) stop(said(lacks));
  console.log(`${id} is ready. Its skin and its words are the host's to check.`);
} else {
  const out = rest[0] === "--out" && rest[1] ? resolve(process.env.INIT_CWD ?? process.cwd(), rest[1]) : dirname(file);
  const document = join(out, `${id}.puzzle.json`);
  if (existsSync(document)) stop(`${id} is already promoted: ${document} is its source now, and is changed by hand or by a tuning panel`);
  const promotion = promote(puzzle, witnesses);
  if (promotion.lacks) stop(said(promotion.lacks));
  mkdirSync(out, { recursive: true });
  writeFileSync(document, promotion.document);
  writeFileSync(join(out, `${id}.witness.json`), written(witnesses));
  console.log(`${id} is promoted. Its document is ${document}.`);
  console.log(`Its own file now holds its parts and no number. Where it called puzzle(), it ends:\n\n${promotion.file}`);
}
