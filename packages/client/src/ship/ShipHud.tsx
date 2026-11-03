import type { ShipSnapshot } from "@openseas/protocol";
import { t, usePirate } from "@openseas/boards";
import { useNow } from "../state/settings.js";

function Meter({ label, value, danger, testId, invert }: { label: string; value: number; danger: boolean; testId: string; invert?: boolean }) {
  const pct = Math.round(value / 10);
  return (
    <div className={`meter ${danger ? "danger" : ""}`}>
      <span className="meter-label">{label}</span>
      <span className="meter-bar" aria-label={`${label} ${pct}%`}>
        <i style={{ width: `${invert ? 100 - pct : pct}%` }} />
      </span>
      <small data-testid={testId}>{pct}%</small>
    </div>
  );
}

/** The ship's vitals: bilge, hull, speed, cannons and the turn clock. Shown on deck and above every board. */
export function ShipHud({ ship, slim = false }: { ship: ShipSnapshot; slim?: boolean }) {
  const { socket } = usePirate();
  const atSea = ship.location.kind === "at-sea";
  const now = useNow(atSea);
  const untilTurn = ship.nextTurnAt === null ? null : Math.max(0, ship.nextTurnAt - socket.clockOffset - now);
  const speed = atSea && ship.lastTurn && !ship.lastTurn.held ? Math.round(ship.lastTurn.speed / 10) : null;
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
