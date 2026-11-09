import type { ShipSnapshot } from "@openseas/protocol";
import { t } from "@openseas/boards";
import { tierName } from "../names.js";
import { useShip } from "../state/ShipProvider.jsx";

/** A brigand's hail floats over the view, wherever the captain is looking. */
export function HailBanner({ ship, me, inline = false }: { ship: ShipSnapshot; me: string; inline?: boolean }) {
  const { evade, engage } = useShip();
  const hail = ship.location.kind === "at-sea" ? ship.location.hail : null;
  if (!hail) return null;
  const captain = ship.captainId === me;
  return (
    <div className={`hail-banner ${inline ? "hail-inline" : ""}`} role="alert" data-testid="ship-hail" data-world-avoid="">
      <p className="hail-title">{t("ship.hailed", { brigand: tierName(hail.tierId) })}</p>
      {captain ? (
        <span className="row">
          <button className="btn btn-brass btn-small" onClick={engage} data-testid="engage">
            {t("ship.engage")}
          </button>
          <button className="btn btn-ghost btn-small" onClick={evade} data-testid="evade">
            {t("ship.evade")}
          </button>
        </span>
      ) : (
        <p className="muted small">{t("ship.hail_wait")}</p>
      )}
    </div>
  );
}
