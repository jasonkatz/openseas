import { useEffect, useState, type ReactNode } from "react";
import type { CrewView, ShipSnapshot, StationWire } from "@openseas/protocol";
import { content, t } from "../content.js";
import { Link } from "../router.jsx";
import { DutyStation } from "../ship/DutyStation.jsx";
import { usePirate } from "../state/PirateProvider.jsx";
import { useShip } from "../state/ShipProvider.jsx";

const islandName = (id: string): string => t(content.world.islands.find((i) => i.id === id)?.nameKey ?? id);
const tierName = (id: string): string => t(content.world.brigandTiers.find((b) => b.id === id)?.nameKey ?? id);
const className = (id: string): string => t(content.world.shipClasses.find((c) => c.id === id)?.nameKey ?? id);
const stationName = (s: StationWire): string => t(`home.practice_${s}`);

/** Ticks once a second so countdowns move. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

export function ShipPage() {
  const { pirate, socket, socketStatus } = usePirate();
  const { ship, notices, error, leave, takeStation, sail, evade, handWheel, lock, clearError } = useShip();

  if (!ship || !pirate) {
    return (
      <main className="page ship">
        <ShipBar title={t("ship.title")} />
        <section className="card card-parchment">
          <h2>{t("ship.not_aboard")}</h2>
          <p>{socketStatus === "open" ? t("ship.not_aboard_blurb") : t("app.offline")}</p>
          <div className="stack">
            <Link to="/board" className="btn btn-brass">
              {t("ship.notice_board")}
            </Link>
            <Link to="/" className="btn btn-ghost">
              {t("app.back")}
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return <Aboard ship={ship} me={pirate.id} clockOffset={socket.clockOffset} notices={notices} error={error} clearError={clearError} actions={{ leave, takeStation, sail, evade, handWheel, lock }} />;
}

interface AboardProps {
  ship: ShipSnapshot;
  me: string;
  clockOffset: number;
  notices: ReturnType<typeof useShip>["notices"];
  error: string | null;
  clearError(): void;
  actions: Pick<ReturnType<typeof useShip>, "leave" | "takeStation" | "sail" | "evade" | "handWheel" | "lock">;
}

function Aboard({ ship, me, clockOffset, notices, error, clearError, actions }: AboardProps) {
  const mine = ship.crew.find((c) => c.pirateId === me) ?? null;
  const captain = ship.captainId === me;
  const owner = ship.ownerId === me;
  const atSea = ship.location.kind === "at-sea";
  const now = useNow(atSea || ship.location.kind === "docked");
  const [destination, setDestination] = useState("");
  const [wheelTo, setWheelTo] = useState("");

  const dockedAt = ship.location.kind === "docked" ? ship.location.islandId : null;
  const routes = dockedAt ? content.world.routes.filter((r) => r.from === dockedAt) : [];
  useEffect(() => {
    if (routes.length && !routes.some((r) => r.id === destination)) setDestination(routes[0]!.id);
  }, [routes, destination]);

  const untilTurn = ship.nextTurnAt === null ? null : Math.max(0, ship.nextTurnAt - clockOffset - now);
  const hail = ship.location.kind === "at-sea" ? ship.location.hail : null;
  const stations = content.world.shipClasses.find((c) => c.id === ship.classId)?.stations ?? [];
  const lastOutput = mine?.station && ship.lastTurn ? (ship.lastTurn.outputs[mine.station] ?? 0) : null;

  const location =
    ship.location.kind === "docked"
      ? t("ship.docked_at", { island: islandName(ship.location.islandId) })
      : t("ship.under_way", { from: islandName(ship.location.from), to: islandName(ship.location.to) });

  return (
    <main className="page ship">
      <ShipBar title={ship.name} />

      <section className="card card-ink ship-card" data-testid="ship-card">
        <p className="eyebrow">{location}</p>
        <h2>
          {ship.name} <small className="muted">{className(ship.classId)}</small>
        </h2>
        {ship.location.kind === "at-sea" && (
          <div className="voyage-line">
            <span className="water-meter progress-meter voyage-meter" aria-label={t("ship.progress_label", { percent: Math.round(ship.location.progress / 10) })}>
              <i style={{ width: `${ship.location.progress / 10}%` }} />
            </span>
            <small className="muted" data-testid="ship-progress">
              {t("ship.progress_label", { percent: Math.round(ship.location.progress / 10) })}
            </small>
          </div>
        )}
        <dl className="meters">
          <Meter label={t("ship.bilge")} value={ship.water} danger={ship.water >= 500} testId="ship-water" />
          <Meter label={t("ship.hull")} value={ship.damage} danger={ship.damage >= 500} testId="ship-damage" />
          <div className="meter">
            <dt>{t("ship.speed")}</dt>
            <dd data-testid="ship-speed">{atSea && ship.lastTurn && !ship.lastTurn.held ? t("ship.speed_value", { percent: Math.round(ship.lastTurn.speed / 10) }) : "–"}</dd>
          </div>
          <div className="meter">
            <dt>{t("ship.cannons")}</dt>
            <dd>{t("ship.cannons_value", { loaded: ship.loaded, total: ship.cannons })}</dd>
          </div>
        </dl>
        {atSea && untilTurn !== null && (
          <p className="muted small turn-line">
            {ship.lastTurn?.held ? t("ship.held") : t("ship.next_turn", { seconds: Math.ceil(untilTurn / 1000) })}
            <span className="bar" aria-hidden="true">
              <i style={{ width: `${100 - (untilTurn / ship.turnMs) * 100}%` }} />
            </span>
          </p>
        )}
        {hail && (
          <div className="hail" role="alert" data-testid="ship-hail">
            <p>{t("ship.hailed", { brigand: tierName(hail.tierId) })}</p>
            {captain ? (
              <button className="btn btn-brass" onClick={actions.evade} data-testid="evade">
                {t("ship.evade")}
              </button>
            ) : (
              <p className="muted small">{t("ship.hail_wait")}</p>
            )}
          </div>
        )}
      </section>

      {mine?.station && atSea && <DutyStation station={mine.station} shipId={ship.shipId} lastOutput={lastOutput} />}
      {mine?.station && !atSea && <p className="status">{t("ship.duty_waits_for_sea")}</p>}

      <section className="card card-ink">
        <h3 className="card-title">{t("ship.your_station")}</h3>
        <div className="stations" data-testid="stations">
          {stations.map((s) => {
            const holder = ship.crew.find((c) => c.station === s);
            const isMine = holder?.pirateId === me;
            return (
              <button
                key={s}
                className={`btn ${isMine ? "btn-brass" : "btn-ghost"}`}
                disabled={Boolean(holder && !isMine)}
                onClick={() => actions.takeStation(isMine ? null : s)}
                data-testid={`station-${s}`}
              >
                {stationName(s)}
                {holder && !isMine && <small className="muted"> · {holder.name}</small>}
                {isMine && <small> · {t("ship.stand_down")}</small>}
              </button>
            );
          })}
        </div>
        {ship.lastTurn && (
          <p className="muted small outputs-line" data-testid="ship-outputs">
            {stations.map((s) => `${stationName(s)} ${ship.lastTurn!.outputs[s] ?? 0}%`).join(" · ")}
          </p>
        )}
      </section>

      <section className="card card-ink">
        <h3 className="card-title">{t("ship.crew_heading", { count: ship.crew.length, max: ship.maxCrew })}</h3>
        <ul className="crew" data-testid="crew">
          {ship.crew.map((c) => (
            <CrewRow key={c.pirateId} c={c} me={me} />
          ))}
        </ul>
      </section>

      {captain && (
        <section className="card card-parchment">
          <h3 className="card-title">{t("ship.wheel_heading")}</h3>
          {ship.location.kind === "docked" && routes.length > 0 && (
            <div className="stack">
              <label className="field">
                <span>{t("ship.destination")}</span>
                <select value={destination} onChange={(e) => setDestination(e.target.value)} data-testid="destination">
                  {routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {t("ship.route_option", { island: islandName(r.to), minutes: Math.round(r.durationSeconds / 60) })}
                    </option>
                  ))}
                </select>
              </label>
              <button className="btn btn-brass" onClick={() => sail(actions, destination)} disabled={!destination} data-testid="set-sail">
                {t("ship.set_sail")}
              </button>
            </div>
          )}
          {atSea && <p className="muted small">{t("ship.captain_at_sea")}</p>}
          {ship.crew.length > 1 && (
            <div className="stack">
              <label className="field">
                <span>{t("ship.hand_wheel")}</span>
                <select value={wheelTo} onChange={(e) => setWheelTo(e.target.value)}>
                  <option value="">{t("ship.hand_wheel_pick")}</option>
                  {ship.crew
                    .filter((c) => c.pirateId !== me)
                    .map((c) => (
                      <option key={c.pirateId} value={c.pirateId}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
              <button className="btn btn-ghost" disabled={!wheelTo} onClick={() => actions.handWheel(wheelTo)}>
                {t("ship.hand_wheel_button")}
              </button>
            </div>
          )}
        </section>
      )}

      <section className="card card-ink">
        {owner && (
          <label className="toggle">
            <input type="checkbox" checked={ship.inviteOnly} onChange={(e) => actions.lock(e.target.checked)} data-testid="toggle-lock" />
            <span>
              {t("ship.lock")} <small className="muted">{t("ship.lock_hint")}</small>
            </span>
          </label>
        )}
        <div className="stack">
          <button className="btn btn-ghost" onClick={actions.leave} data-testid="go-ashore">
            {atSea ? t("ship.leave_at_sea") : t("ship.go_ashore")}
          </button>
        </div>
      </section>

      {error && (
        <p className="error" role="alert" onClick={clearError}>
          {t(`error.${error}`)}
        </p>
      )}

      {notices.length > 0 && (
        <ul className="log" aria-live="polite" data-testid="ship-log">
          {notices.map((n) => (
            <li key={n.id}>{describe(n.event)}</li>
          ))}
        </ul>
      )}
    </main>
  );
}

function sail(actions: AboardProps["actions"], routeId: string): void {
  if (routeId) actions.sail(routeId);
}

function Meter({ label, value, danger, testId }: { label: string; value: number; danger: boolean; testId: string }) {
  return (
    <div className="meter">
      <dt>{label}</dt>
      <dd>
        <span className={`water-meter ${danger ? "danger" : ""}`} aria-label={`${label} ${Math.round(value / 10)}%`}>
          <i style={{ width: `${value / 10}%` }} />
        </span>
        <small data-testid={testId}>{Math.round(value / 10)}%</small>
      </dd>
    </div>
  );
}

function CrewRow({ c, me }: { c: CrewView; me: string }) {
  return (
    <li className={c.away ? "away" : ""}>
      <span className="crew-name">
        {c.name}
        {c.pirateId === me && <small className="muted"> ({t("ship.you")})</small>}
      </span>
      <span className="crew-role">
        {c.captain && <b className="tier-chip">{t("ship.captain")}</b>}
        {c.station ? stationName(c.station) : t("ship.no_station")}
        {c.away && <em className="muted"> · {t("ship.away")}</em>}
      </span>
    </li>
  );
}

function describe(e: ReturnType<typeof useShip>["notices"][number]["event"]): ReactNode {
  switch (e.type) {
    case "boarded":
      return t("ship.log_boarded", { name: e.name });
    case "left":
      return t(e.reason === "timed_out" ? "ship.log_timed_out" : "ship.log_left", { name: e.name });
    case "station":
      return e.station ? t("ship.log_station", { name: e.name, station: stationName(e.station) }) : t("ship.log_stood_down", { name: e.name });
    case "wheel":
      return t("ship.log_wheel", { name: e.name });
    case "sailed": {
      const r = content.world.routes.find((x) => x.id === e.routeId);
      return t("ship.log_sailed", { island: r ? islandName(r.to) : e.routeId });
    }
    case "hailed":
      return t("ship.log_hailed", { brigand: tierName(e.tierId) });
    case "evaded":
      return t(e.auto ? "ship.log_evaded_auto" : "ship.log_evaded", { brigand: tierName(e.tierId) });
    case "arrived":
      return t("ship.log_arrived", { island: islandName(e.islandId), minutes: Math.max(1, Math.round((e.turns * content.world.ship.turnSeconds) / 60)) });
    case "abandoned":
      return t("ship.log_abandoned", { island: islandName(e.islandId) });
    default: {
      const never: never = e;
      return never;
    }
  }
}

function ShipBar({ title }: { title: string }) {
  const { socketStatus } = usePirate();
  const statusClass = socketStatus === "open" ? "pip-live" : socketStatus === "connecting" ? "pip-wait" : "pip-off";
  const statusShort = socketStatus === "open" ? t("app.status_live") : socketStatus === "connecting" ? t("app.status_connecting") : t("app.status_offline");
  return (
    <header className="puzzle-bar">
      <Link to="/" className="icon-btn" aria-label={t("app.back")}>
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>
      <h1 className="puzzle-title">{title}</h1>
      <span className={`pip ${statusClass}`}>
        <i aria-hidden="true" />
        {statusShort}
      </span>
    </header>
  );
}
