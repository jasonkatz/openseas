import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ClientMessageSchema, ClientMessageTypeSchema, ErrorCodeSchema, parseClientMessage, parseMoveFor, parseServerMessage } from "../src/index.js";

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
    expect(parseMoveFor("engines", { type: "swap", col: 0, row: 0 })).toBeNull();
  });

  it("round-trips a server result", () => {
    const msg = {
      type: "puzzle.result",
      sessionId: "abcdefgh12345678",
      score: 120,
      moves: 40,
      bestCombo: 3,
      verified: true,
      rating: { puzzle: "cooling", tier: "steady", rounds: 4 },
      tierChange: "up",
      performance: { rating: 1540, tier: "steady" },
    };
    expect(parseServerMessage(JSON.parse(JSON.stringify(msg)))).toEqual(msg);
  });
});

describe("ship protocol", () => {
  it("parses the crew's ship messages and refuses an unknown station", () => {
    expect(parseClientMessage({ type: "ship.board", shipId: "ship-1" })).not.toBeNull();
    expect(parseClientMessage({ type: "ship.station", station: "cooling" })).not.toBeNull();
    expect(parseClientMessage({ type: "ship.station", station: null })).not.toBeNull();
    expect(parseClientMessage({ type: "ship.station", station: "core" })).toBeNull();
    expect(parseClientMessage({ type: "chat.send", channel: "ship", text: "  ahoy " })).toEqual({ type: "chat.send", channel: "ship", text: "ahoy" });
    expect(parseClientMessage({ type: "chat.send", channel: "ship", text: "   " })).toBeNull();
    expect(parseClientMessage({ type: "chat.send", channel: "crew", text: "x" })).not.toBeNull();
    expect(parseClientMessage({ type: "chat.send", channel: "fleet", text: "x" })).toBeNull();
  });

  it("a result may move no standing and still carry its performance", () => {
    const msg = {
      type: "puzzle.result",
      sessionId: "abcdefgh12345678",
      score: 12,
      moves: 4,
      bestCombo: 1,
      verified: true,
      rating: null,
      tierChange: null,
      performance: { rating: 980, tier: "greenhorn" },
    };
    expect(parseServerMessage(msg)).toEqual(msg);
  });

  it("a snapshot names every station's output and where the ship is", () => {
    const ship = {
      shipId: "ship-1",
      name: "The Static Comet",
      classId: "skiff",
      ownerId: "p1",
      captainId: "p1",
      crew: [
        { pirateId: "p1", name: "Static Comet", station: "engines", captain: true, away: false, bot: false, crewId: "c1" },
        { pirateId: "bot:1", name: "Gasket-7", station: "cooling", captain: false, away: false, bot: true, crewId: null },
      ],
      maxCrew: 6,
      inviteOnly: false,
      location: { kind: "in-flight", laneId: "a-b", from: "a", to: "b", progress: 250, hail: null, battle: null },
      turn: 3,
      heat: 120,
      damage: 24,
      loaded: 1,
      turrets: 4,
      lastTurn: { turn: 3, outputs: { cooling: 0, engines: 110, plating: 0, gunnery: 0, navigation: 0 }, held: false, speed: 1000, tokens: 4 },
      nextTurnAt: 1000,
      turnMs: 10000,
      voyagesCompleted: 0,
      melee: null,
      colors: { id: "c1", name: "The Comets", flag: { field: "pitch", accent: "bone", pattern: "plain", emblem: "skull" } },
    };
    expect(parseServerMessage({ type: "ship.state", ship, events: [{ type: "launched", laneId: "a-b" }], serverNow: 1 })).not.toBeNull();
    // Bots boot up and are powered down as events with names, like any crew change.
    const hands = [
      { type: "booted_up", pirateId: "bot:1", name: "Gasket-7", station: "cooling" },
      { type: "booted_up", pirateId: "bot:2", name: "Sprocket-12", station: null },
      { type: "powered_down", names: ["Gasket-7", "Sprocket-12"] },
    ];
    expect(parseServerMessage({ type: "ship.state", ship, events: hands, serverNow: 1 })).not.toBeNull();
    expect(parseServerMessage({ type: "ship.state", ship: { ...ship, crew: [{ ...ship.crew[0], bot: undefined }] }, events: [], serverNow: 1 })).toBeNull();
    expect(parseServerMessage({ type: "ship.state", ship: { ...ship, heat: 1001 }, events: [], serverNow: 1 })).toBeNull();
  });
});

