import { useEffect } from "react";
import type { BoardShip } from "@openseas/protocol";
import { content, t } from "../content.js";
import { Link, useRoute } from "../router.jsx";
import { usePirate } from "../state/PirateProvider.jsx";
import { useShip } from "../state/ShipProvider.jsx";

const islandName = (id: string): string => t(content.world.islands.find((i) => i.id === id)?.nameKey ?? id);
const className = (id: string): string => t(content.world.shipClasses.find((c) => c.id === id)?.nameKey ?? id);

const REFRESH_MS = 4000;

/** Ships recruiting at the pirate's island and ships at sea, straight from the server; refreshed while open. */
export function NoticeBoard() {
  const { pirate, socketStatus } = usePirate();
  const { ship, board, listBoard, boardShip, error } = useShip();
  const { navigate } = useRoute();
  const online = socketStatus === "open";

  useEffect(() => {
    if (!online) return;
    listBoard();
    const id = window.setInterval(listBoard, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [online, listBoard]);

  useEffect(() => {
    if (ship) navigate("/ship");
  }, [ship, navigate]);

  const here = board?.islandId ?? pirate?.islandId ?? content.world.startIslandId;
  const docked = board?.ships.filter((s) => s.location.kind === "docked") ?? [];
  const atSea = board?.ships.filter((s) => s.location.kind === "at-sea") ?? [];
  const own = pirate?.ships.filter((s) => s.islandId === here && !board?.ships.some((b) => b.shipId === s.id)) ?? [];

  return (
    <main className="page board">
      <header className="puzzle-bar">
        <Link to="/" className="icon-btn" aria-label={t("app.back")}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
        <h1 className="puzzle-title">{t("ship.notice_board")}</h1>
      </header>
      <section className="card card-parchment">
        <p className="eyebrow">{islandName(here)}</p>
        <h2>{t("ship.board_heading")}</h2>
        {!online && <p className="note">{t("app.offline")}</p>}
        {error && <p className="error">{t(`error.${error}`)}</p>}

        {own.length > 0 && (
          <>
            <h3 className="card-title">{t("ship.board_yours")}</h3>
            <ul className="ships" data-testid="board-yours">
              {own.map((s) => (
                <li key={s.id}>
                  <span>
                    <b>{s.name}</b> <small className="muted">{className(s.classId)}</small>
                  </span>
                  <button className="btn btn-brass" onClick={() => boardShip(s.id)} disabled={!online} data-testid={`board-${s.id}`}>
                    {t("ship.board_button")}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        <h3 className="card-title">{t("ship.board_docked")}</h3>
        {docked.length === 0 ? <p className="muted">{t("ship.board_none_docked")}</p> : <ShipList ships={docked} onBoard={boardShip} online={online} testId="board-docked" />}

        <h3 className="card-title">{t("ship.board_at_sea")}</h3>
        {atSea.length === 0 ? <p className="muted">{t("ship.board_none_at_sea")}</p> : <ShipList ships={atSea} onBoard={boardShip} online={online} testId="board-at-sea" />}
      </section>
    </main>
  );
}

function ShipList({ ships, onBoard, online, testId }: { ships: BoardShip[]; onBoard(id: string): void; online: boolean; testId: string }) {
  return (
    <ul className="ships" data-testid={testId}>
      {ships.map((s) => (
        <li key={s.shipId}>
          <span>
            <b>{s.name}</b> <small className="muted">{className(s.classId)}</small>
            <br />
            <small>
              {t("ship.board_captain", { name: s.captainName })} · {t("ship.board_crew", { count: s.crew, max: s.maxCrew })}
              {s.location.kind === "at-sea" && <> · {t("ship.board_bound_for", { island: islandName(s.location.to), percent: Math.round(s.location.progress / 10) })}</>}
              {s.inviteOnly && <> · {t("ship.board_locked")}</>}
            </small>
          </span>
          <button className="btn btn-brass" onClick={() => onBoard(s.shipId)} disabled={!online || s.crew >= s.maxCrew || (s.inviteOnly && !s.yours)}>
            {t("ship.board_button")}
          </button>
        </li>
      ))}
    </ul>
  );
}
