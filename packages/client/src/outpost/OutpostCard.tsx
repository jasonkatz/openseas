import { useEffect } from "react";
import type { BoardShip } from "@openseas/protocol";
import { content, t, usePirate } from "@openseas/boards";
import { Flag } from "../crew/Flag.jsx";
import { RankChip } from "../crew/CrewPanel.jsx";
import { className, outpostBlurb, outpostName, minutes, laneBetween } from "../names.js";
import { useCrew } from "../state/CrewProvider.jsx";
import { useShip } from "../state/ShipProvider.jsx";
import { useSocial } from "../state/SocialProvider.jsx";
import type { OutpostRoom } from "../state/place.jsx";
import { Chat } from "./Chat.jsx";

export interface OutpostCardProps {
  id: string;
  room: OutpostRoom;
  /** The outpost the pirate stands on. */
  here: string;
  onRoom(room: OutpostRoom): void;
}

const ROOM_OF: Record<string, OutpostRoom> = { dock: "dock", cantina: "cantina", "notice-board": "notice" };
const KEY_OF: Record<OutpostRoom, string> = { none: "", dock: "outpost.dock", cantina: "outpost.cantina", notice: "outpost.notice_board" };

/** An outpost moved in on: its buildings are the menus (DESIGN.md 3.11). The header is the sheet's, above. */
export function OutpostCard({ id, room, here, onRoom }: OutpostCardProps) {
  const outpost = content.world.outposts.find((i) => i.id === id);
  const isHere = id === here;
  const lane = !isHere ? laneBetween(here, id) : null;
  if (!outpost) return null;

  return (
    <section className="card outpost-card" data-testid="outpost-card" data-outpost={id} data-room={room}>
      {room === "none" && (
        <>
          <p className="blurb">{outpostBlurb(id)}</p>
          {!isHere && <p className="note">{lane ? t("world.flight_from_here", { minutes: minutes(lane.durationSeconds), outpost: outpostName(here) }) : t("world.no_lane", { outpost: outpostName(here) })}</p>}
          <ul className="buildings">
            {outpost.buildings.map((b) => (
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
      {room === "dock" && <DockPanel outpostId={id} />}
      {room === "notice" && <NoticeBoardPanel outpostId={id} />}
      {room === "cantina" && <CantinaPanel />}
    </section>
  );
}

/** Board your own ship, or buy one at the shipyard: the single acquisition path (ADR 0010). */
function DockPanel({ outpostId }: { outpostId: string }) {
  const { pirate } = usePirate();
  const { boardShip, buyShip, error, clearError } = useShip();
  const ships = pirate?.ships ?? [];
  const here = ships.filter((s) => s.outpostId === outpostId);
  const away = ships.filter((s) => s.outpostId !== outpostId);
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
              <small>{t("dock.ship_elsewhere", { outpost: outpostName(s.outpostId) })}</small>
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
                <b>{t(c.nameKey)}</b> <small className="muted">{t("dock.price", { credits: c.price })}</small>
                <br />
                <small className="muted">{short > 0 ? t("dock.short", { credits: short }) : t("world.credits", { credits: pirate?.balance ?? 0 })}</small>
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

/** Ships recruiting at this dock and ships in flight, as the server lists them. */
export function NoticeBoardPanel({ outpostId }: { outpostId: string }) {
  const { socketStatus } = usePirate();
  const { board, listBoard, boardShip, error, clearError } = useShip();
  const online = socketStatus === "open";
  useEffect(() => {
    if (online) listBoard();
  }, [online, listBoard]);
  const ships = board?.ships ?? [];
  const docked = ships.filter((s) => s.location.kind === "docked" && s.location.outpostId === outpostId);
  const inFlight = ships.filter((s) => s.location.kind === "in-flight");
  const canJoin = (s: BoardShip): boolean => online && s.crew < s.maxCrew && (!s.inviteOnly || s.yours || s.crewmate);
  const row = (s: BoardShip) => (
    <li key={s.shipId} className={s.crewmate ? "is-crewmate" : ""} data-testid={`notice-ship-${s.shipId}`}>
      <span>
        {s.colors && <Flag flag={s.colors.flag} size={16} />} <b>{s.name}</b> <small className="muted">{className(s.classId)}</small>
        <br />
        <small className="muted">
          {s.colors && <>{t("notice.colors", { crew: s.colors.name })} · </>}
          {t("notice.captain", { name: s.captainName })} · {t("notice.crew", { count: s.crew, max: s.maxCrew })}
          {s.location.kind === "in-flight" && <> · {t("notice.bound_for", { outpost: outpostName(s.location.to), percent: Math.round(s.location.progress / 10) })}</>}
          {s.inviteOnly && <> · {s.crewmate ? t("notice.locked_yours") : t("notice.locked")}</>}
          {s.crew >= s.maxCrew && <> · {t("notice.full")}</>}
        </small>
      </span>
      <button className="btn btn-brass btn-small" disabled={!canJoin(s)} onClick={() => boardShip(s.shipId)} data-testid={`join-${s.shipId}`}>
        {s.location.kind === "in-flight" ? t("notice.join_in_flight") : t("notice.join")}
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
      <h3 className="section-head">{t("notice.in_flight")}</h3>
      {inFlight.length === 0 && <p className="muted small">{t("notice.none_in_flight")}</p>}
      <ul className="ships">{inFlight.map(row)}</ul>
      {!online && <p className="note">{t("app.offline")}</p>}
      {error && (
        <p className="error" role="alert" onClick={clearError}>
          {t(`error.${error}`)}
        </p>
      )}
    </div>
  );
}

/** Who is on the outpost, the outpost's chat, the crew table, and the pirate's own standing. */
function CantinaPanel() {
  const { pirate, socketStatus } = usePirate();
  const { presence, askWho } = useSocial();
  const { crew, rank, invites, openPanel, showProfile } = useCrew();
  const online = socketStatus === "open";
  useEffect(() => {
    if (online) askWho();
  }, [online, askWho]);
  const others = presence?.pirates.filter((p) => p.pirateId !== pirate?.id) ?? [];
  return (
    <div className="panel" data-testid="cantina-panel">
      <h3 className="section-head">{t("cantina.here")}</h3>
      {others.length === 0 ? (
        <p className="muted small">{t("cantina.alone")}</p>
      ) : (
        <ul className="patrons" data-testid="patrons">
          {others.map((p) => (
            <li key={p.pirateId}>
              <button className="pirate-link" onClick={() => showProfile({ pirateId: p.pirateId })} data-testid={`patron-${p.pirateId}`}>
                {p.name}
              </button>
              {p.crew && (
                <small className="muted patron-crew">
                  <Flag flag={p.crew.flag} size={13} /> {p.crew.name}
                  {crew && p.crew.id === crew.id && <> · {t("cantina.crewmate")}</>}
                </small>
              )}
            </li>
          ))}
        </ul>
      )}
      <Chat channel="outpost" />
      <h3 className="section-head">{t("cantina.crew_table")}</h3>
      <div className="crew-table" data-testid="cantina-crew">
        {crew ? (
          <>
            <Flag flag={crew.flag} size={30} />
            <span>
              <b>{crew.name}</b> {rank && <RankChip rank={rank} />}
              <br />
              <small className="muted">{t("cantina.crew_line", { members: crew.members.length, online: crew.members.filter((m) => m.where.kind !== "offline").length })}</small>
            </span>
          </>
        ) : (
          <span className="muted small">{invites.length > 0 ? t("cantina.crew_invited", { count: invites.length }) : t("cantina.crew_none")}</span>
        )}
        <div className="row">
          <button className="btn btn-brass btn-small" onClick={() => openPanel("crew")} data-testid="cantina-crew-open">
            {crew ? t("cantina.crew_open") : invites.length > 0 ? t("cantina.crew_answer") : t("cantina.crew_found")}
          </button>
          <button className="btn btn-ghost btn-small" onClick={() => openPanel("board")} data-testid="cantina-crew-board">
            {t("cantina.crew_board")}
          </button>
        </div>
      </div>
      <h3 className="section-head">{t("cantina.standing")}</h3>
      {pirate && pirate.ratings.length === 0 && <p className="muted small">{t("cantina.no_standing")}</p>}
      <div className="standing">
        {pirate?.ratings.map((r) => (
          <span key={r.puzzle} className="tier-chip">
            {t(`home.practice_${r.puzzle}`)} · {t(`tier.${r.tier}`)} <small>{t("cantina.rounds", { count: r.rounds })}</small>
          </span>
        ))}
      </div>
    </div>
  );
}
