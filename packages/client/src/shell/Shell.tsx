import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ShipLocation, StationWire } from "@openseas/protocol";
import { content, sfx, t, usePirate } from "@openseas/boards";
import { ChartCard } from "../chart/ChartCard.jsx";
import { IslandCard } from "../island/IslandCard.jsx";
import { islandName, stationName, tierName } from "../names.js";
import { BattleView } from "../ship/battle/BattleView.jsx";
import { DeckCard, HelmCard, describeEvent } from "../ship/DeckCard.jsx";
import { ShipHud } from "../ship/ShipHud.jsx";
import { StationView } from "../ship/StationView.jsx";
import { useShip } from "../state/ShipProvider.jsx";
import { usePlace, type Place } from "../state/place.jsx";
import { useMediaQuery, useShowMarks } from "../state/settings.js";
import { useToasts } from "../state/toasts.jsx";
import { World, type Deck, type Focus, type Insets, type WorldInput, type WorldShip, type WorldShipLocation } from "../world/World.jsx";
import { HailBanner } from "./HailBanner.jsx";
import { Menu } from "./Menu.jsx";
import { Toasts } from "./Toasts.jsx";
import { TopBar } from "./TopBar.jsx";

const BOARD_REFRESH_MS = 4000;

function worldLocation(l: ShipLocation): WorldShipLocation {
  return l.kind === "docked" ? { kind: "docked", islandId: l.islandId } : { kind: "at-sea", from: l.from, to: l.to, progress: l.progress };
}

/** A place with "home" resolved to where the pirate actually is. */
type Resolved = Exclude<Place, { kind: "home" }>;

/** What the sheet's head says for the place: one header for the card, folded or not. */
interface Head {
  title: string;
  /** Where the pirate is, in a few words. */
  subtitle: string;
  /** The one thing to do next, if there is an obvious one. */
  next: string | null;
  back: { onClick(): void; testId: string } | null;
  extra?: ReactNode;
}

/**
 * The one experience (ADR 0018, ADR 0020): the world is the view and takes the screen. A thin bar
 * on top, a card for the place folded to a strip at the bottom (or the side) until it is wanted,
 * the station layer over it all when a board is open, one menu. Moving between places is a camera
 * move in the world and a different card; nothing reloads. The strip always says where the pirate
 * is and what to do next, so nobody has to guess.
 */
