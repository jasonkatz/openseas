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

describe("ship protocol", () => {
  it("parses the crew's ship messages and refuses an unknown station", () => {
    expect(parseClientMessage({ type: "ship.board", shipId: "ship-1" })).not.toBeNull();
    expect(parseClientMessage({ type: "ship.station", station: "bilging" })).not.toBeNull();
    expect(parseClientMessage({ type: "ship.station", station: null })).not.toBeNull();
    expect(parseClientMessage({ type: "ship.station", station: "rigging" })).toBeNull();
    expect(parseClientMessage({ type: "chat.send", channel: "ship", text: "  ahoy " })).toEqual({ type: "chat.send", channel: "ship", text: "ahoy" });
    expect(parseClientMessage({ type: "chat.send", channel: "ship", text: "   " })).toBeNull();
    expect(parseClientMessage({ type: "chat.send", channel: "crew", text: "x" })).toBeNull();
  });

  it("a duty result may carry no rating", () => {
    const msg = {
      type: "puzzle.result",
      sessionId: "abcdefgh12345678",
      score: 12,
      moves: 4,
      bestCombo: 1,
      verified: true,
      rating: null,
      tierChange: null,
    };
    expect(parseServerMessage(msg)).toEqual(msg);
  });

  it("a snapshot names every station's output and where the ship is", () => {
    const ship = {
      shipId: "ship-1",
      name: "The Salty Gull",
      classId: "sloop",
      ownerId: "p1",
      captainId: "p1",
      crew: [{ pirateId: "p1", name: "Salty Gull", station: "sailing", captain: true, away: false }],
      maxCrew: 6,
      inviteOnly: false,
      location: { kind: "at-sea", routeId: "a-b", from: "a", to: "b", progress: 250, hail: null },
      turn: 3,
      water: 120,
      damage: 24,
      loaded: 1,
      cannons: 4,
      lastTurn: { turn: 3, outputs: { bilging: 0, sailing: 110, carpentry: 0, gunnery: 0, navigation: 0 }, held: false, speed: 1000, tokens: 4 },
      nextTurnAt: 1000,
      turnMs: 10000,
      voyagesCompleted: 0,
    };
    expect(parseServerMessage({ type: "ship.state", ship, events: [{ type: "sailed", routeId: "a-b" }], serverNow: 1 })).not.toBeNull();
    expect(parseServerMessage({ type: "ship.state", ship: { ...ship, water: 1001 }, events: [], serverNow: 1 })).toBeNull();
  });
});
