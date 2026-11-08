import { t, usePirate } from "@openseas/boards";
import { Flag } from "../crew/Flag.jsx";
import { lookFor } from "../pirate/look.js";
import { Portrait } from "../pirate/Portrait.jsx";
import { useCrew } from "../state/CrewProvider.jsx";
import { useSheet } from "../state/SheetProvider.jsx";
import { useSocial } from "../state/SocialProvider.jsx";

export interface TopBarProps {
  onMenu(): void;
  /** Zoom out to the chart, or back in to where the pirate is. */
  onMap(): void;
  onChart: boolean;
}

/** The one bar over the scene, kept thin: who you are (a tap opens your sheet), your crew, the chart, the menu. */
export function TopBar({ onMenu, onMap, onChart }: TopBarProps) {
  const { pirate, socketStatus } = usePirate();
  const { crew, invites, openPanel } = useCrew();
  const { unread } = useSocial();
  const { openSheet } = useSheet();
  const waiting = invites.length + (crew ? unread.crew : 0);
  const statusClass = socketStatus === "open" ? "pip-live" : socketStatus === "connecting" ? "pip-wait" : "pip-off";
  const statusShort = socketStatus === "open" ? t("app.status_live") : socketStatus === "connecting" ? t("app.status_connecting") : t("app.status_offline");
  return (
    <header className="topbar" data-testid="topbar">
      <button type="button" className="who who-btn" title={statusShort} onClick={() => openSheet()} aria-label={t("sheet.open", { name: pirate?.name ?? "", coins: t("world.coins", { coins: pirate?.balance ?? 0 }), status: statusShort })} data-testid="sheet-open">
        {/* The connection's pip sits on the likeness's shoulder, so the bar stays thin. */}
        <span className="who-face">
          {pirate && <Portrait look={lookFor(pirate.id, pirate.look)} size={28} />}
          <i className={`dot ${statusClass}`} aria-label={statusShort} />
        </span>
        <span className="who-name" data-testid="pirate-name">
          {pirate?.name}
        </span>
        <span className="who-coins" title={t("world.coins", { coins: pirate?.balance ?? 0 })} aria-label={t("world.coins", { coins: pirate?.balance ?? 0 })} data-testid="pirate-coins">
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <circle cx="8" cy="8" r="6.4" fill="currentColor" />
            <circle cx="8" cy="8" r="4" fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth="1.3" />
          </svg>
          {pirate?.balance ?? 0}
        </span>
      </button>
      <button className={`pill-btn ${onChart ? "is-on" : ""}`} onClick={onMap} aria-label={onChart ? t("world.back_home") : t("world.open_chart")} aria-pressed={onChart} data-testid="map-toggle">
        {onChart ? (
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">
            <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" />
            <path d="M9 4v14M15 6v14" />
          </svg>
        )}
        <span>{onChart ? t("world.back_short") : t("world.chart_short")}</span>
      </button>
      <button
        className={`pill-btn crew-btn ${crew ? "has-crew" : ""}`}
        onClick={() => openPanel(crew && unread.crew > 0 && invites.length === 0 ? "chat" : "crew")}
        aria-label={crew ? t("crew.open_named", { crew: crew.name }) : t("crew.open")}
        data-testid="crew-open"
      >
        {crew ? (
          <Flag flag={crew.flag} size={16} decorative />
        ) : (
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 21V3" />
            <path d="M6 4h12l-3 4 3 4H6" />
          </svg>
        )}
        <span>{t("crew.short")}</span>
        {waiting > 0 && (
          <span className="badge" data-testid="crew-badge">
            {waiting}
          </span>
        )}
      </button>
      <button className="icon-btn" onClick={onMenu} aria-label={t("menu.open")} data-testid="menu-open">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>
    </header>
  );
}
