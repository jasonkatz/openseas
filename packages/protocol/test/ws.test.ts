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
      performance: { rating: 1540, tier: "steady" },
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
      name: "The Salty Gull",
      classId: "sloop",
      ownerId: "p1",
      captainId: "p1",
      crew: [
        { pirateId: "p1", name: "Salty Gull", station: "sailing", captain: true, away: false, mate: false, crewId: "c1" },
        { pirateId: "mate:1", name: "Brackish Eel", station: "bilging", captain: false, away: false, mate: true, crewId: null },
      ],
      maxCrew: 6,
      inviteOnly: false,
      location: { kind: "at-sea", routeId: "a-b", from: "a", to: "b", progress: 250, hail: null, battle: null },
      turn: 3,
      water: 120,
      damage: 24,
      loaded: 1,
      cannons: 4,
      lastTurn: { turn: 3, outputs: { bilging: 0, sailing: 110, carpentry: 0, gunnery: 0, navigation: 0 }, held: false, speed: 1000, tokens: 4 },
      nextTurnAt: 1000,
      turnMs: 10000,
      voyagesCompleted: 0,
      melee: null,
      colors: { id: "c1", name: "The Gulls", flag: { field: "pitch", accent: "bone", pattern: "plain", emblem: "skull" } },
    };
    expect(parseServerMessage({ type: "ship.state", ship, events: [{ type: "sailed", routeId: "a-b" }], serverNow: 1 })).not.toBeNull();
    // Deckhands sign on and are paid off as events with names, like any crew change.
    const hands = [
      { type: "hired", pirateId: "mate:1", name: "Brackish Eel", station: "bilging" },
      { type: "hired", pirateId: "mate:2", name: "Windward Tern", station: null },
      { type: "paid_off", names: ["Brackish Eel", "Windward Tern"] },
    ];
    expect(parseServerMessage({ type: "ship.state", ship, events: hands, serverNow: 1 })).not.toBeNull();
    expect(parseServerMessage({ type: "ship.state", ship: { ...ship, crew: [{ ...ship.crew[0], mate: undefined }] }, events: [], serverNow: 1 })).toBeNull();
    expect(parseServerMessage({ type: "ship.state", ship: { ...ship, water: 1001 }, events: [], serverNow: 1 })).toBeNull();
  });
});

describe("bilging water events", () => {
  it("ride the wire as moves and narrow to Bilging", () => {
    expect(parseMoveFor("bilging", { type: "water", row: 4 })).toEqual({ type: "water", row: 4 });
    expect(parseMoveFor("bilging", { type: "water", row: 40 })).toBeNull();
    expect(parseMoveFor("sailing", { type: "water", row: 4 })).toBeNull();
    expect(parseServerMessage({ type: "duty.water", sessionId: "abcdefgh12345678", row: 3 })).toEqual({ type: "duty.water", sessionId: "abcdefgh12345678", row: 3 });
  });
});

