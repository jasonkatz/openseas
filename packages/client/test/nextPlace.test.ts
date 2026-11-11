/**
 * Where the pirate should be, decided from what changed: one row per transition the shell keeps the
 * place honest against. The shell performs each step, and each step replaces the one before it, so a
 * timed go is dropped by whatever the next look says; the rows that start from a pending beat show
 * what replaces it. The shell itself is smoked by Playwright.
 */
import { describe, expect, it } from "vitest";
import type { StationWire } from "@openseas/protocol";
import { BOARD_DONE_MS, nextPlace, placeFacts, type PlaceFacts, type PlaceStep, type PlaceWhy } from "../src/state/nextPlace.js";
import type { Place } from "../src/state/place.jsx";

const OFF: PlaceFacts = { aboard: false, online: true, captain: false, docked: false, fighting: false, atAirlock: false, stations: {}, battle: "idle", melee: "idle" };
/** Aboard a docked ship, as crew. */
const DOCKED: PlaceFacts = { ...OFF, aboard: true, docked: true };
const DOCKED_CAPTAIN: PlaceFacts = { ...DOCKED, captain: true };
/** Aboard a ship under way, as crew. */
const FLYING: PlaceFacts = { ...OFF, aboard: true };
const FLYING_CAPTAIN: PlaceFacts = { ...FLYING, captain: true };
/** The captain in a space battle, the battle board in play. */
const FIGHTING: PlaceFacts = { ...FLYING_CAPTAIN, fighting: true, battle: "playing" };
/** A boarding melee in the middle of the battle, the pirate's melee board in play. */
const BOARDING: PlaceFacts = { ...FIGHTING, atAirlock: true, melee: "playing" };

const OUTPOST: Place = { kind: "outpost", id: "tinwick", room: "none" };
const CHART: Place = { kind: "chart", pick: null };
const DECK: Place = { kind: "deck" };
const HELM: Place = { kind: "helm" };
const BATTLE: Place = { kind: "battle" };
const MELEE: Place = { kind: "melee" };
const HOME: Place = { kind: "home" };
const station = (s: StationWire): Place => ({ kind: "station", station: s });

const stay: PlaceStep = { go: null, take: null, news: null };
const goNow = (place: Place, why: PlaceWhy): PlaceStep["go"] => ({ place, afterMs: 0, why });
const afterBeat = (why: PlaceWhy): PlaceStep["go"] => ({ place: HOME, afterMs: BOARD_DONE_MS, why });

interface Row {
  place: Place;
  before: PlaceFacts | null;
  now: PlaceFacts;
  helmFrom?: StationWire;
  step: Partial<PlaceStep>;
}

