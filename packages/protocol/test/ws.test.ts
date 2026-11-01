import { describe, expect, it } from "vitest";
import { parseClientMessage, parseMoveFor, parseServerMessage } from "../src/index.js";

describe("protocol", () => {
  it("accepts a well-formed move and rejects junk", () => {
    expect(
      parseClientMessage({
        type: "puzzle.move",
        sessionId: "abcdefgh12345678",
        seq: 0,
        move: { type: "swap", col: 1, row: 2 },
        hash: "deadbeef",
      }),
    ).not.toBeNull();
    expect(parseClientMessage({ type: "puzzle.move", sessionId: "x", seq: -1, move: {}, hash: "zz" })).toBeNull();
    expect(parseClientMessage({ type: "nope" })).toBeNull();
    expect(parseClientMessage("string")).toBeNull();
  });

  it("keeps every field of a move on the wire so the server can narrow it per puzzle", () => {
    const m = parseClientMessage({ type: "puzzle.move", sessionId: "abcdefgh12345678", seq: 0, move: { type: "end", tick: 12 }, hash: "deadbeef" });
    expect(m?.type === "puzzle.move" && m.move).toEqual({ type: "end", tick: 12 });
    expect(parseMoveFor("gunnery", { type: "end", tick: 12 })).toEqual({ type: "end", tick: 12 });
    expect(parseMoveFor("sailing", { type: "swap", col: 0, row: 0 })).toBeNull();
  });

  it("round-trips a server result", () => {
    const msg = {
      type: "puzzle.result",
      sessionId: "abcdefgh12345678",
      score: 120,
      moves: 40,
      bestCombo: 3,
      verified: true,
      rating: { puzzle: "bilging", tier: "steady", rounds: 4 },
      tierChange: "up",
    };
    expect(parseServerMessage(JSON.parse(JSON.stringify(msg)))).toEqual(msg);
  });
});
