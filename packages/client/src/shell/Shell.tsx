import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ShipLocation, StationWire } from "@openseas/protocol";
import { content, sfx, t, usePirate } from "@openseas/boards";
import { ChartCard } from "../chart/ChartCard.jsx";
import { IslandCard } from "../island/IslandCard.jsx";
import { islandName, stationName } from "../names.js";
import { DeckCard, HelmCard, describeEvent } from "../ship/DeckCard.jsx";
import { StationView } from "../ship/StationView.jsx";
import { useShip } from "../state/ShipProvider.jsx";
import { usePlace, type Place } from "../state/place.jsx";
import { useMediaQuery, useShowMarks } from "../state/settings.js";
import { useToasts } from "../state/toasts.jsx";
import { World, type Deck, type Focus, type Insets, type WorldInput, type WorldShip, type WorldShipLocation } from "../world/World.jsx";
import { Menu } from "./Menu.jsx";
import { Toasts } from "./Toasts.jsx";
import { TopBar } from "./TopBar.jsx";

const BOARD_REFRESH_MS = 4000;

function worldLocation(l: ShipLocation): WorldShipLocation {
  return l.kind === "docked" ? { kind: "docked", islandId: l.islandId } : { kind: "at-sea", from: l.from, to: l.to, progress: l.progress };
}

/**
 * The one experience (ADR 0018, ADR 0020): the world behind everything, one bar on top, one card
 * for the place the pirate is in, the station layer over it all when a board is open, one menu.
 * Moving between places is a camera move in the world and a different card; nothing reloads.
 */
