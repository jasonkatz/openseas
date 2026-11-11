import type { RoundPhase } from "@openseas/boards";
import type { ShipSnapshot, StationWire } from "@openseas/protocol";
import type { Place } from "./place.jsx";

/**
 * How long a fight board with nothing more to show stays up over the deck before the pirate is sent
 * back to the deck. It follows the round session's own beat instead of racing it: a board cut short
 * when its fight ends keeps showing its last round until the session drops it (`CUT_SHORT_MS`,
 * 2400 ms, in boards' `useRoundSession`), and this beat starts only once the board is idle. So a
 * fight that ends under a board in play keeps the board up for both beats, one after the other,
 * whatever either one is set to.
 */
export const BOARD_DONE_MS = 3000;

/** Who holds a station, as the pirate sees it. */
export type StationHolder = "me" | "crewmate" | "bot";

/**
 * What the place is kept honest against: the ship as the pirate's connection last heard it, and how
 * the two fight boards' round sessions stand. The shell takes one on every change and hands
 * `nextPlace` the one before it too, so a rule can tell arriving from staying.
 */
export interface PlaceFacts {
  aboard: boolean;
  /** The connection is open, so a station can be asked for. */
  online: boolean;
  captain: boolean;
  docked: boolean;
  /** The ship is in a space battle. */
  fighting: boolean;
  /** A boarding melee is on: everyone aboard belongs at the airlock. */
  atAirlock: boolean;
  /** Who holds each station that is held. */
  stations: Partial<Record<StationWire, StationHolder>>;
  /** The captain's battle board. */
  battle: RoundPhase;
  /** The pirate's melee board. */
  melee: RoundPhase;
}

export function placeFacts(ship: ShipSnapshot | null, me: string, online: boolean, battle: RoundPhase, melee: RoundPhase): PlaceFacts {
  const stations: PlaceFacts["stations"] = {};
  for (const c of ship?.crew ?? []) {
    if (c.station && !stations[c.station]) stations[c.station] = c.pirateId === me ? "me" : c.bot ? "bot" : "crewmate";
  }
  return {
    aboard: ship !== null,
    online,
    captain: ship?.captainId === me,
    docked: ship?.location.kind === "docked",
    fighting: (ship?.location.kind === "in-flight" ? ship.location.battle : null) !== null,
    atAirlock: (ship?.melee ?? null) !== null,
    stations,
    battle,
    melee,
  };
}

/** The rule that moves the pirate, by name. */
export type PlaceWhy =
  /** Came aboard: in on the deck. */
  | "boarded"
  /** Not aboard, at a place aboard: out to the outpost. */
  | "on-outpost"
  /** A crewmate holds the station. */
  | "station-held"
  /** The helm wants a docked ship and its captain: back where the captain came to it from. */
  | "helm-left"
  /** The captain's fight began. */
  | "battle"
  /** A boarding began. */
  | "airlock"
  /** The battle board is the captain's alone. */
  | "not-captain"
  /** A fight board has nothing more to show. */
  | "board-done";

/**
 * What the shell does after a look. Each step replaces the one before it: a timed go still pending
 * when the next look comes is dropped, whatever that look says, so a beat counts from the latest
 * change the shell saw.
 */
export interface PlaceStep {
  /** Where the pirate goes: at once when `afterMs` is 0, otherwise after that beat. */
  go: { place: Place; afterMs: number; why: PlaceWhy } | null;
  /** A station to ask the ship for: the pirate is at it, and nobody but a bot holds it. */
  take: StationWire | null;
  /** What the shell tells the pirate: they came aboard, or they were put off the ship from the deck, a station or the helm. */
  news: "boarded" | "on-outpost" | null;
}

const HOME: Place = { kind: "home" };
const BATTLE: Place = { kind: "battle" };
const MELEE: Place = { kind: "melee" };
/** The places that only exist aboard. */
const ABOARD_ONLY = new Set<Place["kind"]>(["deck", "station", "helm", "battle", "melee"]);
/** The places aboard a pirate put off the ship is told about leaving; the fight boards close without a word. */
const TOLD_ON_OUTPOST = new Set<Place["kind"]>(["deck", "station", "helm"]);