const rows: Record<string, Row> = {
  // ---- coming aboard and being put off
  "boarding from the outpost moves in on the deck and says so": { place: OUTPOST, before: OFF, now: DOCKED, step: { go: goNow(HOME, "boarded"), news: "boarded" } },
  "boarding while on the chart moves in on the deck too": { place: CHART, before: OFF, now: DOCKED, step: { go: goNow(HOME, "boarded"), news: "boarded" } },
  "a pirate who comes aboard at a station stays at it and asks for it": { place: station("cooling"), before: OFF, now: DOCKED, step: { take: "cooling", news: "boarded" } },
  "a captain who comes aboard at the helm stays at it": { place: HELM, before: OFF, now: DOCKED_CAPTAIN, step: { news: "boarded" } },
  "a reconnect in a fight puts the captain back on the battle board": { place: DECK, before: OFF, now: FIGHTING, step: { go: goNow(BATTLE, "battle"), news: "boarded" } },
  "a reconnect in a melee puts the pirate back at the airlock": { place: DECK, before: OFF, now: BOARDING, step: { go: goNow(MELEE, "airlock"), news: "boarded" } },
  "staying aboard says nothing": { place: DECK, before: DOCKED, now: DOCKED, step: {} },
  "put off the ship from the deck: out to the outpost, told": { place: DECK, before: DOCKED, now: OFF, step: { go: goNow(HOME, "on-outpost"), news: "on-outpost" } },
  "put off the ship from a station: out to the outpost, told": { place: station("engines"), before: FLYING, now: OFF, step: { go: goNow(HOME, "on-outpost"), news: "on-outpost" } },
  "put off the ship from the helm: out to the outpost, told": { place: HELM, before: DOCKED_CAPTAIN, now: OFF, step: { go: goNow(HOME, "on-outpost"), news: "on-outpost" } },
  "dropped from the battle board: out to the outpost without a word": { place: BATTLE, before: FIGHTING, now: OFF, step: { go: goNow(HOME, "on-outpost") } },
  "dropped from the melee: out to the outpost without a word": { place: MELEE, before: BOARDING, now: OFF, step: { go: goNow(HOME, "on-outpost") } },
  "put off the ship while on the chart: nothing moves and nothing is said": { place: CHART, before: FLYING, now: OFF, step: {} },
  "a place aboard opened without a ship goes out to the outpost without a word": { place: DECK, before: null, now: OFF, step: { go: goNow(HOME, "on-outpost") } },

  // ---- stations
  "an open station the pirate is at is asked for, on every look": { place: station("cooling"), before: FLYING, now: FLYING, step: { take: "cooling" } },
  "a bot's station is asked for: the bot steps aside": { place: station("cooling"), before: FLYING, now: { ...FLYING, stations: { cooling: "bot" } }, step: { take: "cooling" } },
  "a station the pirate holds is left as it is": { place: station("cooling"), before: FLYING, now: { ...FLYING, stations: { cooling: "me" } }, step: {} },
  "a station a crewmate holds closes": { place: station("cooling"), before: FLYING, now: { ...FLYING, stations: { cooling: "crewmate" } }, step: { go: goNow(HOME, "station-held") } },
  "offline, a station is neither asked for nor closed": { place: station("cooling"), before: FLYING, now: { ...FLYING, online: false, stations: { cooling: "crewmate" } }, step: {} },

  // ---- the helm
  "the helm stays while the ship is docked and the pirate its captain": { place: HELM, before: DOCKED_CAPTAIN, now: DOCKED_CAPTAIN, step: {} },
  "once she flies, the captain goes back to the station they came to the helm from": { place: HELM, before: DOCKED_CAPTAIN, now: FLYING_CAPTAIN, helmFrom: "cooling", step: { go: goNow(station("cooling"), "helm-left") } },
  "once she flies, a captain who came from the deck goes back to it": { place: HELM, before: DOCKED_CAPTAIN, now: FLYING_CAPTAIN, step: { go: goNow(HOME, "helm-left") } },
  "a pirate who is no longer captain leaves the helm": { place: HELM, before: DOCKED_CAPTAIN, now: DOCKED, step: { go: goNow(HOME, "helm-left") } },

  // ---- the space battle
  "the captain's fight opens the battle board": { place: DECK, before: FLYING_CAPTAIN, now: FIGHTING, step: { go: goNow(BATTLE, "battle") } },
  "the captain's fight opens the battle board over a station's board": { place: station("cooling"), before: { ...FLYING_CAPTAIN, stations: { cooling: "me" } }, now: { ...FIGHTING, stations: { cooling: "me" } }, step: { go: goNow(BATTLE, "battle") } },
  "a fight leaves a crewmate where they are": { place: DECK, before: FLYING, now: { ...FLYING, fighting: true }, step: {} },
  "a fight that goes on after the melee opens the battle board again": { place: MELEE, before: BOARDING, now: { ...FIGHTING, melee: "result" }, step: { go: goNow(BATTLE, "battle") } },
  "the battle board stays while the fight is on": { place: BATTLE, before: FIGHTING, now: FIGHTING, step: {} },
  "anyone but the captain on the battle board goes back to the deck at once": { place: BATTLE, before: FIGHTING, now: { ...FIGHTING, captain: false }, step: { go: goNow(HOME, "not-captain") } },
  "once the fight is over, the battle board's outcome stays up until it is dismissed": { place: BATTLE, before: FIGHTING, now: { ...FLYING_CAPTAIN, battle: "result" }, step: {} },
  "once the fight is over, a battle board cut short stays as it stood until its session drops it": { place: BATTLE, before: FIGHTING, now: { ...FLYING_CAPTAIN, battle: "playing" }, step: {} },
  "once the fight is over, a battle board waiting for its verdict stays until its session drops it": { place: BATTLE, before: FIGHTING, now: { ...FLYING_CAPTAIN, battle: "waiting" }, step: {} },
  "the session drops the battle board: back to the deck after the beat": { place: BATTLE, before: { ...FLYING_CAPTAIN, battle: "playing" }, now: FLYING_CAPTAIN, step: { go: afterBeat("board-done") } },
  "while a melee is on, the battle board goes back to the deck after the beat": { place: BATTLE, before: BOARDING, now: BOARDING, step: { go: afterBeat("board-done") } },
  "while a melee is on, the battle board's outcome stays up": { place: BATTLE, before: BOARDING, now: { ...BOARDING, battle: "result" }, step: {} },

  // ---- the boarding melee
  "a boarding takes a pirate at a station to the airlock": { place: station("cooling"), before: { ...FLYING, stations: { cooling: "me" } }, now: { ...BOARDING, captain: false, stations: { cooling: "me" } }, step: { go: goNow(MELEE, "airlock") } },
  "a boarding takes the captain off the battle board to the airlock": { place: BATTLE, before: FIGHTING, now: BOARDING, step: { go: goNow(MELEE, "airlock") } },
  "the melee board stays while the melee is on": { place: MELEE, before: BOARDING, now: BOARDING, step: {} },
  "once the melee is over, its outcome stays up until it is dismissed": { place: MELEE, before: BOARDING, now: { ...FLYING, melee: "result" }, step: {} },
  "once the melee is over, a melee board cut short stays as it stood until its session drops it": { place: MELEE, before: BOARDING, now: { ...FLYING, melee: "playing" }, step: {} },
  "once the melee is over, a melee board still dealing stays until its session drops it": { place: MELEE, before: BOARDING, now: { ...FLYING, melee: "dealing" }, step: {} },
  "the session drops the melee board: back to the deck after the beat": { place: MELEE, before: { ...FLYING, melee: "playing" }, now: FLYING, step: { go: afterBeat("board-done") } },

  // ---- a newer transition in place of a pending beat
  "a boarding during the battle board's beat goes to the airlock at once": { place: BATTLE, before: FLYING_CAPTAIN, now: BOARDING, step: { go: goNow(MELEE, "airlock") } },
  "a new fight during the battle board's beat keeps the board": { place: BATTLE, before: FLYING_CAPTAIN, now: FIGHTING, step: { go: goNow(BATTLE, "battle") } },
  "a new boarding during the melee board's beat keeps the board": { place: MELEE, before: FLYING, now: BOARDING, step: { go: goNow(MELEE, "airlock") } },
  "being put off the ship during a beat goes out to the outpost at once": { place: MELEE, before: FLYING, now: OFF, step: { go: goNow(HOME, "on-outpost") } },
  "losing the helm during the battle board's beat goes back to the deck at once": { place: BATTLE, before: FLYING_CAPTAIN, now: FLYING, step: { go: goNow(HOME, "not-captain") } },
  "losing the helm as a boarding begins still leaves the battle board for the deck": { place: BATTLE, before: FIGHTING, now: { ...BOARDING, captain: false }, step: { go: goNow(HOME, "not-captain") } },
};