export function Shell() {
  const { pirate, socketStatus } = usePirate();
  const { ship, left, notices, listBoard, board, boardShip, takeStation, error, clearError } = useShip();
  const { place, go } = usePlace();
  const { toast } = useToasts();
  const wide = useMediaQuery("(min-width: 900px)");
  const [menuOpen, setMenuOpen] = useState(false);
  const [showMarks, setShowMarks] = useShowMarks();
  const [shipPick, setShipPick] = useState<string | null>(null);
  const [helmPick, setHelmPick] = useState<string | null>(null);
  const online = socketStatus === "open";
  const me = pirate?.id ?? "";
  const here = ship ? (ship.location.kind === "docked" ? ship.location.islandId : null) : (pirate?.islandId ?? content.world.startIslandId);
  const ashoreAt = pirate?.islandId ?? content.world.startIslandId;
  const aboard = ship !== null;
  const myStation = ship?.crew.find((c) => c.pirateId === me)?.station ?? null;

  // ---- keep the place honest against the ship: boarding moves in on the deck, going ashore moves out.
  const wasAboard = useRef(false);
  useEffect(() => {
    if (aboard && !wasAboard.current) {
      if (place.kind !== "station" && place.kind !== "helm") go({ kind: "deck" });
      sfx.start();
      toast(t("toast.boarded", { ship: ship!.name }), "good");
    }
    if (!aboard && (place.kind === "deck" || place.kind === "station" || place.kind === "helm")) {
      go({ kind: "island", id: ashoreAt, room: "none" });
      if (wasAboard.current) toast(t("toast.ashore", { island: islandName(ashoreAt) }));
    }
    wasAboard.current = aboard;
  }, [aboard, place.kind, go, toast, ship, ashoreAt]);

  // A deep link to a station takes it; a station that is not ours anymore closes.
  useEffect(() => {
    if (place.kind !== "station" || !ship || !online) return;
    const holder = ship.crew.find((c) => c.station === place.station);
    if (holder && holder.pirateId !== me) {
      go({ kind: "deck" });
      return;
    }
    if (!holder && myStation !== place.station) takeStation(place.station);
  }, [place, ship, online, me, myStation, takeStation, go]);

  // A helm place needs a docked ship and the wheel.
  useEffect(() => {
    if (place.kind === "helm" && ship && (ship.location.kind !== "docked" || ship.captainId !== me)) go({ kind: "deck" });
  }, [place.kind, ship, me, go]);

  // ---- the notice board doubles as the chart's list of ships: refresh it while looking around.
  useEffect(() => {
    if (!online || place.kind === "station") return;
    listBoard();
    const id = window.setInterval(listBoard, BOARD_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [online, place.kind, listBoard]);

  // ---- what happens aboard floats up as toasts, with a sound for the big ones.
  const lastNotice = useRef(0);
  useEffect(() => {
    for (const n of notices) {
      if (n.id <= lastNotice.current) continue;
      lastNotice.current = n.id;
      const e = n.event;
      if (e.type === "hailed") {
        sfx.alarm();
        toast(describeEvent(e) as string, "warn", 6000);
      } else if (e.type === "arrived") {
        sfx.streak(5);
        toast(t("ship.arrived_blurb", { island: islandName(e.islandId) }), "good", 6000);
        if (place.kind === "station") go({ kind: "deck" });
      } else if (e.type === "evaded" || e.type === "sailed" || e.type === "boarded" || e.type === "left" || e.type === "wheel") {
        if (!(e.type === "boarded" && e.pirateId === me)) toast(describeEvent(e) as string);
      }
    }
  }, [notices, toast, me, place.kind, go]);

  useEffect(() => {
    if (error && place.kind !== "deck" && place.kind !== "island" && place.kind !== "helm") toast(t(`error.${error}`), "warn");
  }, [error, place.kind, toast]);

  // ---- the world's input
  const ships = useMemo<WorldShip[]>(() => {
    const out: WorldShip[] = [];
    const seen = new Set<string>();
    if (ship) {
      out.push({ id: ship.shipId, name: ship.name, kind: "aboard", location: worldLocation(ship.location) });
      seen.add(ship.shipId);
    }
    for (const s of board?.ships ?? []) {
      if (seen.has(s.shipId)) continue;
      seen.add(s.shipId);
      out.push({ id: s.shipId, name: s.name, kind: s.yours ? "yours" : "other", location: worldLocation(s.location) });
    }
    for (const s of pirate?.ships ?? []) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      out.push({ id: s.id, name: s.name, kind: "yours", location: { kind: "docked", islandId: s.islandId } });
    }
    return out;
  }, [ship, board, pirate]);

  const focus = useMemo<Focus>(() => {
    if ((place.kind === "deck" || place.kind === "station") && ship) return { kind: "ship", id: ship.shipId };
    if (place.kind === "island") return { kind: "island", id: place.id };
    return { kind: "all" };
  }, [place, ship]);

  const deck = useMemo<Deck | null>(() => {
    if (!ship) return null;
    const stations = content.world.shipClasses.find((c) => c.id === ship.classId)?.stations ?? [];
    return {
      shipId: ship.shipId,
      stations: stations.map((st) => {
        const holder = ship.crew.find((c) => c.station === st) ?? null;
        return { station: st, label: stationName(st), holder: holder ? (holder.pirateId === me ? t("ship.you") : holder.name) : null, mine: holder?.pirateId === me };
      }),
      crew: ship.crew.map((c) => ({ pirateId: c.pirateId, station: c.station, mine: c.pirateId === me, captain: c.captain })),
    };
  }, [ship, me]);

  const reachable = useMemo(() => (place.kind === "helm" && ship?.location.kind === "docked" ? content.world.routes.filter((r) => r.from === (ship.location as { islandId: string }).islandId).map((r) => r.to) : []), [place.kind, ship]);

  const insets = useMemo<Insets>(() => {
    if (wide) return { top: 0.09, bottom: 0.03, left: 0.02, right: 0.4 };
    const bottom = place.kind === "chart" ? 0.3 : place.kind === "helm" ? 0.42 : place.kind === "island" ? 0.46 : 0.5;
    return { top: 0.1, bottom, left: 0.02, right: 0.02 };
  }, [wide, place.kind]);

  const input = useMemo<WorldInput>(
    () => ({
      islands: content.world.islands.map((i) => ({
        id: i.id,
        name: t(i.nameKey),
        x: i.x,
        y: i.y,
        landmark: i.landmark,
        buildings: i.buildings.map((b) => ({ kind: b, label: t(b === "dock" ? "island.dock" : b === "tavern" ? "island.tavern" : "island.notice_board") })),
      })),
      routes: content.world.routes.map((r) => ({ id: r.id, from: r.from, to: r.to })),
      ships,
      here: aboard ? null : ashoreAt,
      focus,
      selected: place.kind === "chart" ? place.pick : place.kind === "helm" ? helmPick : null,
      reachable,
      selectedShip: place.kind === "chart" ? shipPick : null,
      smoothMs: content.world.ship.turnSeconds * 1000,
      deck,
      insets,
      dimmed: place.kind === "station" || menuOpen,
    }),
    [ships, aboard, ashoreAt, focus, place, helmPick, reachable, shipPick, deck, insets, menuOpen],
  );

  // ---- taps in the world
  const onIsland = useCallback(
    (id: string) => {
      sfx.tick(false);
      if (place.kind === "helm") {
        if (reachable.includes(id)) setHelmPick(id);
        return;
      }
      if (place.kind === "chart" && place.pick !== id) {
        setShipPick(null);
        go({ kind: "chart", pick: id });
        return;
      }
      setShipPick(null);
      go({ kind: "island", id, room: "none" });
    },
    [place, reachable, go],
  );
  const onShip = useCallback(
    (id: string) => {
      sfx.tick(false);
      if (ship?.shipId === id) {
        go({ kind: "deck" });
        return;
      }
      if (place.kind === "chart") {
        setShipPick(id);
        go({ kind: "chart", pick: null });
      } else if (place.kind === "island" && !aboard) boardShip(id);
    },
    [ship, place.kind, aboard, go, boardShip],
  );
  const onBuilding = useCallback(
    (islandId: string, b: "dock" | "tavern" | "notice-board") => {
      sfx.tick(false);
      if (islandId !== here) {
        toast(t("world.far_away", { island: islandName(ashoreAt) }));
        return;
      }
      go({ kind: "island", id: islandId, room: b === "dock" ? "dock" : b === "tavern" ? "tavern" : "notice" });
    },
    [here, ashoreAt, go, toast],
  );
  const onStation = useCallback(
    (st: StationWire) => {
      if (!ship) return;
      const holder = ship.crew.find((c) => c.station === st);
      if (holder && holder.pirateId !== me) {
        toast(t("error.station_taken"), "warn");
        return;
      }
      sfx.swap();
      if (!holder) takeStation(st);
      go({ kind: "station", station: st });
    },
    [ship, me, takeStation, go, toast],
  );
  const events = useMemo(() => ({ onIsland, onShip, onBuilding, onStation }), [onIsland, onShip, onBuilding, onStation]);

  // ---- the card for the place
  let card: React.ReactNode = null;
  if (ship && (place.kind === "deck" || place.kind === "station")) {
    card = <DeckCard ship={ship} me={me} onStation={onStation} onHelm={() => (setHelmPick(null), go({ kind: "helm" }))} />;
  } else if (ship && place.kind === "helm") {
    card = <HelmCard ship={ship} pick={helmPick} onPick={setHelmPick} onCancel={() => go({ kind: "deck" })} />;
  } else if (place.kind === "island") {
    card = (
      <IslandCard
        id={place.id}
        room={place.room}
        here={here ?? ashoreAt}
        onRoom={(room) => go({ kind: "island", id: place.id, room })}
        onBack={() => go({ kind: "chart", pick: null })}
      />
    );
  } else {
    card = (
      <ChartCard
        here={here ?? ashoreAt}
        pick={place.kind === "chart" ? place.pick : null}
        shipPick={shipPick}
        aboard={aboard}
        onIsland={(id) => go({ kind: "island", id, room: "none" })}
        onBackAboard={() => go({ kind: "deck" })}
        onClearPick={() => (setShipPick(null), go({ kind: "chart", pick: null }))}
      />
    );
  }

  const stationOpen = ship && place.kind === "station" ? place.station : null;
  const placeOf = (p: Place): string => p.kind;

  return (
    <div className={`shell ${wide ? "shell-wide" : "shell-tall"} place-${placeOf(place)} ${stationOpen ? "has-station" : ""}`} data-testid="shell" data-place={placeOf(place)}>
      <World input={input} events={events} />
      <TopBar onMenu={() => setMenuOpen(true)} />
      <aside className="sheet" data-testid="sheet">
        {card}
      </aside>
      {stationOpen && ship && <StationView ship={ship} station={stationOpen} showMarks={showMarks} onBack={() => go({ kind: "deck" })} />}
      {menuOpen && <Menu showMarks={showMarks} onShowMarks={setShowMarks} onClose={() => setMenuOpen(false)} />}
      <Toasts />
      {left && null}
      {error && place.kind === "chart" && (
        <button className="error-line" onClick={clearError}>
          {t(`error.${error}`)}
        </button>
      )}
    </div>
  );
}