describe("crew protocol (M6)", () => {
  const flag = { field: "pitch", accent: "bone", pattern: "cross", emblem: "anchor" };
  it("founds a crew under a tidied name and refuses names that are not words", () => {
    expect(parseClientMessage({ type: "crew.found", name: "  The   Salt  Dogs ", flag })).toEqual({ type: "crew.found", name: "The Salt Dogs", flag });
    expect(parseClientMessage({ type: "crew.found", name: "Brine's Own-Crew", flag })).not.toBeNull();
    expect(parseClientMessage({ type: "crew.found", name: "<script>", flag })).toBeNull();
    expect(parseClientMessage({ type: "crew.found", name: "   ", flag })).toBeNull();
    expect(parseClientMessage({ type: "crew.found", name: "Dogs", flag: { ...flag, emblem: "Bad Id" } })).toBeNull();
  });

  it("carries ranks, answers and profiles", () => {
    expect(parseClientMessage({ type: "crew.rank", pirateId: "p2", rank: "officer" })).not.toBeNull();
    expect(parseClientMessage({ type: "crew.rank", pirateId: "p2", rank: "admiral" })).toBeNull();
    expect(parseClientMessage({ type: "crew.answer", crewId: "c1", accept: true })).not.toBeNull();
    expect(parseClientMessage({ type: "pirate.profile", name: "Salty Gull" })).not.toBeNull();
  });

  it("sends the crew with where everyone is, and notices with names", () => {
    const crew = {
      id: "c1",
      name: "The Salt Dogs",
      flag,
      foundedAt: 1,
      stats: { voyages: 3, victories: 1, booty: 600 },
      members: [
        { pirateId: "p1", name: "Salty Gull", rank: "commodore", joinedAt: 1, where: { kind: "aboard", shipId: "s1", shipName: "The Gull", islandId: null, to: "gullhaven", progress: 400, joinable: true } },
        { pirateId: "p2", name: "Brine Hound", rank: "sailor", joinedAt: 2, where: { kind: "ashore", islandId: "saltwick" } },
        { pirateId: "p3", name: "Kelp Witch", rank: "officer", joinedAt: 3, where: { kind: "offline" } },
      ],
      invited: [{ pirateId: "p4", name: "Tide Rat" }],
    };
    expect(parseServerMessage({ type: "crew.state", crew, invites: [], serverNow: 1 })).not.toBeNull();
    expect(parseServerMessage({ type: "crew.state", crew: null, invites: [{ crew: { id: "c1", name: "The Salt Dogs", flag }, members: 3, by: "Salty Gull", at: 1 }], serverNow: 1 })).not.toBeNull();
    expect(parseServerMessage({ type: "crew.notice", notice: { type: "sailed", names: ["Salty Gull"], shipId: "s1", shipName: "The Gull", to: "gullhaven", joinable: true }, at: 1 })).not.toBeNull();
    expect(parseServerMessage({ type: "crew.notice", notice: { type: "sailed", names: [], shipId: "s1", shipName: "The Gull", to: "gullhaven", joinable: true }, at: 1 })).toBeNull();
  });
});

describe("the pirate's sheet", () => {
  it("picks a look and a title by content id, and refuses anything else", () => {
    expect(parseClientMessage({ type: "pirate.sheet" })).not.toBeNull();
    expect(parseClientMessage({ type: "pirate.look", look: { coat: "navy", hat: "tricorne" } })).not.toBeNull();
    expect(parseClientMessage({ type: "pirate.look", look: { coat: "Navy Blue", hat: "tricorne" } })).toBeNull();
    expect(parseClientMessage({ type: "pirate.look", look: { coat: "navy" } })).toBeNull();
    expect(parseClientMessage({ type: "pirate.title", title: "old-salt" })).not.toBeNull();
    expect(parseClientMessage({ type: "pirate.title", title: null })).not.toBeNull();
    expect(parseClientMessage({ type: "pirate.title", title: "<b>King</b>" })).toBeNull();
  });

  it("sends the record with every title's progress, and earned titles as they land", () => {
    const sheet = {
      record: { since: 1, voyages: 3, captained: 1, victories: 1, booty: 240, boards: 12 },
      titles: [
        { id: "wave-rider", earned: true, have: 3, need: 1 },
        { id: "pumpmaster", earned: false, have: -1, need: 3 },
      ],
    };
    expect(parseServerMessage({ type: "pirate.sheet", sheet })).not.toBeNull();
    expect(parseServerMessage({ type: "pirate.titles", earned: ["wave-rider"] })).not.toBeNull();
    expect(parseServerMessage({ type: "pirate.titles", earned: [] })).toBeNull();
  });

  it("reads a summary, a profile and a crew view from a server that sends no look or title", () => {
    const welcome = parseServerMessage({ type: "welcome", pirate: { id: "p1", name: "Salty Gull", guest: true, balance: 0, ratings: [], ships: [], islandId: "saltwick" }, serverNow: 1 });
    expect(welcome?.type === "welcome" && welcome.pirate.look).toBeNull();
    expect(welcome?.type === "welcome" && welcome.pirate.title).toBeNull();
    const profile = parseServerMessage({ type: "pirate.profile", profile: { pirateId: "p1", name: "Salty Gull", crew: null, ratings: [], voyages: 2, online: true, invited: false } });
    expect(profile?.type === "pirate.profile" && profile.profile).toMatchObject({ look: null, title: null, victories: 0 });
  });
});

