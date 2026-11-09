import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { StationWire } from "@openseas/protocol";
import { content } from "@openseas/boards";

export type OutpostRoom = "none" | "dock" | "cantina" | "notice";

/**
 * Where the pirate is in the one scene (DESIGN.md 3.11). Every place is a camera move, not a page;
 * the URL mirrors it so a place can be shared, and opening the URL lands in the scene there.
 */
export type Place =
  /** Where the pirate is: their outpost when on the outpost, the deck when aboard. */
  | { kind: "home" }
  /** The whole star system, with an outpost picked or not. */
  | { kind: "chart"; pick: string | null }
  /** Moved in on an outpost, inside one of its buildings or standing outside. */
  | { kind: "outpost"; id: string; room: OutpostRoom }
  /** Aboard: the deck of the ship the pirate is on. */
  | { kind: "deck" }
  /** Aboard, at a station with its board open. */
  | { kind: "station"; station: StationWire }
  /** Aboard, the captain picking a destination on the chart. */
  | { kind: "helm" }
  /** Aboard, the captain at the space battle board (M4). */
  | { kind: "battle" }
  /** Aboard, at the airlock in a boarding melee (M5). */
  | { kind: "melee" };

const OUTPOST_IDS = new Set(content.world.outposts.map((i) => i.id));
const STATIONS = new Set<string>(["cooling", "engines", "plating", "gunnery", "navigation"]);
const ROOMS = new Set<string>(["dock", "cantina", "notice"]);

export function placeToPath(p: Place): string {
  switch (p.kind) {
    case "home":
      return "/";
    case "chart":
      return p.pick ? `/chart?pick=${encodeURIComponent(p.pick)}` : "/chart";
    case "outpost":
      return p.room === "none" ? `/outpost/${p.id}` : `/outpost/${p.id}/${p.room}`;
    case "deck":
      return "/ship";
    case "station":
      return `/ship/${p.station}`;
    case "helm":
      return "/ship/helm";
    case "battle":
      return "/ship/battle";
    case "melee":
      return "/ship/melee";
  }
}

export function pathToPlace(pathname: string, search: string): Place {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "outpost" && parts[1] && OUTPOST_IDS.has(parts[1])) {
    const room = parts[2] && ROOMS.has(parts[2]) ? (parts[2] as OutpostRoom) : "none";
    return { kind: "outpost", id: parts[1], room };
  }
  if (parts[0] === "ship") {
    if (parts[1] === "helm") return { kind: "helm" };
    if (parts[1] === "battle") return { kind: "battle" };
    if (parts[1] === "melee") return { kind: "melee" };
    if (parts[1] && STATIONS.has(parts[1])) return { kind: "station", station: parts[1] as StationWire };
    return { kind: "deck" };
  }
  if (parts[0] === "chart") {
    const pick = new URLSearchParams(search).get("pick");
    return { kind: "chart", pick: pick && OUTPOST_IDS.has(pick) ? pick : null };
  }
  return { kind: "home" };
}

export function samePlace(a: Place, b: Place): boolean {
  return placeToPath(a) === placeToPath(b);
}

interface PlaceContextValue {
  place: Place;
  go(place: Place): void;
}

const Ctx = createContext<PlaceContextValue | null>(null);

export function usePlace(): PlaceContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePlace outside PlaceProvider");
  return v;
}

export function PlaceProvider({ children }: { children: ReactNode }) {
  const [place, setPlace] = useState<Place>(() => pathToPlace(window.location.pathname, window.location.search));
  const current = useRef(place);
  current.current = place;

  useEffect(() => {
    const onPop = (): void => setPlace(pathToPlace(window.location.pathname, window.location.search));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const go = useCallback((next: Place) => {
    if (samePlace(current.current, next)) return;
    const path = placeToPath(next);
    if (path !== window.location.pathname + window.location.search) window.history.pushState(null, "", path);
    setPlace(next);
  }, []);

  const value = useMemo(() => ({ place, go }), [place, go]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
