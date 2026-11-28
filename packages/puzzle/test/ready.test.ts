// Valid, ready and promoted (ADR 0096): what a puzzle still lacks, the witness rounds it keeps, and a promoted
// puzzle built from its document alone.
import { describe, expect, it } from "vitest";
import cooling from "../examples/cooling.puzzle.js";
import gunnery from "../examples/gunnery.puzzle.js";
import paths from "../examples/paths.puzzle.js";
import kept from "../examples/paths.witness.json" with { type: "json" };
import swap from "../examples/swap.puzzle.js";
import { advance, expand, hint, lines, play, promote, read, ready, refill, rules, start, swap as swapPart, witnessOf, witnessPlayed, witnessProblem, type AnyMove, type Composed, type Document, type Event, type Round, type Witness } from "../src/index.js";

const WITNESSES = kept as unknown as Witness[];
const documentOf = (p: Composed): Document => JSON.parse(expand(p)) as Document;
/** Every event of a round played out by the puzzle's own hint. */
function eventsOf(p: Composed, seed: string, moves: number): Event[] {
  let round = start(p, { seed }) as Round<AnyMove>;
  const events = [...round.last.events];
  for (let n = 1; n <= moves; n++) {
    const move = hint(round);
    round = move ? play(round, move, { at: n * 1000 }) : advance(round, { at: n * 1000 });
    events.push(...round.last.events);
  }
  return events;
}

describe("a valid puzzle says what it still lacks", () => {
  it("names everything the seven lines of Swap leave for later", () => {
    expect(ready(swap)).toEqual([
      "its ladder has one stage: a player meets a puzzle over two to four",
      "it does not say where its tiers start, so its rounds cannot be judged",
      "it names no moment, so no skin can play its beat",
      "its payout clear is sized by no setting, so nobody can tune it",
      "it keeps no witness rounds",
    ]);
    expect(promote(swap, []).lacks).toHaveLength(5);
  });

  it("plays all the same: its rounds are scored and never judged", () => {
    expect(read(start(swap, { seed: "1" })).tier).toBeNull();
  });

  it("refuses a moment or tier starts that cannot be meant", () => {
    const again = (change: Partial<Document>): (() => unknown) => () => rules({ ...documentOf(paths), ...change }, paths.parts);
    expect(again({ moment: { event: "sweep", size: "prizes", most: 3 } })).toThrow("the moment names the event sweep, which the puzzle does not have");
    expect(again({ moment: { event: "loop", size: "points", most: 3 } })).toThrow("the moment's size is points, which is no number or places of the event loop");
    expect(again({ moment: { event: "loop", size: "prizes", most: "kindsOfPrize" } })).toThrow("the moment's most is kindsOfPrize");
    expect(again({ evaluation: { tierStarts: { steady: 900, sharp: 800, masterful: 4800, legendary: 8400 }, paceWindowSeconds: 10 } })).toThrow("the tier starts are whole numbers that rise");
  });
});

