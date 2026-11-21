/**
 * Every puzzle the bots play: each bot's move log is one the server would accept and replay to the
 * same state (the server is the authority, so a bot that leaned on anything else would be lying),
 * and the runner is deterministic, so a table printed twice is the same table.
 */
import { describe, expect, it } from "vitest";
import { loadContent, stageNumbers } from "@openseas/content";
import { PROTOTYPE_PUZZLE_IDS } from "@openseas/engine";
import { BOT_GAMES, botsFor, plainBotName, playRound, rolloutBot, runLadder, scoreForRating, stageIds, type AnyBotGame, type LadderFile } from "../src/index.js";

const content = loadContent();
const fileOf = (id: string): LadderFile => content.puzzles[id as keyof typeof content.puzzles] as unknown as LadderFile;

describe("the bots", () => {
  it("play every prototype", () => {
    expect(Object.keys(BOT_GAMES).sort()).toEqual([...PROTOTYPE_PUZZLE_IDS].sort());
  });

  for (const [id, game] of Object.entries(BOT_GAMES) as Array<[string, AnyBotGame]>) {
    describe(id, () => {
      const file = fileOf(id);
      it("has a careless bot, and the one-move and rollout bots where the board is open", () => {
        const names = botsFor(game).map((b) => b.name);
        expect(names[0]).toBe("careless");
        if (game.open) expect(names).toEqual(expect.arrayContaining(["one move", "rollout"]));
        expect(new Set(names).size).toBe(names.length);
        for (const { bait, beats } of game.baits ?? []) expect(names).toEqual(expect.arrayContaining([bait, beats]));
      });

      for (const stage of stageIds(file)) {
        it(`plays a round of ${stage} the server replays to the same state, by every quick bot`, () => {
          const numbers = stageNumbers(file, stage === "full" ? null : stage);
          // Rollout bots take seconds a round; the quick ones show the log is sound.
          const bots = botsFor(game).filter((b) => b.name !== "rollout" && !(game.slow ?? []).includes(b.name));
          for (const bot of bots) {
            const round = playRound(game, bot, `test-${stage}`, numbers.config, numbers.roundSeconds);
            expect(round.log.length).toBeLessThanOrEqual(game.def.maxMoves(numbers.config));
            let replay = game.def.create(`test-${stage}`, numbers.config);
            for (const m of round.log) replay = game.def.reduce(replay, m);
            expect(game.def.isFinished(replay)).toBe(true);
            expect(game.def.hash(replay)).toBe(game.def.hash(round.state));
            expect(game.def.summarize(replay).score).toBe(round.score);
            expect(round.score).toBeGreaterThanOrEqual(0);
          }
        });
      }

      if (game.open) {
        it("plays a rollout round the server replays, the same twice", () => {
          const numbers = stageNumbers(file, null);
          const bot = rolloutBot({ width: 3, tries: 1, depth: 2 });
          const a = playRound(game, bot, "test-rollout", numbers.config, numbers.roundSeconds);
          const b = playRound(game, bot, "test-rollout", numbers.config, numbers.roundSeconds);
          expect(b.log).toEqual(a.log);
          let replay = game.def.create("test-rollout", numbers.config);
          for (const m of a.log) replay = game.def.reduce(replay, m);
          expect(game.def.hash(replay)).toBe(game.def.hash(a.state));
        });
      }
    });
  }
});

describe("the ladder", () => {
  it("is the same table twice", () => {
    const game = BOT_GAMES["salvage"]!;
    const options = { seeds: 2, stages: ["lines", "full"], bots: ["careless", "one move"] };
    const a = runLadder(game, fileOf("salvage"), content.ratingTiers, options);
    const b = runLadder(game, fileOf("salvage"), content.ratingTiers, options);
    expect(b).toEqual(a);
    expect(a.stages.map((s) => s.id)).toEqual(["lines", "full"]);
    expect(a.checks.length).toBeGreaterThan(0);
  });

  it("compares careless against the plain bot a game names, and by default against one move, or a closed game's first bot", () => {
    for (const game of Object.values(BOT_GAMES) as AnyBotGame[]) {
      const plain = plainBotName(game);
      expect(plain).not.toBeNull();
      expect(botsFor(game).map((b) => b.name)).toContain(plain);
    }
    expect(plainBotName(BOT_GAMES["salvage"]!)).toBe("one move");
    expect(plainBotName(BOT_GAMES["scanner"]!)).toBe(BOT_GAMES["scanner"]!.bots![0]!.name);
    // Tug names its own: no single flick pays, so one move is not plain play.
    expect(BOT_GAMES["tug"]!.plain).toBe("two flicks");
    const options = { seeds: 1, stages: ["glide"], bots: ["careless", "one move", "two flicks"] };
    const tug = runLadder(BOT_GAMES["tug"]!, fileOf("tug"), content.ratingTiers, options);
    expect(tug.checks[0]!.text).toMatch(/^glide: careless \(.*\) lands a tier below two flicks \(/);
    // The same game with no plain bot named falls back on one move.
    const copy: Record<string, unknown> = { ...BOT_GAMES["tug"]! };
    delete copy["plain"];
    const plainless = copy as unknown as AnyBotGame;
    const fallback = runLadder(plainless, fileOf("tug"), content.ratingTiers, options);
    expect(fallback.checks[0]!.text).toMatch(/lands a tier below one move \(/);
  });

  it("reads a tier's first score back from the thresholds", () => {
    const thresholds = fileOf("salvage").thresholds;
    const steady = content.ratingTiers.find((t) => t.key === "steady")!;
    const at = scoreForRating(steady.min, thresholds);
    const exact = thresholds.find((t) => t.rating === steady.min)!.score;
    // The rating is rounded to a whole number, so the first score that reads as the tier may sit one under.
    expect(Math.abs(at - exact)).toBeLessThanOrEqual(1);
    expect(at).toBeLessThanOrEqual(exact);
  });
});
