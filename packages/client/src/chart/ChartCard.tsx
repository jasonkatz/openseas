import type { BoardShip } from "@openseas/protocol";
import { t, usePirate } from "@openseas/boards";
import { Flag } from "../crew/Flag.jsx";
import { className, outpostName, minutes, laneBetween } from "../names.js";
import { useShip } from "../state/ShipProvider.jsx";

export interface ChartCardProps {
  here: string;
  pick: string | null;
  shipPick: string | null;
  aboard: boolean;
  onOutpost(id: string): void;
  onBackAboard(): void;
  onClearPick(): void;
}

/** The star system at a glance: who is out, and what was tapped. The header above says where the pirate stands. */
export function ChartCard({ here, pick, shipPick, aboard, onOutpost, onBackAboard, onClearPick }: ChartCardProps) {
  const { pirate, socketStatus } = usePirate();
  const { board, boardShip, error } = useShip();
  const online = socketStatus === "open";
  const inFlight = (board?.ships ?? []).filter((s) => s.location.kind === "in-flight");
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
          <h3 className="pick-name">{outpostName(pick)}</h3>
          <p className="muted small">
            {pick === here ? t("world.you_are_here") : laneBetween(here, pick) ? t("world.flight_from_here", { minutes: minutes(laneBetween(here, pick)!.durationSeconds), outpost: outpostName(here) }) : t("world.no_lane", { outpost: outpostName(here) })}
          </p>
          <div className="row">
            <button className="btn btn-brass" onClick={() => onOutpost(pick)} data-testid="visit-outpost">
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
              {picked?.colors && <Flag flag={picked.colors.flag} size={16} />} <b>{picked?.name ?? ownPicked?.name}</b>{" "}
              <small className="muted">{className(picked?.classId ?? ownPicked?.classId ?? "skiff")}</small>
              <br />
              {picked?.colors && (
                <>
                  <small className="muted">
                    {t("notice.colors", { crew: picked.colors.name })}
                    {picked.crewmate && <> · {t("cantina.crewmate")}</>}
                  </small>
                  <br />
                </>
              )}
              <small className="muted">
                {picked
                  ? picked.location.kind === "docked"
                    ? t("ship.docked_at", { outpost: outpostName(picked.location.outpostId) })
                    : t("notice.bound_for", { outpost: outpostName(picked.location.to), percent: Math.round(picked.location.progress / 10) })
                  : t("dock.ship_elsewhere", { outpost: outpostName(ownPicked!.outpostId) })}
              </small>
            </span>
            {!aboard && (
              <button
                className="btn btn-brass btn-small"
                disabled={!online || (picked ? picked.crew >= picked.maxCrew || (picked.inviteOnly && !picked.yours && !picked.crewmate) || (picked.location.kind === "docked" && picked.location.outpostId !== here) : ownPicked!.outpostId !== here)}
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
        <p className="muted small" data-testid="in-flight-count">
          {inFlight.length === 0 ? t("world.no_ships_in_flight") : inFlight.length === 1 ? t("world.ship_in_flight") : t("world.ships_in_flight", { count: inFlight.length })}
        </p>
      )}
      {!online && <p className="note">{t("app.offline")}</p>}
      {error && <p className="error">{t(`error.${error}`)}</p>}
    </section>
  );
}
