import { describe, expect, test } from "vitest";
import { checkPuzzle, checkRules, clears, nextStage, replays, resolveSettings, Refused, stageLayers, stageOf, SWAP, SWAP_RULES, unsupported, versionOf, type PuzzleDoc } from "../src/index.js";

const change = (edit: (doc: any) => void): PuzzleDoc => {
  const doc = structuredClone(SWAP) as any;
  edit(doc);
  return doc as PuzzleDoc;
};

describe("a puzzle is ready when", () => {
  test("Swap is ready, its rules know all of it, and the engine runs every part it uses", () => {
    expect(checkPuzzle(SWAP)).toEqual([]);
    expect(checkRules(SWAP, SWAP_RULES)).toEqual([]);
    expect(unsupported(SWAP)).toEqual([]);
  });

  const cases: readonly (readonly [string, (doc: any) => void, RegExp])[] = [
    ["its id is a neutral word", (d) => (d.id = "Cooling!"), /neutral lowercase word/],
    ["its version is major.minor", (d) => (d.version = "1"), /major\.minor/],
    ["its history has a line for its version", (d) => (d.version = "0.2"), /no line for version 0.2/],
    ["its verb is one of its moves", (d) => (d.verb = "slide"), /verb slide/],
    ["the ladder has two to four stages", (d) => (d.ladder = [d.ladder[3]]), /two to four stages/],
    ["the last stage is full", (d) => (d.ladder[3].stage = "all"), /last stage is full/],
    ["each layer is added by exactly one stage", (d) => d.ladder[1].adds.push("runs"), /layer runs is added by 2 stages/],
    ["no layer is left off the ladder", (d) => (d.ladder[3].adds = []), /layer line is added by 0 stages/],
    ["every stage but the last has a threshold", (d) => delete d.ladder[0].advance, /stage runs needs a threshold/],
    ["a clock is sized by a setting of the whole puzzle", (d) => (d.round.ends[0].setting = "ventPoints"), /must belong to the whole puzzle/],
    ["a setting's default is within its bounds", (d) => (d.settings[3].default = 9), /default of kinds/],
    ["a list says how many entries it holds", (d) => delete d.settings[4].entries, /does not say how many entries/],
    ["a relation names settings", (d) => d.relations.push({ is: "below", a: "kinds", b: "nope" }), /not a setting/],
    ["a draw reads settings", (d) => d.deal.draws[0].reads.push("nope"), /draw kind reads nope/],
    ["every check has a fallback", (d) => (d.deal.checks[0].fallback = ""), /needs a fallback/],
    ["every secret is revealed by an event", (d) => d.deal.secrets.push({ id: "hidden", line: "x", hides: "kind", revealedBy: [] }), /never revealed/],
    ["a layer brings only what the puzzle declares", (d) => d.layers[0].brings.events.push("boom"), /brings boom/],
    ["nothing is brought by two layers", (d) => d.layers[1].brings.events.push("run"), /brought by runs and by chains/],
    ["tier starts rise", (d) => (d.evaluation.tierStarts.sharp = 100), /tier starts/],
    ["the moment names an event", (d) => (d.moment.event = "boom"), /moment names boom/],
    ["the moment is sized by a number field of its event", (d) => (d.moment.size = "places"), /not a number field of lift/],
    ["the moment's condition reads a number field", (d) => (d.moment.when = "often"), /moment's condition/],
    ["a payout pays on an event that carries points", (d) => (d.payouts[0].on = ["trade"]), /no points field/],
    ["a payout counts a field its event carries", (d) => (d.payouts[0].counts = "length"), /counts length/],
    ["a stepped payout reads a list", (d) => (d.payouts[0].reads = ["liftPoints"]), /a stepped payout reads a list/],
    ["a flat payout counts nothing", (d) => (d.payouts[4].growth = "flat"), /is flat, so it counts nothing/],
    ["a multiplier scales payouts", (d) => d.multipliers[0].scales.push("nope"), /scales nope/],
    ["a streak raises a multiplier and keeps best_streak", (d) => (d.stats = d.stats.slice(1)), /best_streak/],
    ["an event carries only board changes", (d) => d.events[0].changes.push("teleport"), /not a board change/],
    ["a move names a gesture", (d) => (d.moves[0].gesture = "shake"), /no gesture/],
    ["every text key its parts need is declared", (d) => (d.texts = d.texts.filter((t: any) => t.key !== "stage.full_intro")), /text key stage.full_intro/],
    ["a family has a text for every kind its setting allows", (d) => (d.texts = d.texts.filter((t: any) => t.key !== "piece.kind_8")), /text key piece.kind_8/],
    ["a callout keeps places only for its event's fields", (d) => d.texts.push({ key: "event.run", placeholders: ["colour"] }), /keeps a place for colour/],
    ["no id is declared twice", (d) => d.events.push(d.events[0]), /events declares trade twice/],
    ["no id carries anything but a neutral word", (d) => (d.gauges[0].id = "Heat-Line"), /not a neutral word/],
  ];
  test.each(cases)("%s", (_name, edit, problem) => {
    expect(checkPuzzle(change(edit)).join("\n")).toMatch(problem);
  });

  test("a document that is not shaped like one says so instead of throwing", () => {
    expect(checkPuzzle({ id: "x" } as unknown as PuzzleDoc)[0]).toMatch(/malformed/);
  });

  test("the engine names what it does not run yet", () => {
    expect(unsupported(change((d) => (d.round.tempo = { kind: "turns", turnSeconds: 30 })))).toEqual(["turns are not run yet"]);
    expect(unsupported(change((d) => (d.board.shape = "rings")))).toEqual(["only a grid is run yet"]);
    expect(unsupported(change((d) => d.terrain.push({ id: "wall" })))).toEqual(["terrain is not run yet"]);
  });
});

describe("settings", () => {
  test("the whole puzzle has every setting at its default, and the default is the only place a number lives", () => {
    const s = resolveSettings(SWAP);
    expect(s.stage).toBe("full");
    expect(s.layers).toEqual(["runs", "chains", "streak", "specials", "line"]);
    for (const decl of SWAP.settings) expect(s.values[decl.id]).toEqual(decl.default);
  });

  test("a stage only switches layers: a setting a layer brings exists only while it is on", () => {
    const runs = resolveSettings(SWAP, { stage: "runs" });
    expect(runs.layers).toEqual(["runs"]);
    expect(Object.keys(runs.values).sort()).toEqual(["height", "kinds", "roundSeconds", "runPoints", "width"]);
    // The round's length and the board are the whole puzzle's at every stage.
    expect(runs.values["roundSeconds"]).toBe(resolveSettings(SWAP).values["roundSeconds"]);
    // A value for a setting that does not exist at the stage is dropped, not refused: the setting is not there.
    expect("liftPoints" in resolveSettings(SWAP, { stage: "runs", values: { liftPoints: 30 } }).values).toBe(false);
    expect(stageLayers(SWAP, "chains")).toEqual(["runs", "chains", "streak"]);
    expect(stageOf(SWAP, ["streak", "runs", "chains"])).toBe("chains");
  });

  test("a round's layers are always those of one stage", () => {
    expect(() => resolveSettings(SWAP, { layers: ["runs", "line"] })).toThrow(Refused);
    expect(() => resolveSettings(SWAP, { stage: "hard" })).toThrow(Refused);
    expect(resolveSettings(SWAP, { layers: ["runs", "chains", "streak", "specials"] }).stage).toBe("specials");
  });

  const refused: readonly (readonly [string, Record<string, unknown>, RegExp])[] = [
    ["a value under its least", { kinds: 2 }, /kinds must be from 3 to 8/],
    ["a value over its most", { width: 13 }, /width must be from 3 to 12/],
    ["a number that is not whole", { kinds: 4.5 }, /whole number/],
    ["a list with an entry out of bounds", { cascadePercent: [100, 50] }, /every entry of cascadePercent/],
    ["a list too short", { runPoints: [1, 2] }, /from 3 to 24 entries/],
    ["a list that falls, where it must be ascending", { runPoints: [0, 0, 8, 3] }, /runPoints must never fall/],
    ["one setting above another it is at most", { minRows: 5 }, /minRows must be at most startRows/],
    ["a setting past the board", { startRows: 14, height: 12 }, /startRows must be at most height/],
    ["a setting the puzzle does not have", { speed: 3 }, /no setting speed/],
  ];
  test.each(refused)("refuses %s", (_name, values, reason) => {
    expect(() => resolveSettings(SWAP, { values: values as never })).toThrow(reason);
  });

  test("a relation with a setting that a layer brings holds only while that layer is on", () => {
    // Twelve rows under the line on a board of four is refused with the line, and nothing without it.
    expect(() => resolveSettings(SWAP, { values: { height: 4 } })).toThrow(/dangerRows must be at most height/);
    expect(resolveSettings(SWAP, { stage: "specials", values: { height: 4 } }).values["height"]).toBe(4);
  });
});

describe("versions and the ladder", () => {
  test("a version is major.minor", () => {
    expect(versionOf("0.1")).toEqual({ major: 0, minor: 1 });
    expect(versionOf("12.30")).toEqual({ major: 12, minor: 30 });
    for (const bad of ["1", "1.2.3", "v1.0", "01.2", "1.-2", ""]) expect(versionOf(bad)).toBeNull();
  });

  test("a stored round replays on its own major, whatever its minor", () => {
    expect(replays(SWAP, { puzzle: "swap", version: "0.1" })).toBe(true);
    expect(replays(SWAP, { puzzle: "swap", version: "0.9" })).toBe(true);
    expect(replays(SWAP, { puzzle: "swap", version: "1.0" })).toBe(false);
    expect(replays(SWAP, { puzzle: "paths", version: "0.1" })).toBe(false);
  });

  test("a player clears a stage by its threshold and only moves forward", () => {
    expect(clears(SWAP, "runs", [{ score: 80 }, { score: 119 }])).toBe(false);
    expect(clears(SWAP, "runs", [{ score: 80 }, { score: 120 }])).toBe(true);
    expect(clears(SWAP, "full", [{ score: 99999 }])).toBe(false);
    expect(nextStage(SWAP, "runs")).toBe("chains");
    expect(nextStage(SWAP, "full")).toBeNull();
  });
});

describe("the guide's own example (docs/puzzles/examples)", () => {
  test("is a ready puzzle document by these checks, so the checks read the guide as it reads itself", async () => {
    const { readFileSync } = await import("node:fs");
    const paths = JSON.parse(readFileSync(new URL("../../../docs/puzzles/examples/paths.puzzle.json", import.meta.url), "utf8")) as PuzzleDoc;
    expect(checkPuzzle(paths)).toEqual([]);
    // Paths has tasks, which this engine does not run yet: it says so and deals nothing.
    expect(unsupported(paths)).toEqual(["tasks are not run yet"]);
  });
});
