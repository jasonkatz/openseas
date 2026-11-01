import { useCallback, useEffect, useMemo, useState } from "react";
import type { BoardShip } from "@openseas/protocol";
import { content, t } from "../content.js";
import { Overworld, chartLocation, type ChartShip } from "../overworld/Overworld.jsx";
import { Link, useRoute } from "../router.jsx";
import { usePirate } from "../state/PirateProvider.jsx";
import { useShip } from "../state/ShipProvider.jsx";

const islandName = (id: string): string => t(content.world.islands.find((i) => i.id === id)?.nameKey ?? id);
const className = (id: string): string => t(content.world.shipClasses.find((c) => c.id === id)?.nameKey ?? id);
const REFRESH_MS = 4000;

type Pick = { kind: "island"; id: string } | { kind: "ship"; id: string } | null;

/**
 * The chart: every island, every ship with someone aboard, and your own ships, on an isometric
 * sea. Tap an island to see who is recruiting there; tap a ship to board it.
 */
export function SeaPage() {
  const { pirate, socketStatus } = usePirate();
  const { ship, board, listBoard, boardShip, error } = useShip();
  const { navigate } = useRoute();
  const online = socketStatus === "open";
  const [pick, setPick] = useState<Pick>(null);

  useEffect(() => {
    if (!online) return;
    listBoard();
    const id = window.setInterval(listBoard, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [online, listBoard]);

  useEffect(() => {
    if (ship) navigate("/ship");
  }, [ship, navigate]);

  const here = pirate?.islandId ?? content.world.startIslandId;
  const others: BoardShip[] = board?.ships ?? [];
  const own = useMemo(() => pirate?.ships.filter((s) => !others.some((b) => b.shipId === s.id)) ?? [], [pirate, others]);
  const ships = useMemo<ChartShip[]>(
    () => [
      ...own.map((s) => ({ id: s.id, name: s.name, kind: "yours" as const, location: { kind: "docked" as const, islandId: s.islandId } })),
      ...others.map((s) => ({ id: s.shipId, name: s.name, kind: s.yours ? ("yours" as const) : ("other" as const), location: chartLocation(s.location) })),
    ],
    [own, others],
  );

  const onIsland = useCallback((id: string) => setPick({ kind: "island", id }), []);
  const onShip = useCallback((id: string) => setPick({ kind: "ship", id }), []);

  const pickedShip = pick?.kind === "ship" ? ships.find((s) => s.id === pick.id) ?? null : null;
  const pickedIsland = pick?.kind === "island" ? pick.id : pickedShip?.location.kind === "docked" ? null : null;
  const pickedBoard = pickedShip ? others.find((b) => b.shipId === pickedShip.id) ?? null : null;

  const islandShips = pickedIsland ? ships.filter((s) => s.location.kind === "docked" && s.location.islandId === pickedIsland) : [];
  const routeHere = pickedIsland && pickedIsland !== here ? content.world.routes.find((r) => r.from === here && r.to === pickedIsland) ?? null : null;

  const canBoard = (s: ChartShip): boolean => {
    if (!online) return false;
    const b = others.find((x) => x.shipId === s.id);
    if (!b) return s.location.kind === "docked" && s.location.islandId === here;
    if (b.crew >= b.maxCrew) return false;
    if (b.inviteOnly && !b.yours) return false;
    return b.location.kind === "at-sea" || b.location.islandId === here;
  };

  return (
    <main className="page sea">
      <header className="puzzle-bar">
        <Link to="/" className="icon-btn" aria-label={t("app.back")}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
        <h1 className="puzzle-title">{t("sea.title")}</h1>
        <Link to="/board" className="btn btn-ghost btn-small">
          {t("sea.list_link")}
        </Link>
      </header>

      <Overworld ships={ships} here={here} selected={pickedIsland} selectedShip={pickedShip?.id ?? null} onIsland={onIsland} onShip={onShip} smoothMs={content.world.ship.turnSeconds * 1000} />

      <section className="card card-parchment sea-panel" data-testid="sea-panel" aria-live="polite">
        {!online && <p className="note">{t("app.offline")}</p>}
        {error && <p className="error">{t(`error.${error}`)}</p>}
        {!pick && (
          <>
            <p className="eyebrow">{t("home.ashore_at", { island: islandName(here) })}</p>
            <p className="muted">{t("sea.tap_hint")}</p>
          </>
        )}
        {pickedIsland && (
          <>
            <p className="eyebrow">{pickedIsland === here ? t("sea.you_are_here") : routeHere ? t("sea.island_route", { minutes: Math.round(routeHere.durationSeconds / 60), island: islandName(here) }) : t("sea.no_route")}</p>
            <h2>{islandName(pickedIsland)}</h2>
            {islandShips.length === 0 ? (
              <p className="muted">{t("sea.none_here")}</p>
            ) : (
              <ul className="ships" data-testid="sea-island-ships">
                {islandShips.map((s) => (
                  <ShipRow key={s.id} s={s} b={others.find((x) => x.shipId === s.id) ?? null} canBoard={canBoard(s)} onBoard={() => boardShip(s.id)} />
                ))}
              </ul>
            )}
          </>
        )}
        {pickedShip && (
          <>
            <p className="eyebrow">
              {pickedShip.location.kind === "docked"
                ? t("ship.docked_at", { island: islandName(pickedShip.location.islandId) })
                : t("ship.board_bound_for", { island: islandName(pickedShip.location.to), percent: Math.round(pickedShip.location.progress / 10) })}
            </p>
            <ul className="ships">
              <ShipRow s={pickedShip} b={pickedBoard} canBoard={canBoard(pickedShip)} onBoard={() => boardShip(pickedShip.id)} />
            </ul>
          </>
        )}
      </section>
    </main>
  );
}

function ShipRow({ s, b, canBoard, onBoard }: { s: ChartShip; b: BoardShip | null; canBoard: boolean; onBoard(): void }) {
  return (
    <li>
      <span>
        <b>{s.name}</b> <small className="muted">{className(b?.classId ?? "sloop")}</small>
        {b && (
          <>
            <br />
            <small>
              {t("ship.board_captain", { name: b.captainName })} · {t("ship.board_crew", { count: b.crew, max: b.maxCrew })}
              {b.inviteOnly && <> · {t("ship.board_locked")}</>}
            </small>
          </>
        )}
        {!b && (
          <>
            <br />
            <small>{t("sea.your_ship")}</small>
          </>
        )}
      </span>
      <button className="btn btn-brass" onClick={onBoard} disabled={!canBoard} data-testid={`sea-board-${s.id}`}>
        {t("ship.board_button")}
      </button>
    </li>
  );
}
