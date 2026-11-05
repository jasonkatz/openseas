import { useState, type ReactNode } from "react";
import type { CrewView, ShipEventWire, ShipSnapshot, StationWire } from "@openseas/protocol";
import { content, t } from "@openseas/boards";
import { Chat } from "../island/Chat.jsx";
import { className, islandName, minutes, routeBetween, stationName, tierName } from "../names.js";
import { useShip, type ShipNotice } from "../state/ShipProvider.jsx";
import { ShipHud } from "./ShipHud.jsx";

export interface DeckCardProps {
  ship: ShipSnapshot;
  me: string;
  onStation(station: StationWire): void;
  onHelm(): void;
  /** The captain's way to the battle board while a fight is on. */
  onBattle(): void;
  /** Everyone's way to the rail while a boarding melee is on. */
  onMelee(): void;
}

/**
 * The deck, unfolded: the ship's vitals, the stations, the crew, the wheel, the chat and the log.
 * Its header (where the ship is, what to do next) is the sheet's, above. The next thing to do leads.
 */
export function DeckCard({ ship, me, onStation, onHelm, onBattle, onMelee }: DeckCardProps) {
  const { notices, error, clearError, takeStation, leave, handWheel, lock, assign } = useShip();
  const [wheelTo, setWheelTo] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const mine = ship.crew.find((c) => c.pirateId === me) ?? null;
  const captain = ship.captainId === me;
  const owner = ship.ownerId === me;
  const atSea = ship.location.kind === "at-sea";
  const battle = ship.location.kind === "at-sea" ? ship.location.battle : null;
  const shipClass = content.world.shipClasses.find((c) => c.id === ship.classId);
  const stations = shipClass?.stations ?? [];
  /** The stations the captain may order a deckhand to: the class's, never the chart table. */
  const mateStations = shipClass?.mateStations ?? [];
  const hands = ship.crew.some((c) => c.mate);

  return (
    <section className="card deck-card" data-testid="deck-card">
      <p className="visually-hidden">
        {ship.name} <small className="muted">{className(ship.classId)}</small>
      </p>
      {ship.melee && (
        <div className="battle-line" data-testid="deck-melee">
          <b>{t("ship.in_melee", { brigand: tierName(ship.melee.tierId) })}</b>
          <p className="muted small">{t("ship.melee_blurb")}</p>
          <button className="btn btn-brass btn-wide" onClick={onMelee} data-testid="to-melee">
            {t("ship.melee_open")}
          </button>
        </div>
      )}
      {battle && !ship.melee && (
        <div className="battle-line" data-testid="deck-battle">
          <b>{t("ship.in_battle", { brigand: tierName(battle.tierId) })}</b>
          <p className="muted small">{captain ? t("ship.battle_blurb") : t("ship.battle_captain")}</p>
          {captain && (
            <button className="btn btn-brass btn-wide" onClick={onBattle} data-testid="to-battle">
              {t("ship.battle_open")}
            </button>
          )}
        </div>
      )}
      {captain && !atSea && (
        <button className="btn btn-brass btn-wide" onClick={onHelm} data-testid="set-sail">
          {t("ship.set_sail")}
        </button>
      )}
      {ship.location.kind === "at-sea" && (
        <div className="voyage-line">
          <span className="progress-meter" aria-label={t("ship.progress_label", { percent: Math.round(ship.location.progress / 10) })}>
            <i style={{ width: `${ship.location.progress / 10}%` }} />
          </span>
          <small className="muted" data-testid="ship-progress">
            {t("ship.progress_label", { percent: Math.round(ship.location.progress / 10) })}
          </small>
        </div>
      )}

      <ShipHud ship={ship} />

      <div className="section">
        <div className="row between section-row">
          <h3 className="section-head">{t("ship.stations")}</h3>
          {mine?.station && (
            <button className="btn btn-ghost btn-small" onClick={() => takeStation(null)} data-testid="stand-down">
              {t("ship.stand_down")}
            </button>
          )}
        </div>
        <div className="stations" data-testid="stations">
          {stations.map((s) => {
            const holder = ship.crew.find((c) => c.station === s);
            const isMine = holder?.pirateId === me;
            const hand = Boolean(holder?.mate);
            const out = ship.lastTurn?.outputs[s];
            return (
              <button
                key={s}
                className={`station-btn ${isMine ? "is-mine" : hand ? "is-mate" : holder ? "is-taken" : ""}`}
                disabled={Boolean(holder && !isMine && !hand)}
                onClick={() => onStation(s)}
                data-testid={`station-${s}`}
                data-holder={holder ? (hand ? "mate" : isMine ? "me" : "pirate") : "open"}
                title={hand && holder ? t("ship.take_over", { name: holder.name }) : undefined}
              >
                <span className="station-name">{stationName(s)}</span>
                <small className="station-who">{holder ? (isMine ? t("ship.you") : hand ? t("ship.mate_who", { name: holder.name }) : holder.name) : t("ship.station_free")}</small>
                {atSea && out !== undefined && <b className="station-out">{t("ship.output_percent", { percent: out })}</b>}
              </button>
            );
          })}
        </div>
        {hands && <p className="muted small">{t("ship.deckhands_note")}</p>}
      </div>

      <div className="section">
        <h3 className="section-head">{t("ship.crew_heading", { count: ship.crew.length, max: ship.maxCrew })}</h3>
        <ul className="crew" data-testid="crew">
          {ship.crew.map((c) => (
            <CrewRow key={c.pirateId} c={c} me={me} orders={captain && c.mate ? { stations: mateStations, crew: ship.crew, assign } : null} />
          ))}
        </ul>
      </div>

      {captain && (
        <div className="section">
          <h3 className="section-head">{t("ship.wheel_heading")}</h3>
          {atSea && <p className="muted small">{t("ship.captain_at_sea")}</p>}
          {ship.crew.some((c) => c.pirateId !== me && !c.mate) && (
            <div className="row">
              <select value={wheelTo} onChange={(e) => setWheelTo(e.target.value)} aria-label={t("ship.hand_wheel")}>
                <option value="">{t("ship.hand_wheel_pick")}</option>
                {ship.crew
                  .filter((c) => c.pirateId !== me && !c.mate)
                  .map((c) => (
                    <option key={c.pirateId} value={c.pirateId}>
                      {c.name}
                    </option>
                  ))}
              </select>
              <button className="btn btn-ghost btn-small" disabled={!wheelTo} onClick={() => handWheel(wheelTo)}>
                {t("ship.hand_wheel_button")}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="section">
        <button className="btn btn-ghost btn-small" onClick={() => setChatOpen((o) => !o)} aria-expanded={chatOpen} data-testid="ship-chat-toggle">
          {t("chat.ship_toggle")}
        </button>
        {chatOpen && <Chat channel="ship" />}
      </div>

      <div className="section row">
        {owner && (
          <label className="toggle">
            <input type="checkbox" checked={ship.inviteOnly} onChange={(e) => lock(e.target.checked)} data-testid="toggle-lock" />
            <span>
              {t("ship.lock")} <small className="muted">{t("ship.lock_hint")}</small>
            </span>
          </label>
        )}
        <button className="btn btn-ghost" onClick={leave} data-testid="go-ashore">
          {atSea ? t("ship.leave_at_sea") : t("ship.go_ashore")}
        </button>
      </div>

      {error && (
        <p className="error" role="alert" onClick={clearError}>
          {t(`error.${error}`)}
        </p>
      )}

      {notices.length > 0 && (
        <div className="section">
          <h3 className="section-head">{t("ship.voyage_log")}</h3>
          <ul className="log" aria-live="polite" data-testid="ship-log">
            {notices.map((n) => (
              <li key={n.id}>{describeEvent(n.event)}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** What the captain may order a deckhand: the stations deckhands work, with those a pirate holds greyed. */
interface Orders {
  stations: readonly StationWire[];
  crew: readonly CrewView[];
  assign(pirateId: string, station: StationWire | null): void;
}

function CrewRow({ c, me, orders }: { c: CrewView; me: string; orders: Orders | null }) {
  return (
    <li className={`${c.away ? "away" : ""} ${c.mate ? "is-mate" : ""}`} data-testid={c.mate ? "crew-mate" : "crew-pirate"}>
      <span className="crew-name">
        {c.name}
        {c.pirateId === me && <small className="muted"> ({t("ship.you")})</small>}
      </span>
      <span className="crew-role">
        {c.captain && <b className="tier-chip">{t("ship.captain")}</b>}
        {c.mate && (
          <b className="mate-chip" title={t("ship.mate_hint")}>
            <MateMark /> {t("ship.mate")}
          </b>
        )}
        {orders ? (
          <select
            className="assign"
            value={c.station ?? ""}
            onChange={(e) => orders.assign(c.pirateId, e.target.value ? (e.target.value as StationWire) : null)}
            aria-label={t("ship.assign", { name: c.name })}
            data-testid={`assign-${c.pirateId}`}
          >
            <option value="">{c.station ? t("ship.assign_stand_down") : t("ship.assign_pick")}</option>
            {orders.stations.map((s) => {
              const holder = orders.crew.find((x) => x.station === s);
              return (
                <option key={s} value={s} disabled={Boolean(holder && !holder.mate)}>
                  {stationName(s)}
                  {holder && holder.pirateId !== c.pirateId ? ` · ${holder.name}` : ""}
                </option>
              );
            })}
          </select>
        ) : (
          <>{c.station ? stationName(c.station) : t("ship.no_station")}</>
        )}
        {c.away && <em className="muted"> · {t("ship.away")}</em>}
      </span>
    </li>
  );
}

/** The deckhand's mark: a knot of rope, drawn so it reads apart from a pirate's chip without color. */
function MateMark() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="8" cy="8" r="5.2" strokeDasharray="2.4 2" />
      <path d="M5.5 8h5M8 5.5v5" />
    </svg>
  );
}

export function describeEvent(e: ShipEventWire): ReactNode {
  switch (e.type) {
    case "boarded":
      return t("ship.log_boarded", { name: e.name });
    case "hired":
      return e.station ? t("ship.log_hired", { name: e.name, station: stationName(e.station) }) : t("ship.log_hired_idle", { name: e.name });
    case "paid_off":
      return t("ship.log_paid_off", { names: e.names.join(", ") });
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
    case "engaged":
      return t("ship.log_engaged", { brigand: tierName(e.tierId) });
    case "battle_ended": {
      const key = e.outcome === "boarded" || e.outcome === "crippled" ? "ship.log_battle_won" : e.outcome === "boarded_by" || e.outcome === "crippled_by" ? "ship.log_battle_lost" : e.outcome === "disengaged" ? "ship.log_battle_disengaged" : "ship.log_battle_broke_off";
      return t(key, { brigand: tierName(e.tierId), turns: e.turns, booty: e.booty });
    }
    case "boarding":
      return t("toast.boarding");
    case "arrived":
      return t("ship.log_arrived", { island: islandName(e.islandId), minutes: minutes(e.turns * content.world.ship.turnSeconds) });
    case "abandoned":
      return t("ship.log_abandoned", { island: islandName(e.islandId) });
    default: {
      const never: never = e;
      return never;
    }
  }
}

export type { ShipNotice };

/** The captain's chart: pick a destination on the chart, then set sail. */
export function HelmCard({ ship, pick, onPick, onCancel }: { ship: ShipSnapshot; pick: string | null; onPick(id: string): void; onCancel(): void }) {
  const { sail, error } = useShip();
  const from = ship.location.kind === "docked" ? ship.location.islandId : null;
  const routes = from ? content.world.routes.filter((r) => r.from === from) : [];
  const chosen = from && pick ? routeBetween(from, pick) : null;
  return (
    <section className="card helm-card" data-testid="helm-card">
      <p className="muted small">{t("ship.pick_destination_blurb")}</p>
      <ul className="dest-list">
        {routes.map((r) => (
          <li key={r.id}>
            <button className={`dest ${pick === r.to ? "is-picked" : ""}`} onClick={() => onPick(r.to)} data-testid={`dest-${r.to}`}>
              <span>{islandName(r.to)}</span>
              <small className="muted">{t("ship.sail_minutes", { minutes: minutes(r.durationSeconds) })}</small>
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="error">{t(`error.${error}`)}</p>}
      <div className="row">
        <button className="btn btn-brass" disabled={!chosen} onClick={() => chosen && sail(chosen.id)} data-testid="sail-now">
          {chosen ? t("ship.sail_to", { island: islandName(chosen.to) }) : t("ship.set_sail")}
        </button>
        <button className="btn btn-ghost" onClick={onCancel}>
          {t("ship.cancel")}
        </button>
      </div>
    </section>
  );
}
