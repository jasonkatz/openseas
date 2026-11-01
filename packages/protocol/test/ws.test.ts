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

  it("round-trips a ship snapshot and ship messages", () => {
    const ship = {
      shipId: "s1",
      name: "The Salty Gull",
      classId: "sloop",
      ownerId: "p1",
      captainId: "p1",
      crew: [{ pirateId: "p1", name: "Salty Gull", station: "sailing", captain: true, away: false }],
      maxCrew: 6,
      inviteOnly: false,
      location: { kind: "at-sea", routeId: "a-b", from: "a", to: "b", progress: 420, hail: null },
      turn: 9,
      water: 120,
      damage: 40,
      loaded: 2,
      cannons: 4,
      lastTurn: { turn: 9, outputs: { sailing: 110 }, held: false, speed: 1000, tokens: 4 },
      nextTurnAt: 1_000_000,
      turnMs: 10_000,
      voyagesCompleted: 0,
    };
    const msg = { type: "ship.state", ship, events: [{ type: "sailed", routeId: "a-b" }], serverNow: 999_000 };
    expect(parseServerMessage(JSON.parse(JSON.stringify(msg)))).toEqual(msg);
    expect(parseClientMessage({ type: "ship.sail", routeId: "a-b" })).toEqual({ type: "ship.sail", routeId: "a-b" });
    expect(parseClientMessage({ type: "ship.station", station: "rigging" })).toBeNull();
    expect(parseClientMessage({ type: "ship.station", station: null })).toEqual({ type: "ship.station", station: null });
    expect(parseClientMessage({ type: "duty.start" })).toEqual({ type: "duty.start" });
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