type Go = NonNullable<PlaceStep["go"]>;
const at = (place: Place, why: PlaceWhy): Go => ({ place, afterMs: 0, why });
const afterBeat = (place: Place, why: PlaceWhy): Go => ({ place, afterMs: BOARD_DONE_MS, why });
/** The captain flies the battle board: a fight is on and no melee holds everyone at the airlock. */
const atBattleBoard = (f: PlaceFacts | null): boolean => f !== null && f.fighting && f.captain && !f.atAirlock;

/**
 * Where the pirate should be after a change, from the place they are at (with "home" resolved), the
 * facts at the shell's last look (null before the first) and the facts now. `helmFrom` is the
 * station the captain came to the helm from, if any. Pure: the shell performs the step.
 */
export function nextPlace(place: Place, before: PlaceFacts | null, now: PlaceFacts, helmFrom: StationWire | null): PlaceStep {
  // A station the pirate is at but does not hold is asked for on every look until it is theirs; a
  // bot's hand steps aside for a pirate.
  const holder = place.kind === "station" ? now.stations[place.station] : undefined;
  const take = place.kind === "station" && now.aboard && now.online && (holder === undefined || holder === "bot") ? place.station : null;
  const boarded = now.aboard && !before?.aboard;
  const putOff = !now.aboard && before?.aboard === true && TOLD_ON_OUTPOST.has(place.kind);
  return { go: goFor(place, before, now, helmFrom), take, news: boarded ? "boarded" : putOff ? "on-outpost" : null };
}

/** The first rule that moves the pirate wins; the beats of the fight boards come last. */
function goFor(place: Place, before: PlaceFacts | null, now: PlaceFacts, helmFrom: StationWire | null): Go | null {
  // Off the ship (put off, or the connection dropped), no place aboard holds; anyone but the captain
  // on the battle board goes back to the deck.
  if (!now.aboard) return ABOARD_ONLY.has(place.kind) ? at(HOME, "on-outpost") : null;
  if (place.kind === "battle" && !now.captain) return at(HOME, "not-captain");
  // A boarding takes everyone to the airlock; the captain's fight, or one that goes on after a
  // melee, opens the battle board over the deck.
  if (now.atAirlock && !before?.atAirlock) return at(MELEE, "airlock");
  if (atBattleBoard(now) && !atBattleBoard(before)) return at(BATTLE, "battle");
  // Once she flies, the captain goes back where they came to the helm from: a station's board
  // picks up at once, the deck otherwise.
  if (place.kind === "helm" && (!now.docked || !now.captain)) return at(helmFrom ? { kind: "station", station: helmFrom } : HOME, "helm-left");
  if (place.kind === "station" && now.online && now.stations[place.station] === "crewmate") return at(HOME, "station-held");
  // Boarding moves in on the deck, unless the pirate came aboard at a station or the helm.
  if (!before?.aboard && place.kind !== "station" && place.kind !== "helm") return at(HOME, "boarded");
  if (place.kind === "melee") return now.atAirlock ? null : overBoard(now.melee);
  if (place.kind === "battle") {
    if (!now.fighting) return overBoard(now.battle);
    // While a melee holds everyone at the airlock, the battle board goes back to the deck after a
    // beat, unless it shows an outcome.
    return now.atAirlock && now.battle !== "result" ? afterBeat(HOME, "board-done") : null;
  }
  return null;
}

/**
 * A fight board whose fight is over stays up while it has something to show: a round its session
 * still holds as it stood when the fight ended, or an outcome the pirate has not dismissed. The idle
 * board goes back to the deck after a beat.
 */
function overBoard(phase: RoundPhase): Go | null {
  return phase === "idle" ? afterBeat(HOME, "board-done") : null;
}