describe("cooling heat events", () => {
  it("ride the wire as moves and narrow to Cooling", () => {
    expect(parseMoveFor("cooling", { type: "heat", row: 4 })).toEqual({ type: "heat", row: 4 });
    expect(parseMoveFor("cooling", { type: "heat", row: 40 })).toBeNull();
    expect(parseMoveFor("engines", { type: "heat", row: 4 })).toBeNull();
    expect(parseServerMessage({ type: "duty.heat", sessionId: "abcdefgh12345678", row: 3 })).toEqual({ type: "duty.heat", sessionId: "abcdefgh12345678", row: 3 });
  });
});

describe("crew protocol (M6)", () => {
  const flag = { field: "pitch", accent: "bone", pattern: "cross", emblem: "rocket" };
  it("founds a crew under a tidied name and refuses names that are not words", () => {
    expect(parseClientMessage({ type: "crew.found", name: "  The   Rust  Comets ", flag })).toEqual({ type: "crew.found", name: "The Rust Comets", flag });
    expect(parseClientMessage({ type: "crew.found", name: "Brine's Own-Crew", flag })).not.toBeNull();
    expect(parseClientMessage({ type: "crew.found", name: "<script>", flag })).toBeNull();
    expect(parseClientMessage({ type: "crew.found", name: "   ", flag })).toBeNull();
    expect(parseClientMessage({ type: "crew.found", name: "Dogs", flag: { ...flag, emblem: "Bad Id" } })).toBeNull();
  });

  it("carries ranks, answers and profiles", () => {
    expect(parseClientMessage({ type: "crew.rank", pirateId: "p2", rank: "officer" })).not.toBeNull();
    expect(parseClientMessage({ type: "crew.rank", pirateId: "p2", rank: "admiral" })).toBeNull();
    expect(parseClientMessage({ type: "crew.answer", crewId: "c1", accept: true })).not.toBeNull();
    expect(parseClientMessage({ type: "pirate.profile", name: "Static Comet" })).not.toBeNull();
  });

  it("sends the crew with where everyone is, and notices with names", () => {
    const crew = {
      id: "c1",
      name: "The Rust Comets",
      flag,
      foundedAt: 1,
      stats: { voyages: 3, victories: 1, plunder: 600 },
      members: [
        { pirateId: "p1", name: "Static Comet", rank: "commodore", joinedAt: 1, where: { kind: "aboard", shipId: "s1", shipName: "The Comet", outpostId: null, to: "echo-rock", progress: 400, joinable: true } },
        { pirateId: "p2", name: "Brine Hound", rank: "spacer", joinedAt: 2, where: { kind: "on-outpost", outpostId: "tinwick" } },
        { pirateId: "p3", name: "Kelp Witch", rank: "officer", joinedAt: 3, where: { kind: "offline" } },
      ],
      invited: [{ pirateId: "p4", name: "Tide Rat" }],
    };
    expect(parseServerMessage({ type: "crew.state", crew, invites: [], serverNow: 1 })).not.toBeNull();
    expect(parseServerMessage({ type: "crew.state", crew: null, invites: [{ crew: { id: "c1", name: "The Rust Comets", flag }, members: 3, by: "Static Comet", at: 1 }], serverNow: 1 })).not.toBeNull();
    expect(parseServerMessage({ type: "crew.notice", notice: { type: "launched", names: ["Static Comet"], shipId: "s1", shipName: "The Comet", to: "echo-rock", joinable: true }, at: 1 })).not.toBeNull();
    expect(parseServerMessage({ type: "crew.notice", notice: { type: "launched", names: [], shipId: "s1", shipName: "The Comet", to: "echo-rock", joinable: true }, at: 1 })).toBeNull();
  });
});

