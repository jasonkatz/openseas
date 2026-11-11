import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PirateLookWire, ShipLocation, StationWire } from "@openseas/protocol";
import { LINK_FROM_KEY, content, sfx, t, usePirate } from "@openseas/boards";
import { CrewDialog } from "../crew/CrewDialog.jsx";
import { ProfileCard } from "../crew/ProfileCard.jsx";
import { PirateSheet } from "../pirate/PirateSheet.jsx";
import { jacketHex, lookFor } from "../pirate/look.js";
import { ChartCard } from "../chart/ChartCard.jsx";
import { OutpostCard } from "../outpost/OutpostCard.jsx";
import { outpostName, stationName, tierName } from "../names.js";
import { BattleView } from "../ship/battle/BattleView.jsx";
import { useBattleApi } from "../ship/battle/useBattle.js";
import { MeleeView } from "../ship/melee/MeleeView.jsx";
import { useMeleeApi } from "../ship/melee/useMelee.js";
import { DeckCard, HelmCard, describeEvent } from "../ship/DeckCard.jsx";
import { ShipHud } from "../ship/ShipHud.jsx";
import { StationView } from "../ship/StationView.jsx";
import { useCrew } from "../state/CrewProvider.jsx";
import { useSheet } from "../state/SheetProvider.jsx";
import { useShip } from "../state/ShipProvider.jsx";
import { useSocial } from "../state/SocialProvider.jsx";
import { nextPlace, placeFacts, type PlaceFacts } from "../state/nextPlace.js";
import { usePlace, type Place } from "../state/place.jsx";
import { useMediaQuery, useShowMarks } from "../state/settings.js";
import { useToasts } from "../state/toasts.jsx";
import { World, type Deck, type DeckCrew, type Focus, type Insets, type OutpostWalk, type WorldInput, type WorldShip, type WorldShipLocation } from "../world/World.jsx";
import { HailBanner } from "./HailBanner.jsx";
import { Menu } from "./Menu.jsx";
import { Toasts } from "./Toasts.jsx";
import { TopBar } from "./TopBar.jsx";

const BOARD_REFRESH_MS = 4000;
/** Set once the guest has been asked to keep their pirate after a voyage (ADR 0007). */
const NUDGED_KEY = "openseas.link-nudged";

function once(key: string): boolean {
  try {
    if (window.localStorage.getItem(key)) return false;
    window.localStorage.setItem(key, "1");
    return true;
  } catch {
    return false;
  }
}

/** A look as the world's figures take it: the jacket as a color, the headgear by id. */
function figureLook(look: PirateLookWire): DeckCrew["look"] {
  return { jacket: parseInt(jacketHex(look.jacket).slice(1), 16), headgear: look.headgear };
}