describe("nextPlace", () => {
  it.each(Object.entries(rows))("%s", (_, row) => {
    expect(nextPlace(row.place, row.before, row.now, row.helmFrom ?? null)).toEqual({ ...stay, ...row.step });
  });

  it("holds a fight board cut short for the session's beat and only then counts its own", () => {
    // The fight ends under a board in play: the board stands as it was cut short, however many looks come.
    const ended: PlaceFacts = { ...FLYING_CAPTAIN, battle: "playing" };
    expect(nextPlace(BATTLE, FIGHTING, ended, null).go).toBeNull();
    expect(nextPlace(BATTLE, ended, ended, null).go).toBeNull();
    // The session drops it (after its own CUT_SHORT_MS): the shell's beat starts from that look.
    expect(nextPlace(BATTLE, ended, FLYING_CAPTAIN, null).go).toEqual(afterBeat("board-done"));
    expect(nextPlace(BATTLE, FLYING_CAPTAIN, FLYING_CAPTAIN, null).go).toEqual(afterBeat("board-done"));
  });
});

describe("placeFacts", () => {
  const ship = (over: Record<string, unknown>) =>
    ({
      shipId: "ship-1",
      name: "Skiff",
      captainId: "me",
      crew: [
        { pirateId: "me", name: "Me", station: "cooling", captain: true, away: false, bot: false, crewId: null, look: null },
        { pirateId: "bot:1", name: "Gasket-7", station: "engines", captain: false, away: false, bot: true, crewId: null, look: null },
        { pirateId: "p-2", name: "Moody Quasar", station: "plating", captain: false, away: false, bot: false, crewId: null, look: null },
        { pirateId: "p-3", name: "Idle Hand", station: null, captain: false, away: false, bot: false, crewId: null, look: null },
      ],
      location: { kind: "docked", outpostId: "tinwick" },
      melee: null,
      ...over,
    }) as unknown as Parameters<typeof placeFacts>[0];

  it("reads nothing aboard without a ship", () => {
    expect(placeFacts(null, "me", true, "idle", "idle")).toEqual(OFF);
  });

  it("reads the stations, the captain and the dock from the ship", () => {
    expect(placeFacts(ship({}), "me", true, "idle", "idle")).toEqual({
      ...DOCKED_CAPTAIN,
      stations: { cooling: "me", engines: "bot", plating: "crewmate" },
    });
    expect(placeFacts(ship({}), "p-2", false, "idle", "idle")).toMatchObject({ captain: false, online: false, stations: { cooling: "crewmate", plating: "me" } });
  });

  it("reads a fight from the ship under way, and the airlock from its melee", () => {
    const inFlight = (battle: unknown) => ({ kind: "in-flight", laneId: "l", from: "tinwick", to: "echo-rock", progress: 10, hail: null, battle });
    expect(placeFacts(ship({ location: inFlight(null) }), "me", true, "idle", "idle")).toMatchObject({ docked: false, fighting: false, atAirlock: false });
    expect(placeFacts(ship({ location: inFlight({ tierId: "t", sinceTurn: 1 }) }), "me", true, "playing", "idle")).toMatchObject({ fighting: true, atAirlock: false, battle: "playing" });
    expect(placeFacts(ship({ location: inFlight({ tierId: "t", sinceTurn: 1 }), melee: { tierId: "t" } }), "me", true, "playing", "dealing")).toMatchObject({ fighting: true, atAirlock: true, melee: "dealing" });
  });
});