describe("a ready puzzle", () => {
  it("is Paths, with the witness rounds it keeps", () => {
    expect(WITNESSES.map((w) => w.stage)).toEqual(["paths", "streak", "loops", "full"]);
    expect(ready(paths, WITNESSES)).toEqual([]);
  });

  it("is judged: a round's score stands in a tier", () => {
    const full = WITNESSES.at(-1)!;
    expect(full.read.score).toBeGreaterThanOrEqual(850);
    expect(full.read.tier).toBe("steady");
    expect(read(start(paths, { seed: "1" })).tier).toBe("green");
  });

  it("records the same witness round every time", () => {
    expect(JSON.stringify(witnessPlayed(paths, "witness-loops", "loops"))).toBe(JSON.stringify(WITNESSES[2]));
  });

  it("is not ready without a witness of the whole puzzle", () => {
    expect(ready(paths, WITNESSES.slice(0, 3))).toEqual(["none of its witness rounds is played on the whole puzzle"]);
  });

  it("names the witness round a change has moved, and what moved", () => {
    const document = documentOf(paths);
    document.payouts.find((p) => p.id === "path")!.growth = "linear";
    const lacks = ready(rules(document, paths.parts), WITNESSES);
    expect(lacks).toHaveLength(4);
    expect(lacks[0]).toBe("the witness round on seed witness-paths at stage paths no longer gives the read recorded for it: score changed (the score was 711 and is 237)");
  });

  it("holds a witness to the settings it was played with, so a number tuned later moves none", () => {
    const document = documentOf(paths);
    document.settings.find((s) => s.id === "pathPoints")!.default = 2;
    expect(ready(rules(document, paths.parts), WITNESSES)).toEqual([]);
  });

  it("names a witness round that no longer plays at all", () => {
    const first = WITNESSES[0]!;
    const broken: Witness = { ...first, log: [{ at: 1500, move: { move: "trace", path: [{ x: 0, y: 0 }], closed: false } }, ...first.log.slice(1)] };
    expect(witnessProblem(paths, broken)).toBe("the witness round on seed witness-paths at stage paths no longer plays: a move of its log is refused");
  });

  it("runs a ticking puzzle's witness on to the end of its clock", () => {
    const w = witnessPlayed(gunnery, "w", "full");
    expect(w.until).toBe(152_000);
    expect(w.read.tick).toBe(760);
    expect(w.read.ended).toBe("clock");
    expect(witnessProblem(gunnery, w)).toBeNull();
    expect(witnessOf(advance(start(gunnery, { seed: "w" }), { at: 152_000 }), 152_000)).toEqual(w);
  });
});

describe("a promoted puzzle is built from its document", () => {
  it("promotes Paths: the document whole, and the few lines its file shrinks to", () => {
    const promotion = promote(paths, WITNESSES);
    expect(promotion.lacks).toBeNull();
    if (promotion.lacks !== null) return;
    expect(promotion.document).toBe(expand(paths));
    expect(promotion.file).toContain(`import document from "./paths.puzzle.json" with { type: "json" };`);
    expect(promotion.file).toContain("export default rules(document, [timers, bounty, paths, streak, prizes, loops]);");
  });

  it("plays the same rounds from the document and the parts as from the code", () => {
    const promoted = rules(documentOf(paths), paths.parts);
    expect(ready(promoted, WITNESSES)).toEqual([]);
    expect(expand(promoted)).toBe(expand(paths));
    for (const [p, parts] of [[swap, [swapPart(), lines(), refill()]], [gunnery, gunnery.parts]] as const) {
      const again = rules(documentOf(p), parts);
      expect(eventsOf(again, "5", 30)).toEqual(eventsOf(p, "5", 30));
    }
  });

  it("takes its numbers from the document, whatever a part would have said", () => {
    const document = documentOf(swap);
    document.settings.find((s) => s.id === "lineMin")!.default = 4;
    const promoted = rules(document, [swapPart(), lines(), refill()]);
    const clears = eventsOf(promoted, "9", 20).filter((e) => e.event === "clear");
    expect(clears.length).toBeGreaterThan(0);
    for (const e of clears) expect((e.fields.pieces as unknown[]).length).toBeGreaterThanOrEqual(4);
  });

  it("refuses a number written in the code", () => {
    expect(() => rules(documentOf(swap), [swapPart(), lines(3), refill()])).toThrow("swap: the part lines is given the number 3. A promoted puzzle's numbers are in its document, and nowhere else");
    expect(() => rules(documentOf(cooling), cooling.parts)).toThrow("is given the number");
  });

  it("refuses a part that works something the document does not have, and a layer with no part", () => {
    const document = documentOf(paths);
    expect(() => rules({ ...document, events: document.events.filter((e) => e.id !== "blowup") }, paths.parts)).toThrow("the event blowup");
    expect(() => rules(document, paths.parts.filter((p) => p.name !== "timers"))).toThrow("paths: the document has the layer timers, and no part of that name is listed");
    expect(() => rules({ id: "x" }, [])).toThrow("this is no puzzle document");
  });
});
