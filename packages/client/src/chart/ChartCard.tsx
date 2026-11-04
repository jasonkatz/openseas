import type { BoardShip } from "@openseas/protocol";
import { t, usePirate } from "@openseas/boards";
import { className, islandName, minutes, routeBetween } from "../names.js";
import { useShip } from "../state/ShipProvider.jsx";

export interface ChartCardProps {
  here: string;
  pick: string | null;
  shipPick: string | null;
  aboard: boolean;
  onIsland(id: string): void;
  onBackAboard(): void;
  onClearPick(): void;
}

/** The ocean at a glance: who is out, and what was tapped. The header above says where the pirate stands. */
export function ChartCard({ here, pick, shipPick, aboard, onIsland, onBackAboard, onClearPick }: ChartCardProps) {
  const { pirate, socketStatus } = usePirate();
  const { board, boardShip, error } = useShip();
  const online = socketStatus === "open";
  const atSea = (board?.ships ?? []).filter((s) => s.location.kind === "at-sea");
  const picked: BoardShip | null = shipPick ? (board?.ships.find((s) => s.shipId === shipPick) ?? null) : null;
  const ownPicked = shipPick ? (pirate?.ships.find((s) => s.id === shipPick) ?? null) : null;

  return (
    <section className="card chart-card" data-testid="chart-card">
      {aboard && (
        <button className="btn btn-brass" onClick={onBackAboard} data-testid="back-aboard">
          {t("ship.duty_back")}
        </button>
      )}

      {pick && (
        <div className="pick" data-testid="chart-pick">
          <h3 className="pick-name">{islandName(pick)}</h3>
          <p className="muted small">
            {pick === here ? t("world.you_are_here") : routeBetween(here, pick) ? t("world.sail_from_here", { minutes: minutes(routeBetween(here, pick)!.durationSeconds), island: islandName(here) }) : t("world.no_lane", { island: islandName(here) })}
          </p>
          <div className="row">
            <button className="btn btn-brass" onClick={() => onIsland(pick)} data-testid="visit-island">
              {t("world.look_closer")}
            </button>
            <button className="btn btn-ghost" onClick={onClearPick}>
              {t("app.back")}
            </button>
          </div>
        </div>
      )}

      {(picked || ownPicked) && (
        <ul className="ships" data-testid="chart-ship">
          <li>
            <span>
              <b>{picked?.name ?? ownPicked?.name}</b> <small className="muted">{className(picked?.classId ?? ownPicked?.classId ?? "sloop")}</small>
              <br />
              <small className="muted">
                {picked
                  ? picked.location.kind === "docked"
                    ? t("ship.docked_at", { island: islandName(picked.location.islandId) })
                    : t("notice.bound_for", { island: islandName(picked.location.to), percent: Math.round(picked.location.progress / 10) })
                  : t("dock.ship_elsewhere", { island: islandName(ownPicked!.islandId) })}
              </small>
            </span>
            {!aboard && (
              <button
                className="btn btn-brass btn-small"
                disabled={!online || (picked ? picked.crew >= picked.maxCrew || (picked.inviteOnly && !picked.yours) || (picked.location.kind === "docked" && picked.location.islandId !== here) : ownPicked!.islandId !== here)}
                onClick={() => boardShip(shipPick!)}
                data-testid="chart-board"
              >
                {t("dock.board")}
              </button>
            )}
          </li>
        </ul>
      )}

      {!pick && !shipPick && (
        <p className="muted small" data-testid="at-sea-count">
          {atSea.length === 0 ? t("world.no_ships_at_sea") : atSea.length === 1 ? t("world.ship_at_sea") : t("world.ships_at_sea", { count: atSea.length })}
        </p>
      )}
      {!online && <p className="note">{t("app.offline")}</p>}
      {error && <p className="error">{t(`error.${error}`)}</p>}
    </section>
  );
}