export function Shell() {
  const { pirate, socketStatus } = usePirate();
  const { ship, notices, listBoard, board, boardShip, takeStation, error } = useShip();
  const { place: rawPlace, go } = usePlace();
  const { toast } = useToasts();
  const wide = useMediaQuery("(min-width: 900px)");
  const [menuOpen, setMenuOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [showMarks, setShowMarks] = useShowMarks();
  const [shipPick, setShipPick] = useState<string | null>(null);
  const [helmPick, setHelmPick] = useState<string | null>(null);
  const online = socketStatus === "open";
  const me = pirate?.id ?? "";
  const ashoreAt = pirate?.islandId ?? content.world.startIslandId;
  const here = ship ? (ship.location.kind === "docked" ? ship.location.islandId : null) : ashoreAt;
  const aboard = ship !== null;
  const myStation = ship?.crew.find((c) => c.pirateId === me)?.station ?? null;
  const captain = ship?.captainId === me;
  const captainName = ship?.crew.find((c) => c.captain)?.name ?? null;
  const fight = ship?.location.kind === "at-sea" ? ship.location.battle : null;

  const place = useMemo<Resolved>(() => {
    if (rawPlace.kind !== "home") return rawPlace;
    return ship ? { kind: "deck" } : { kind: "island", id: ashoreAt, room: "none" };
  }, [rawPlace, ship, ashoreAt]);

  // ---- keep the place honest against the ship: boarding moves in on the deck, going ashore moves out.
  const wasAboard = useRef(false);
  useEffect(() => {
    if (aboard && !wasAboard.current) {
      if (place.kind !== "station" && place.kind !== "helm") go({ kind: "home" });
      setSheetOpen(false);
      sfx.start();
      toast(t("toast.boarded", { ship: ship!.name }), "good");
    }
    if (!aboard && (place.kind === "deck" || place.kind === "station" || place.kind === "helm")) {
      go({ kind: "home" });
      setSheetOpen(false);
      if (wasAboard.current) toast(t("toast.ashore", { island: islandName(ashoreAt) }));
    }
    wasAboard.current = aboard;
  }, [aboard, place.kind, go, toast, ship, ashoreAt]);

  // A deep link to a station takes it; a station that is not ours anymore closes.
  useEffect(() => {
    if (place.kind !== "station" || !ship || !online) return;
    const holder = ship.crew.find((c) => c.station === place.station);
    if (holder && holder.pirateId !== me) {
      go({ kind: "home" });
      return;
    }
    if (!holder && myStation !== place.station) takeStation(place.station);
  }, [place, ship, online, me, myStation, takeStation, go]);

  // A helm place needs a docked ship and the wheel.
  useEffect(() => {
    if (place.kind === "helm" && ship && (ship.location.kind !== "docked" || !captain)) go({ kind: "home" });
  }, [place.kind, ship, captain, go]);

  // The captain's fight opens the battle board over the deck; it closes a beat after the fight ends,
  // so the outcome can be read. Anyone else on the battle place is sent back to the deck.
  const wasFighting = useRef(false);
  useEffect(() => {
    if (fight && captain && !wasFighting.current) go({ kind: "battle" });
    wasFighting.current = fight !== null && captain;
  }, [fight, captain, go]);
  useEffect(() => {
    if (place.kind !== "battle") return;
    if (!ship || !captain) {
      go({ kind: "home" });
      return;
    }
    if (fight) return;
    const id = window.setTimeout(() => go({ kind: "home" }), 6000);
    return () => window.clearTimeout(id);
  }, [place.kind, ship, captain, fight, go]);

  // Rooms and the helm want their card open; arriving anywhere else folds it so the view is clear,
  // except when the pirate stepped back a level in the card, which stays open where they came from.
  const placeKey = place.kind === "island" ? `${place.kind}:${place.id}:${place.room}` : place.kind === "station" ? `station:${place.station}` : place.kind;
  const openOnArrive = useRef(false);
  useEffect(() => {
    setSheetOpen(openOnArrive.current || (place.kind === "island" && place.room !== "none") || place.kind === "helm");
    openOnArrive.current = false;
  }, [placeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Go somewhere as a step back in the card: the card stays open there. */
  const goBack = useCallback(
    (next: Place) => {
      openOnArrive.current = true;
      go(next);
    },
    [go],
  );

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
        if (place.kind === "station") go({ kind: "home" });
      } else if (e.type === "wheel") {
        toast(e.pirateId === me ? t("toast.wheel_yours") : (describeEvent(e) as string));
      } else if (e.type === "engaged") {
        sfx.alarm();
        toast(describeEvent(e) as string, "warn", 5000);
      } else if (e.type === "battle_ended") {
        const won = e.outcome === "boarded" || e.outcome === "crippled";
        const lost = e.outcome === "boarded_by" || e.outcome === "crippled_by";
        if (won) sfx.streak(8);
        toast(
          won ? t("toast.battle_won", { brigand: tierName(e.tierId), coins: e.booty }) : lost ? t("toast.battle_lost", { brigand: tierName(e.tierId) }) : t("toast.battle_broke_off", { brigand: tierName(e.tierId) }),
          won ? "good" : lost ? "warn" : "plain",
          7000,
        );
      } else if (e.type === "evaded" || e.type === "sailed" || e.type === "left" || (e.type === "boarded" && e.pirateId !== me)) {
        toast(describeEvent(e) as string);
      }
    }
  }, [notices, toast, me, place.kind, go]);

  useEffect(() => {
    if (error && !sheetOpen) toast(t(`error.${error}`), "warn");
  }, [error, sheetOpen, toast]);

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
    const docked = ship.location.kind === "docked";
    return {
      shipId: ship.shipId,
      stations: stations.map((st) => {
        const holder = ship.crew.find((c) => c.station === st) ?? null;
        return { station: st, label: stationName(st), holder: holder ? (holder.pirateId === me ? t("ship.you") : holder.name) : null, mine: holder?.pirateId === me };
      }),
      crew: ship.crew.map((c) => ({ pirateId: c.pirateId, station: c.station, mine: c.pirateId === me, captain: c.captain })),
      wheel: { label: captain ? (docked ? t("ship.wheel_sail") : t("ship.wheel_at_sea")) : t("ship.wheel_spot"), who: captain ? null : captainName, primary: captain && docked },
    };
  }, [ship, me, captain, captainName]);

  const reachable = useMemo(() => (place.kind === "helm" && ship?.location.kind === "docked" ? content.world.routes.filter((r) => r.from === (ship.location as { islandId: string }).islandId).map((r) => r.to) : []), [place.kind, ship]);

  const insets = useMemo<Insets>(() => {
    if (wide) return { top: 0.08, bottom: 0.03, left: 0.02, right: sheetOpen ? 0.38 : 0.06 };
    if (!sheetOpen) return { top: 0.1, bottom: place.kind === "deck" ? 0.19 : 0.14, left: 0.02, right: 0.02 };
    return { top: 0.1, bottom: 0.52, left: 0.02, right: 0.02 };
  }, [wide, sheetOpen, place.kind]);

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
      dimmed: place.kind === "station" || place.kind === "battle" || menuOpen,
      boardLabel: t("ship.board_spot"),
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
        setSheetOpen(true);
        return;
      }
      setShipPick(null);
      setSheetOpen(false);
      go(id === ashoreAt && !aboard ? { kind: "home" } : { kind: "island", id, room: "none" });
    },
    [place, reachable, go, ashoreAt, aboard],
  );
  const onShip = useCallback(
    (id: string) => {
      sfx.tick(false);
      if (ship?.shipId === id) {
        go({ kind: "home" });
        return;
      }
      if (place.kind === "chart") {
        setShipPick(id);
        go({ kind: "chart", pick: null });
        setSheetOpen(true);
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
      setSheetOpen(true);
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
  const onHelm = useCallback(() => {
    setHelmPick(null);
    go({ kind: "helm" });
  }, [go]);
  const onBattle = useCallback(() => go({ kind: "battle" }), [go]);
  const onWheel = useCallback(() => {
    if (!ship) return;
    sfx.tick(false);
    if (captain && ship.location.kind === "docked") onHelm();
    else setSheetOpen(true);
  }, [ship, captain, onHelm]);
  const events = useMemo(() => ({ onIsland, onShip, onBuilding, onStation, onWheel }), [onIsland, onShip, onBuilding, onStation, onWheel]);

  const onMap = useCallback(() => {
    sfx.tick(false);
    setShipPick(null);
    setSheetOpen(false);
    go(place.kind === "chart" ? { kind: "home" } : { kind: "chart", pick: null });
  }, [place.kind, go]);

  // ---- what to do next, ashore: the strip says it so the first minute needs no guessing.
  const ashoreNext = useMemo(() => {
    const mine = pirate?.ships ?? [];
    const hereShip = mine.find((s) => s.islandId === ashoreAt);
    if (hereShip) return t("next.ashore_board", { ship: hereShip.name });
    const away = mine[0];
    if (away) return t("next.ashore_ship_away", { ship: away.name, island: islandName(away.islandId) });
    return t("next.ashore_no_ship");
  }, [pirate, ashoreAt]);

  // ---- the card for the place, and the one header it folds to
  let card: ReactNode = null;
  let head: Head;
  if (ship && (place.kind === "deck" || place.kind === "station" || place.kind === "battle")) {
    const docked = ship.location.kind === "docked";
    card = <DeckCard ship={ship} me={me} onStation={onStation} onHelm={onHelm} onBattle={onBattle} />;
    head = {
      title: ship.name,
      subtitle: docked
        ? t("ship.docked_at", { island: islandName((ship.location as { islandId: string }).islandId) })
        : fight
          ? t("ship.in_battle", { brigand: tierName(fight.tierId) })
          : t("ship.bound_for", { island: islandName((ship.location as { to: string }).to), percent: Math.round((ship.location as { progress: number }).progress / 10) }),
      next: docked
        ? captain
          ? t("next.docked_captain")
          : t("next.docked_crew", { captain: captainName ?? "" })
        : fight
          ? captain
            ? t("next.battle_captain")
            : t("next.battle_crew")
          : myStation
            ? t("next.at_sea_at_station", { station: stationName(myStation) })
            : t("next.at_sea_no_station"),
      back: null,
      extra: <ShipHud ship={ship} mini />,
    };
  } else if (ship && place.kind === "helm") {
    card = <HelmCard ship={ship} pick={helmPick} onPick={setHelmPick} onCancel={() => go({ kind: "home" })} />;
    head = { title: t("ship.set_sail"), subtitle: ship.name, next: t("next.helm"), back: { onClick: () => goBack({ kind: "home" }), testId: "helm-back" } };
  } else if (place.kind === "island") {
    const isHere = place.id === (here ?? ashoreAt);
    const roomKey = place.room === "dock" ? "island.dock" : place.room === "tavern" ? "island.tavern" : place.room === "notice" ? "island.notice_board" : null;
    card = <IslandCard id={place.id} room={place.room} here={here ?? ashoreAt} onRoom={(room) => go({ kind: "island", id: place.id, room })} />;
    head = roomKey
      ? {
          title: t(roomKey),
          subtitle: islandName(place.id),
          next: t(`${roomKey}_blurb`),
          back: { onClick: () => goBack({ kind: "island", id: place.id, room: "none" }), testId: "island-back" },
        }
      : {
          title: islandName(place.id),
          subtitle: isHere ? t("world.you_are_here") : t("world.ashore_at", { island: islandName(ashoreAt) }),
          next: isHere ? ashoreNext : t("next.far_island", { island: islandName(ashoreAt) }),
          back: null,
        };
  } else {
    card = (
      <ChartCard
        here={here ?? ashoreAt}
        pick={place.kind === "chart" ? place.pick : null}
        shipPick={shipPick}
        aboard={aboard}
        onIsland={(id) => {
          setSheetOpen(false);
          go({ kind: "island", id, room: "none" });
        }}
        onBackAboard={() => go({ kind: "home" })}
        onClearPick={() => (setShipPick(null), go({ kind: "chart", pick: null }))}
      />
    );
    head = {
      title: t("world.chart_title"),
      subtitle: aboard ? t("world.aboard", { ship: ship?.name ?? "" }) : t("world.ashore_at", { island: islandName(ashoreAt) }),
      next: aboard ? t("next.chart_aboard") : t("next.chart"),
      back: null,
    };
  }

  const stationOpen = ship && place.kind === "station" ? place.station : null;
  const battleOpen = Boolean(ship && place.kind === "battle");

  return (
    <div className={`shell ${wide ? "shell-wide" : "shell-tall"} place-${place.kind} ${stationOpen || battleOpen ? "has-station" : ""} ${sheetOpen ? "sheet-open" : "sheet-folded"}`} data-testid="shell" data-place={place.kind}>
      <World input={input} events={events} />
      <TopBar onMenu={() => setMenuOpen(true)} onMap={onMap} onChart={place.kind === "chart"} />
      {ship && !stationOpen && !battleOpen && <HailBanner ship={ship} me={me} />}
      <aside className={`sheet ${sheetOpen ? "is-open" : ""}`} data-testid="sheet" data-open={sheetOpen ? "1" : "0"}>
        <div className="sheet-head">
          {head.back && (
            <button className="icon-btn sheet-back" onClick={head.back.onClick} aria-label={t("app.back")} data-testid={head.back.testId}>
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          <button className="sheet-handle" onClick={() => setSheetOpen((o) => !o)} aria-expanded={sheetOpen} data-testid="sheet-toggle">
            <span className="strip-text">
              <b>{head.title}</b>
              <small className="muted">{head.subtitle}</small>
            </span>
            {head.extra}
            <svg className="chev" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 14l6-6 6 6" />
            </svg>
          </button>
          {head.next && (
            <p className="next-step" data-testid="next-step">
              {head.next}
            </p>
          )}
        </div>
        <div className="sheet-body">{card}</div>
      </aside>
      {stationOpen && ship && <StationView ship={ship} me={me} station={stationOpen} showMarks={showMarks} onBack={() => go({ kind: "home" })} onHelm={onHelm} />}
      {battleOpen && ship && <BattleView ship={ship} showMarks={showMarks} onBack={() => go({ kind: "home" })} />}
      {menuOpen && <Menu showMarks={showMarks} onShowMarks={setShowMarks} onClose={() => setMenuOpen(false)} />}
      <Toasts />
    </div>
  );
}
