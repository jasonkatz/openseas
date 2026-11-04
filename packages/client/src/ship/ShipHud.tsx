import type { ShipSnapshot } from "@openseas/protocol";
import { t, usePirate } from "@openseas/boards";
import { useNow } from "../state/settings.js";

function Meter({ label, value, danger, testId, invert }: { label: string; value: number; danger: boolean; testId: string; invert?: boolean }) {
  // The hull is shown as how much of it is sound, so the bar and the number agree everywhere.
  const pct = invert ? 100 - Math.round(value / 10) : Math.round(value / 10);
  return (
    <div className={`meter ${danger ? "danger" : ""}`}>
      <span className="meter-label">{label}</span>
      <span className="meter-bar" aria-label={`${label} ${pct}%`}>
        <i style={{ width: `${pct}%` }} />
      </span>
      <small data-testid={testId}>{pct}%</small>
    </div>
  );
}

/**
 * The ship's vitals: bilge, hull, speed, cannons and the turn clock. Shown on deck and above every
 * board. `mini` is the strip's version: the same bilge and hull, labeled and numbered so they can be
 * read at a glance, and the turn clock at sea.
 */
export function ShipHud({ ship, slim = false, mini = false }: { ship: ShipSnapshot; slim?: boolean; mini?: boolean }) {
  const { socket } = usePirate();
  const atSea = ship.location.kind === "at-sea";
  const now = useNow(atSea);
  const untilTurn = ship.nextTurnAt === null ? null : Math.max(0, ship.nextTurnAt - socket.clockOffset - now);
  const speed = atSea && ship.lastTurn && !ship.lastTurn.held ? Math.round(ship.lastTurn.speed / 10) : null;
  const water = Math.round(ship.water / 10);
  const hull = 100 - Math.round(ship.damage / 10);
  if (mini) {
    return (
      <span className="ship-mini" aria-label={t("ship.vitals")}>
        <span className={`mini-row ${ship.water >= 500 ? "danger" : ""}`}>
          <small>{t("ship.bilge")}</small>
          <span className="mini-meter">
            <i style={{ width: `${water}%` }} />
          </span>
          <b>{water}%</b>
        </span>
        <span className={`mini-row ${ship.damage >= 500 ? "danger" : ""}`}>
          <small>{t("ship.hull")}</small>
          <span className="mini-meter">
            <i className="hull" style={{ width: `${hull}%` }} />
          </span>
          <b>{hull}%</b>
        </span>
        {atSea && untilTurn !== null && (
          <span className="mini-row mini-turn-row" data-testid="mini-turn">
            <small>{t("ship.turn_bar")}</small>
            <span className="mini-turn">
              <i style={{ width: `${100 - (untilTurn / ship.turnMs) * 100}%` }} />
            </span>
            <b>{Math.ceil(untilTurn / 1000)}s</b>
          </span>
        )}
      </span>
    );
  }
  return (
    <div className={`ship-hud ${slim ? "ship-hud-slim" : ""}`} data-testid="ship-hud">
      <Meter label={t("ship.bilge")} value={ship.water} danger={ship.water >= 500} testId="ship-water" />
      <Meter label={t("ship.hull")} value={ship.damage} danger={ship.damage >= 500} testId="ship-damage" invert />
      <div className="meter">
        <span className="meter-label">{t("ship.speed")}</span>
        <span className="meter-value" data-testid="ship-speed">
          {speed === null ? t("ship.output_none") : t("ship.speed_value", { percent: speed })}
        </span>
      </div>
      <div className="meter">
        <span className="meter-label">{t("ship.cannons")}</span>
        <span className="meter-value lamps" aria-label={t("ship.cannons_value", { loaded: ship.loaded, total: ship.cannons })}>
          {Array.from({ length: ship.cannons }, (_, i) => (
            <i key={i} className={i < ship.loaded ? "lit" : ""} />
          ))}
        </span>
      </div>
      {atSea && untilTurn !== null && (
        <div className="turn-line" data-testid="turn-line">
          <span className="turn-text">{ship.lastTurn?.held ? t("ship.held") : t("ship.next_turn", { seconds: Math.ceil(untilTurn / 1000) })}</span>
          <span className="bar" aria-hidden="true">
            <i style={{ width: `${100 - (untilTurn / ship.turnMs) * 100}%` }} />
          </span>
        </div>
      )}
    </div>
  );
}