function worldLocation(l: ShipLocation): WorldShipLocation {
  return l.kind === "docked" ? { kind: "docked", outpostId: l.outpostId } : { kind: "in-flight", from: l.from, to: l.to, progress: l.progress };
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
  const { pirate, socketStatus, providers } = usePirate();
  const { ship, notices, listBoard, board, boardShip, takeStation, leave, left, error } = useShip();
  const { presence, walks, walkTo } = useSocial();
  const crewApi = useCrew();
  const { tab: sheetTab } = useSheet();
  const { place: rawPlace, go } = usePlace();
  const battle = useBattleApi();
  const melee = useMeleeApi();
  const { toast } = useToasts();
  const wide = useMediaQuery("(min-width: 900px)");
  const [menuOpen, setMenuOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [showMarks, setShowMarks] = useShowMarks();
  const [shipPick, setShipPick] = useState<string | null>(null);
  const [helmPick, setHelmPick] = useState<string | null>(null);
  const online = socketStatus === "open";
  const me = pirate?.id ?? "";
  const onOutpostAt = pirate?.outpostId ?? content.world.startOutpostId;
  const here = ship ? (ship.location.kind === "docked" ? ship.location.outpostId : null) : onOutpostAt;
  const aboard = ship !== null;
  const myStation = ship?.crew.find((c) => c.pirateId === me)?.station ?? null;
  const captain = ship?.captainId === me;
  const captainName = ship?.crew.find((c) => c.captain)?.name ?? null;
  const fight = ship?.location.kind === "in-flight" ? ship.location.battle : null;
  const atAirlock = ship?.melee ?? null;

  const place = useMemo<Resolved>(() => {
    if (rawPlace.kind !== "home") return rawPlace;
    return ship ? { kind: "deck" } : { kind: "outpost", id: onOutpostAt, room: "none" };
  }, [rawPlace, ship, onOutpostAt]);

  // ---- back from a provider: say what happened to the pirate, then tidy the address.
  const authChecked = useRef(false);
  useEffect(() => {
    if (authChecked.current || !pirate) return;
    authChecked.current = true;
    const q = new URLSearchParams(window.location.search);
    const signedIn = q.get("signed_in");
    const failed = q.get("auth_error") ?? (q.get("error") ? "" : null);
    if (signedIn === null && failed === null) return;
    let from: string | null = null;
    try {
      from = window.localStorage.getItem(LINK_FROM_KEY);
      window.localStorage.removeItem(LINK_FROM_KEY);
    } catch {
      /* nothing remembered */
    }
    const provider = t(`auth.provider_${signedIn ?? failed ?? ""}`);
    if (failed !== null) toast(t("auth.link_failed"), "warn", 7000);
    else if (pirate.guest) toast(t("auth.link_failed"), "warn", 7000);
    else if (from && from !== pirate.id) {
      sfx.streak(5);
      toast(t("auth.welcome_back", { name: pirate.name, provider }), "good", 7000);
    } else {
      sfx.streak(5);
      toast(t("auth.linked", { provider }), "good", 7000);
    }
    window.history.replaceState(null, "", window.location.pathname);
  }, [pirate, toast]);

  // ---- keep the place honest against the ship. Every change is one look: `nextPlace` says where the
  // pirate should be from the facts now and at the last look, and this performs it. A timed go is
  // dropped by the next look, whatever it says.
  /** Where the captain came to the helm from: leaving it goes back there, the deck otherwise. */
  const helmFrom = useRef<StationWire | null>(null);
  const leaveHelm = useCallback(() => {
    const from = helmFrom.current;
    helmFrom.current = null;
    go(from ? { kind: "station", station: from } : { kind: "home" });
  }, [go]);
  const facts = useMemo(() => placeFacts(ship, me, online, battle.phase, melee.phase), [ship, me, online, battle.phase, melee.phase]);
  const lastLook = useRef<PlaceFacts | null>(null);
  // `takeStation` is rebuilt with everything the ship's context holds, the notice board's list
  // included; the look reads the latest without running again for it, so no beat restarts on a refresh.
  const take = useRef(takeStation);
  take.current = takeStation;
  useEffect(() => {
    const step = nextPlace(place, lastLook.current, facts, helmFrom.current);
    lastLook.current = facts;
    if (step.news === "boarded") {
      setSheetOpen(false);
      sfx.start();
      toast(t("toast.boarded", { ship: ship!.name }), "good");
    } else if (step.news === "on-outpost") {
      setSheetOpen(false);
      toast(t("toast.on_outpost", { outpost: outpostName(onOutpostAt) }));
    }
    if (step.take) take.current(step.take);
    const to = step.go;
    if (!to) return;
    if (to.why === "helm-left") helmFrom.current = null;
    if (to.afterMs === 0) {
      go(to.place);
      return;
    }
    const id = window.setTimeout(() => go(to.place), to.afterMs);
    return () => window.clearTimeout(id);
  }, [place, facts, ship, onOutpostAt, go, toast]);

  // Rooms and the helm want their card open; arriving anywhere else folds it so the view is clear,
  // except when the pirate stepped back a level in the card, which stays open where they came from.
  const placeKey = place.kind === "outpost" ? `${place.kind}:${place.id}:${place.room}` : place.kind === "station" ? `station:${place.station}` : place.kind;
  const openOnArrive = useRef(false);
  useEffect(() => {
    setSheetOpen(openOnArrive.current || (place.kind === "outpost" && place.room !== "none") || place.kind === "helm");
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
        // At a station the board's own bar carries the hail; a toast there only gets in the way.
        if (place.kind !== "station") toast(describeEvent(e) as string, "warn", 6000);
      } else if (e.type === "arrived") {
        sfx.streak(5);
        toast(t("ship.arrived_blurb", { outpost: outpostName(e.outpostId) }), "good", 6000);
        if (place.kind === "station") go({ kind: "home" });
        // A guest's first voyage is worth keeping: offer to link an account, once (ADR 0007).
        if (pirate?.guest && providers.length > 0 && once(NUDGED_KEY)) {
          window.setTimeout(() => toast(t("auth.nudge"), "plain", 12000, { label: t("auth.nudge_action"), run: () => setMenuOpen(true), testId: "toast-link" }), 1500);
        }
      } else if (e.type === "helm") {
        toast(e.pirateId === me ? t("toast.helm_yours") : (describeEvent(e) as string));
      } else if (e.type === "engaged") {
        sfx.alarm();
        toast(describeEvent(e) as string, "warn", 5000);
      } else if (e.type === "boarding") {
        sfx.alarm();
        toast(t("toast.boarding"), "warn", 6000);
      } else if (e.type === "battle_ended") {
        const won = e.outcome === "boarded" || e.outcome === "crippled";
        const lost = e.outcome === "boarded_by" || e.outcome === "crippled_by";
        if (won) sfx.streak(8);
        toast(
          won ? t("toast.battle_won", { raider: tierName(e.tierId), credits: e.plunder }) : lost ? t("toast.battle_lost", { raider: tierName(e.tierId) }) : t("toast.battle_broke_off", { raider: tierName(e.tierId) }),
          won ? "good" : lost ? "warn" : "plain",
          7000,
        );
      } else if (e.type === "evaded" || e.type === "launched" || e.type === "left" || (e.type === "boarded" && e.pirateId !== me)) {
        toast(describeEvent(e) as string);
      }
    }
  }, [notices, toast, me, place.kind, go, pirate, providers]);

  useEffect(() => {
    if (error && !sheetOpen) toast(t(`error.${error}`), "warn");
  }, [error, sheetOpen, toast]);

  // ---- the world's input
  const ships = useMemo<WorldShip[]>(() => {
    const out: WorldShip[] = [];
    const seen = new Set<string>();
    if (ship) {
      out.push({ id: ship.shipId, name: ship.name, kind: "aboard", location: worldLocation(ship.location), colors: ship.colors?.flag ?? null });
      seen.add(ship.shipId);
    }
    for (const s of board?.ships ?? []) {
      if (seen.has(s.shipId)) continue;
      seen.add(s.shipId);
      out.push({ id: s.shipId, name: s.name, kind: s.yours ? "yours" : "other", location: worldLocation(s.location), colors: s.colors?.flag ?? null, crewmate: s.crewmate });
    }
    // The pirate's own ships fly their crew's colors, wherever they lie.
    for (const s of pirate?.ships ?? []) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      out.push({ id: s.id, name: s.name, kind: "yours", location: { kind: "docked", outpostId: s.outpostId }, colors: pirate?.crew?.flag ?? null });
    }
    return out;
  }, [ship, board, pirate]);

  const focus = useMemo<Focus>(() => {
    if ((place.kind === "deck" || place.kind === "station") && ship) return { kind: "ship", id: ship.shipId };
    if (place.kind === "outpost") return { kind: "outpost", id: place.id };
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
        return {
          station: st,
          label: stationName(st),
          holder: holder ? (holder.pirateId === me ? t("ship.you") : holder.bot ? t("ship.bot_who", { name: holder.name }) : holder.name) : null,
          mine: holder?.pirateId === me,
          bot: Boolean(holder?.bot),
        };
      }),
      crew: ship.crew.map((c) => ({
        pirateId: c.pirateId,
        name: c.name,
        station: c.station,
        mine: c.pirateId === me,
        captain: c.captain,
        bot: c.bot,
        at: c.pirateId === me ? null : (walks.ship[c.pirateId] ?? null),
        look: c.bot ? null : figureLook(lookFor(c.pirateId, c.look)),
      })),
      helm: { label: captain ? (docked ? t("ship.helm_launch") : t("ship.helm_in_flight")) : t("ship.helm_spot"), who: captain ? null : captainName, primary: captain && docked },
      airlock: docked ? t("ship.disembark") : null,
    };
  }, [ship, me, captain, captainName, walks.ship]);

  // On the outpost, the pirate walks their outpost among everyone else on it (ADR 0032).
  const walk = useMemo<OutpostWalk | null>(() => {
    if (aboard || !pirate) return null;
    const others = presence?.outpostId === onOutpostAt ? presence.pirates.filter((p) => p.pirateId !== me).map((p) => ({ id: p.pirateId, name: p.name, at: walks.outpost[p.pirateId] ?? null, look: figureLook(lookFor(p.pirateId, p.look)) })) : [];
    // An open room is its building: the pirate is inside it.
    const room = place.kind === "outpost" && place.id === onOutpostAt ? place.room : "none";
    const inside = room === "dock" ? "dock" : room === "cantina" ? "cantina" : room === "notice" ? "notice-board" : null;
    return { outpostId: onOutpostAt, me, meLook: figureLook(lookFor(me, pirate.look)), others, arriveFrom: left?.shipId ?? null, inside };
  }, [aboard, pirate, presence, onOutpostAt, me, walks.outpost, left, place]);

  const reachable = useMemo(() => (place.kind === "helm" && ship?.location.kind === "docked" ? content.world.lanes.filter((r) => r.from === (ship.location as { outpostId: string }).outpostId).map((r) => r.to) : []), [place.kind, ship]);

  const insets = useMemo<Insets>(() => {
    if (wide) return { top: 0.08, bottom: 0.03, left: 0.02, right: sheetOpen ? 0.38 : 0.06 };
    if (!sheetOpen) return { top: 0.1, bottom: place.kind === "deck" ? 0.19 : 0.14, left: 0.02, right: 0.02 };
    return { top: 0.1, bottom: 0.52, left: 0.02, right: 0.02 };
  }, [wide, sheetOpen, place.kind]);

  const input = useMemo<WorldInput>(
    () => ({
      outposts: content.world.outposts.map((i) => ({
        id: i.id,
        name: t(i.nameKey),
        x: i.x,
        y: i.y,
        landmark: i.landmark,
        buildings: i.buildings.map((b) => ({ kind: b, label: t(b === "dock" ? "outpost.dock" : b === "cantina" ? "outpost.cantina" : "outpost.notice_board") })),
      })),
      lanes: content.world.lanes.map((r) => ({ id: r.id, from: r.from, to: r.to })),
      ships,
      here: aboard ? null : onOutpostAt,
      focus,
      selected: place.kind === "chart" ? place.pick : place.kind === "helm" ? helmPick : null,
      reachable,
      selectedShip: place.kind === "chart" ? shipPick : null,
      smoothMs: content.world.ship.turnSeconds * 1000,
      deck,
      insets,
      dimmed: place.kind === "station" || place.kind === "battle" || place.kind === "melee" || menuOpen || crewApi.panel !== null || sheetTab !== null,
      boardLabel: t("ship.board_spot"),
      walk,
    }),
    [ships, aboard, onOutpostAt, focus, place, helmPick, reachable, shipPick, deck, insets, menuOpen, crewApi.panel, sheetTab, walk],
  );

  // ---- taps in the world
  const onOutpost = useCallback(
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
      go(id === onOutpostAt && !aboard ? { kind: "home" } : { kind: "outpost", id, room: "none" });
    },
    [place, reachable, go, onOutpostAt, aboard],
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
      } else if (place.kind === "outpost" && !aboard) boardShip(id);
    },
    [ship, place.kind, aboard, go, boardShip],
  );
  const onBuilding = useCallback(
    (outpostId: string, b: "dock" | "cantina" | "notice-board") => {
      sfx.tick(false);
      if (outpostId !== here) {
        toast(t("world.far_away", { outpost: outpostName(onOutpostAt) }));
        return;
      }
      go({ kind: "outpost", id: outpostId, room: b === "dock" ? "dock" : b === "cantina" ? "cantina" : "notice" });
      setSheetOpen(true);
    },
    [here, onOutpostAt, go, toast],
  );
  const onStation = useCallback(
    (st: StationWire) => {
      if (!ship) return;
      const holder = ship.crew.find((c) => c.station === st);
      if (holder && holder.pirateId !== me && !holder.bot) {
        toast(t("error.station_taken"), "warn");
        return;
      }
      sfx.swap();
      // An open station, or a bot's: the hand steps aside for a pirate.
      if (!holder || holder.bot) takeStation(st);
      go({ kind: "station", station: st });
    },
    [ship, me, takeStation, go, toast],
  );
  const onHelm = useCallback(() => {
    setHelmPick(null);
    helmFrom.current = place.kind === "station" ? place.station : null;
    go({ kind: "helm" });
  }, [go, place]);
  const onBattle = useCallback(() => go({ kind: "battle" }), [go]);
  const onMelee = useCallback(() => go({ kind: "melee" }), [go]);
  const onHelmSpot = useCallback(() => {
    if (!ship) return;
    sfx.tick(false);
    if (captain && ship.location.kind === "docked") onHelm();
    else setSheetOpen(true);
  }, [ship, captain, onHelm]);
  const onWalk = useCallback((x: number, z: number) => walkTo({ x, z }), [walkTo]);
  const showProfile = crewApi.showProfile;
  const onPirate = useCallback((pirateId: string) => {
    sfx.tick(false);
    showProfile({ pirateId });
  }, [showProfile]);
  const onAirlock = useCallback(() => {
    sfx.tick(false);
    leave();
  }, [leave]);
  // Tapping outside while in a building leaves it: the room closes and the pirate walks out.
  const onOutside = useCallback(() => {
    if (place.kind === "outpost" && place.room !== "none") go({ kind: "outpost", id: place.id, room: "none" });
  }, [place, go]);
  const events = useMemo(
    () => ({ onOutpost, onShip, onBuilding, onStation, onHelmSpot, onWalk, onPirate, onAirlock, onOutside }),
    [onOutpost, onShip, onBuilding, onStation, onHelmSpot, onWalk, onPirate, onAirlock, onOutside],
  );

  const onMap = useCallback(() => {
    sfx.tick(false);
    setShipPick(null);
    setSheetOpen(false);
    go(place.kind === "chart" ? { kind: "home" } : { kind: "chart", pick: null });
  }, [place.kind, go]);

  // ---- what to do next, on the outpost: the strip says it so the first minute needs no guessing.
  const onOutpostNext = useMemo(() => {
    const mine = pirate?.ships ?? [];
    const hereShip = mine.find((s) => s.outpostId === onOutpostAt);
    if (hereShip) return t("next.on_outpost_board", { ship: hereShip.name });
    const away = mine[0];
    if (away) return t("next.on_outpost_ship_away", { ship: away.name, outpost: outpostName(away.outpostId) });
    return t("next.on_outpost_no_ship");
  }, [pirate, onOutpostAt]);

  // ---- the card for the place, and the one header it folds to
  let card: ReactNode = null;
  let head: Head;
  if (ship && (place.kind === "deck" || place.kind === "station" || place.kind === "battle" || place.kind === "melee")) {
    const docked = ship.location.kind === "docked";
    card = <DeckCard ship={ship} me={me} onStation={onStation} onHelm={onHelm} onBattle={onBattle} onMelee={onMelee} />;
    head = {
      title: ship.name,
      subtitle: docked
        ? t("ship.docked_at", { outpost: outpostName((ship.location as { outpostId: string }).outpostId) })
        : atAirlock
          ? t("ship.in_melee", { raider: tierName(atAirlock.tierId) })
          : fight
          ? t("ship.in_battle", { raider: tierName(fight.tierId) })
          : t("ship.bound_for", { outpost: outpostName((ship.location as { to: string }).to), percent: Math.round((ship.location as { progress: number }).progress / 10) }),
      next: docked
        ? captain
          ? t("next.docked_captain")
          : t("next.docked_crew", { captain: captainName ?? "" })
        : atAirlock
          ? t("next.melee")
          : fight
          ? captain
            ? t("next.battle_captain")
            : t("next.battle_crew")
          : myStation
            ? t("next.in_flight_at_station", { station: stationName(myStation) })
            : t("next.in_flight_no_station"),
      back: null,
      extra: <ShipHud ship={ship} mini />,
    };
  } else if (ship && place.kind === "helm") {
    card = <HelmCard ship={ship} pick={helmPick} onPick={setHelmPick} onCancel={leaveHelm} />;
    head = { title: t("ship.launch"), subtitle: ship.name, next: t("next.helm"), back: { onClick: () => (helmFrom.current ? leaveHelm() : goBack({ kind: "home" })), testId: "helm-back" } };
  } else if (place.kind === "outpost") {
    const isHere = place.id === (here ?? onOutpostAt);
    const roomKey = place.room === "dock" ? "outpost.dock" : place.room === "cantina" ? "outpost.cantina" : place.room === "notice" ? "outpost.notice_board" : null;
    card = <OutpostCard id={place.id} room={place.room} here={here ?? onOutpostAt} onRoom={(room) => go({ kind: "outpost", id: place.id, room })} />;
    head = roomKey
      ? {
          title: t(roomKey),
          subtitle: outpostName(place.id),
          next: t(`${roomKey}_blurb`),
          back: { onClick: () => goBack({ kind: "outpost", id: place.id, room: "none" }), testId: "outpost-back" },
        }
      : {
          title: outpostName(place.id),
          subtitle: isHere ? t("world.you_are_here") : t("world.on_outpost_at", { outpost: outpostName(onOutpostAt) }),
          next: isHere ? onOutpostNext : t("next.far_outpost", { outpost: outpostName(onOutpostAt) }),
          back: null,
        };
  } else {
    card = (
      <ChartCard
        here={here ?? onOutpostAt}
        pick={place.kind === "chart" ? place.pick : null}
        shipPick={shipPick}
        aboard={aboard}
        onOutpost={(id) => {
          setSheetOpen(false);
          go({ kind: "outpost", id, room: "none" });
        }}
        onBackAboard={() => go({ kind: "home" })}
        onClearPick={() => (setShipPick(null), go({ kind: "chart", pick: null }))}
      />
    );
    head = {
      title: t("world.chart_title"),
      subtitle: aboard ? t("world.aboard", { ship: ship?.name ?? "" }) : t("world.on_outpost_at", { outpost: outpostName(onOutpostAt) }),
      next: aboard ? t("next.chart_aboard") : t("next.chart"),
      back: null,
    };
  }

  const stationOpen = ship && place.kind === "station" ? place.station : null;
  const battleOpen = Boolean(ship && place.kind === "battle");
  const meleeOpen = Boolean(ship && place.kind === "melee");

  return (
    <div className={`shell ${wide ? "shell-wide" : "shell-tall"} place-${place.kind} ${stationOpen || battleOpen || meleeOpen ? "has-station" : ""} ${sheetOpen ? "sheet-open" : "sheet-folded"}`} data-testid="shell" data-place={place.kind}>
      <World input={input} events={events} />
      <TopBar onMenu={() => setMenuOpen(true)} onMap={onMap} onChart={place.kind === "chart"} />
      {ship && !stationOpen && !battleOpen && !meleeOpen && <HailBanner ship={ship} me={me} />}
      <aside className={`sheet ${sheetOpen ? "is-open" : ""}`} data-testid="sheet" data-open={sheetOpen ? "1" : "0"} data-world-avoid="">
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
      {meleeOpen && ship && <MeleeView ship={ship} showMarks={showMarks} onBack={() => go({ kind: "home" })} />}
      <CrewDialog />
      <PirateSheet />
      {menuOpen && <Menu showMarks={showMarks} onShowMarks={setShowMarks} onClose={() => setMenuOpen(false)} />}
      <ProfileCard />
      <Toasts />
    </div>
  );
}
