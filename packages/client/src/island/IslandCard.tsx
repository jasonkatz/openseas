import { useEffect } from "react";
import type { BoardShip } from "@openseas/protocol";
import { content, t, usePirate } from "@openseas/boards";
import { className, islandBlurb, islandName, minutes, routeBetween } from "../names.js";
import { useShip } from "../state/ShipProvider.jsx";
import { useSocial } from "../state/SocialProvider.jsx";
import type { IslandRoom } from "../state/place.jsx";
import { Chat } from "./Chat.jsx";

export interface IslandCardProps {
  id: string;
  room: IslandRoom;
  /** The island the pirate stands on. */
  here: string;
  onRoom(room: IslandRoom): void;
}

const ROOM_OF: Record<string, IslandRoom> = { dock: "dock", tavern: "tavern", "notice-board": "notice" };
const KEY_OF: Record<IslandRoom, string> = { none: "", dock: "island.dock", tavern: "island.tavern", notice: "island.notice_board" };

/** An island moved in on: its buildings are the menus (DESIGN.md 3.11). The header is the sheet's, above. */
export function IslandCard({ id, room, here, onRoom }: IslandCardProps) {
  const island = content.world.islands.find((i) => i.id === id);
  const isHere = id === here;
  const route = !isHere ? routeBetween(here, id) : null;
  if (!island) return null;

  return (
    <section className="card island-card" data-testid="island-card" data-island={id} data-room={room}>
      {room === "none" && (
        <>
          <p className="blurb">{islandBlurb(id)}</p>
          {!isHere && <p className="note">{route ? t("world.sail_from_here", { minutes: minutes(route.durationSeconds), island: islandName(here) }) : t("world.no_lane", { island: islandName(here) })}</p>}
          <ul className="buildings">
            {island.buildings.map((b) => (
              <li key={b}>
                <button className={`building building-${b}`} disabled={!isHere} onClick={() => onRoom(ROOM_OF[b] ?? "none")} data-testid={`building-${b}`}>
                  <i className="building-glyph" aria-hidden="true" />
                  <span className="building-name">{t(KEY_OF[ROOM_OF[b] ?? "none"])}</span>
                  <small className="muted">{t(`${KEY_OF[ROOM_OF[b] ?? "none"]}_blurb`)}</small>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {room === "dock" && <DockPanel islandId={id} />}
      {room === "notice" && <NoticeBoardPanel islandId={id} />}
      {room === "tavern" && <TavernPanel />}
    </section>
  );
}

/** Board your own ship, or buy one at the shipyard: the single acquisition path (ADR 0010). */
function DockPanel({ islandId }: { islandId: string }) {
  const { pirate } = usePirate();
  const { boardShip, buyShip, error, clearError } = useShip();
  const ships = pirate?.ships ?? [];
  const here = ships.filter((s) => s.islandId === islandId);
  const away = ships.filter((s) => s.islandId !== islandId);
  return (
    <div className="panel" data-testid="dock-panel">
      <h3 className="section-head">{t("dock.your_ships")}</h3>
      {here.length === 0 && <p className="muted small">{t("dock.no_ships_here")}</p>}
      <ul className="ships">
        {here.map((s) => (
          <li key={s.id}>
            <span>
              <b>{s.name}</b> <small className="muted">{className(s.classId)}</small>
              <br />
              <small className="muted">{t("dock.ship_docked")}</small>
            </span>
            <button className="btn btn-brass btn-small" onClick={() => boardShip(s.id)} data-testid={`board-ship-${s.id}`}>
              {t("dock.board")}
            </button>
          </li>
        ))}
        {away.map((s) => (
          <li key={s.id} className="muted">
            <span>
              <b>{s.name}</b> <small>{className(s.classId)}</small>
              <br />
              <small>{t("dock.ship_elsewhere", { island: islandName(s.islandId) })}</small>
            </span>
          </li>
        ))}
      </ul>
      <h3 className="section-head">{t("dock.shipyard")}</h3>
      <p className="muted small">{t("dock.shipyard_blurb")}</p>
      <ul className="ships">
        {content.world.shipClasses.map((c) => {
          const short = Math.max(0, c.price - (pirate?.balance ?? 0));
          return (
            <li key={c.id}>
              <span>
                <b>{t(c.nameKey)}</b> <small className="muted">{t("dock.price", { coins: c.price })}</small>
                <br />
                <small className="muted">{short > 0 ? t("dock.short", { coins: short }) : t("world.coins", { coins: pirate?.balance ?? 0 })}</small>
              </span>
              <button className="btn btn-ghost btn-small" disabled={short > 0} onClick={() => buyShip(c.id)} data-testid={`buy-${c.id}`}>
                {t("dock.buy")}
              </button>
            </li>
          );
        })}
      </ul>
      {error && (
        <p className="error" role="alert" onClick={clearError}>
          {t(`error.${error}`)}
        </p>
      )}
    </div>
  );
}

/** Ships recruiting at this dock and ships at sea, as the server lists them. */
export function NoticeBoardPanel({ islandId }: { islandId: string }) {
  const { pirate, socketStatus } = usePirate();
  const { board, listBoard, boardShip, error, clearError } = useShip();
  const online = socketStatus === "open";
  useEffect(() => {
    if (online) listBoard();
  }, [online, listBoard]);
  const ships = board?.ships ?? [];
  const docked = ships.filter((s) => s.location.kind === "docked" && s.location.islandId === islandId);
  const atSea = ships.filter((s) => s.location.kind === "at-sea");
  const canJoin = (s: BoardShip): boolean => online && s.crew < s.maxCrew && (!s.inviteOnly || s.yours);
  const row = (s: BoardShip) => (
    <li key={s.shipId}>
      <span>
        <b>{s.name}</b> <small className="muted">{className(s.classId)}</small>
        <br />
        <small className="muted">
          {t("notice.captain", { name: s.captainName })} · {t("notice.crew", { count: s.crew, max: s.maxCrew })}
          {s.location.kind === "at-sea" && <> · {t("notice.bound_for", { island: islandName(s.location.to), percent: Math.round(s.location.progress / 10) })}</>}
          {s.inviteOnly && <> · {t("notice.locked")}</>}
          {s.crew >= s.maxCrew && <> · {t("notice.full")}</>}
        </small>
      </span>
      <button className="btn btn-brass btn-small" disabled={!canJoin(s)} onClick={() => boardShip(s.shipId)} data-testid={`join-${s.shipId}`}>
        {s.location.kind === "at-sea" ? t("notice.join_at_sea") : t("notice.join")}
      </button>
    </li>
  );
  return (
    <div className="panel" data-testid="notice-panel">
      <div className="row between">
        <h3 className="section-head">{t("notice.recruiting")}</h3>
        <button className="btn btn-ghost btn-small" onClick={listBoard} disabled={!online} data-testid="notice-refresh">
          {t("notice.refresh")}
        </button>
      </div>
      {docked.length === 0 && <p className="muted small">{t("notice.none_recruiting")}</p>}
      <ul className="ships">{docked.map(row)}</ul>
      <h3 className="section-head">{t("notice.at_sea")}</h3>
      {atSea.length === 0 && <p className="muted small">{t("notice.none_at_sea")}</p>}
      <ul className="ships">{atSea.map(row)}</ul>
      {!online && <p className="note">{t("app.offline")}</p>}
      {error && (
        <p className="error" role="alert" onClick={clearError}>
          {t(`error.${error}`)}
        </p>
      )}
      {pirate && null}
    </div>
  );
}

/** Who is ashore, the island's chat, and the pirate's own standing. */
function TavernPanel() {
  const { pirate, socketStatus } = usePirate();
  const { presence, askWho } = useSocial();
  const online = socketStatus === "open";
  useEffect(() => {
    if (online) askWho();
  }, [online, askWho]);
  const others = presence?.pirates.filter((p) => p.pirateId !== pirate?.id) ?? [];
  return (
    <div className="panel" data-testid="tavern-panel">
      <h3 className="section-head">{t("tavern.here")}</h3>
      {others.length === 0 ? (
        <p className="muted small">{t("tavern.alone")}</p>
      ) : (
        <ul className="patrons">
          {others.map((p) => (
            <li key={p.pirateId}>{p.name}</li>
          ))}
        </ul>
      )}
      <Chat channel="island" />
      <h3 className="section-head">{t("tavern.standing")}</h3>
      {pirate && pirate.ratings.length === 0 && <p className="muted small">{t("tavern.no_standing")}</p>}
      <div className="standing">
        {pirate?.ratings.map((r) => (
          <span key={r.puzzle} className="tier-chip">
            {t(`home.practice_${r.puzzle}`)} · {t(`tier.${r.tier}`)} <small>{t("tavern.rounds", { count: r.rounds })}</small>
          </span>
        ))}
      </div>
    </div>
  );
}
