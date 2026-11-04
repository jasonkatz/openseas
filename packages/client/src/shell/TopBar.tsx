import { t, usePirate } from "@openseas/boards";

export interface TopBarProps {
  onMenu(): void;
  /** Zoom out to the chart, or back in to where the pirate is. */
  onMap(): void;
  onChart: boolean;
}

/** The one bar over the scene, kept thin: who you are, the chart, the menu. */
export function TopBar({ onMenu, onMap, onChart }: TopBarProps) {
  const { pirate, socketStatus } = usePirate();
  const statusClass = socketStatus === "open" ? "pip-live" : socketStatus === "connecting" ? "pip-wait" : "pip-off";
  const statusShort = socketStatus === "open" ? t("app.status_live") : socketStatus === "connecting" ? t("app.status_connecting") : t("app.status_offline");
  return (
    <header className="topbar" data-testid="topbar">
      <div className="who" title={statusShort}>
        <i className={`dot ${statusClass}`} aria-label={statusShort} />
        <span className="who-name" data-testid="pirate-name">
          {pirate?.name}
        </span>
        <span className="who-coins">{t("world.coins", { coins: pirate?.balance ?? 0 })}</span>
      </div>
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
      <button className="icon-btn" onClick={onMenu} aria-label={t("menu.open")} data-testid="menu-open">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>
    </header>
  );
}