describe("the pirate's sheet", () => {
  it("picks a look and a title by content id, and refuses anything else", () => {
    expect(parseClientMessage({ type: "pirate.sheet" })).not.toBeNull();
    expect(parseClientMessage({ type: "pirate.look", look: { jacket: "navy", headgear: "bubble-helmet" } })).not.toBeNull();
    expect(parseClientMessage({ type: "pirate.look", look: { jacket: "Navy Blue", headgear: "bubble-helmet" } })).toBeNull();
    expect(parseClientMessage({ type: "pirate.look", look: { jacket: "navy" } })).toBeNull();
    expect(parseClientMessage({ type: "pirate.title", title: "old-stardust" })).not.toBeNull();
    expect(parseClientMessage({ type: "pirate.title", title: null })).not.toBeNull();
    expect(parseClientMessage({ type: "pirate.title", title: "<b>King</b>" })).toBeNull();
  });

  it("sends the record with every title's progress, and earned titles as they land", () => {
    const sheet = {
      record: { since: 1, voyages: 3, captained: 1, victories: 1, plunder: 240, boards: 12 },
      titles: [
        { id: "lane-rider", earned: true, have: 3, need: 1 },
        { id: "coolhand", earned: false, have: -1, need: 3 },
      ],
    };
    expect(parseServerMessage({ type: "pirate.sheet", sheet })).not.toBeNull();
    expect(parseServerMessage({ type: "pirate.titles", earned: ["lane-rider"] })).not.toBeNull();
    expect(parseServerMessage({ type: "pirate.titles", earned: [] })).toBeNull();
  });

  it("reads a summary, a profile and a crew view from a server that sends no look or title", () => {
    const welcome = parseServerMessage({ type: "welcome", pirate: { id: "p1", name: "Static Comet", guest: true, balance: 0, ratings: [], ships: [], outpostId: "tinwick" }, serverNow: 1 });
    expect(welcome?.type === "welcome" && welcome.pirate.look).toBeNull();
    expect(welcome?.type === "welcome" && welcome.pirate.title).toBeNull();
    const profile = parseServerMessage({ type: "pirate.profile", profile: { pirateId: "p1", name: "Static Comet", crew: null, ratings: [], voyages: 2, online: true, invited: false } });
    expect(profile?.type === "pirate.profile" && profile.profile).toMatchObject({ look: null, title: null, victories: 0 });
  });
});


describe("refusals (ADR 0043)", () => {
  it("an error names the client message it refuses, and parses without the name too", () => {
    const named = { type: "error", code: "in_battle", for: "duty.start" };
    expect(parseServerMessage(named)).toEqual(named);
    // A server older than the field, or a message that was no request, names none.
    expect(parseServerMessage({ type: "error", code: "in_battle" })).toEqual({ type: "error", code: "in_battle" });
    expect(parseServerMessage({ type: "error", code: "bad_message", detail: "x" })).toEqual({ type: "error", code: "bad_message", detail: "x" });
    // The name is a client message's type and nothing else.
    expect(parseServerMessage({ type: "error", code: "in_battle", for: "pong" })).toBeNull();
    expect(ClientMessageTypeSchema.options).toContain("duty.start");
    expect(ClientMessageTypeSchema.options).toHaveLength(ClientMessageSchema.options.length);
  });

  it("a client older than the field reads a newer server's error, dropping the name", () => {
    // The error message as a client built before ADR 0043 parses it.
    const before = z.object({ type: z.literal("error"), code: ErrorCodeSchema, detail: z.string().optional() });
    expect(before.parse({ type: "error", code: "not_hailed", for: "ship.engage" })).toEqual({ type: "error", code: "not_hailed" });
  });
});
