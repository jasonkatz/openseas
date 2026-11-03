import { t, usePirate } from "@openseas/boards";

/** The one bar over the scene: who you are, your coins, the connection, the menu. */
export function TopBar({ onMenu }: { onMenu(): void }) {
  const { pirate, socketStatus } = usePirate();
  const statusClass = socketStatus === "open" ? "pip-live" : socketStatus === "connecting" ? "pip-wait" : "pip-off";
  const statusShort = socketStatus === "open" ? t("app.status_live") : socketStatus === "connecting" ? t("app.status_connecting") : t("app.status_offline");
  return (
    <header className="topbar" data-testid="topbar">
      <div className="who">
        <span className="who-name" data-testid="pirate-name">
          {pirate?.name}
        </span>
        <span className="who-coins">{t("world.coins", { coins: pirate?.balance ?? 0 })}</span>
      </div>
      <span className={`pip ${statusClass}`} title={statusShort}>
        <i aria-hidden="true" />
        {statusShort}
      </span>
      <button className="icon-btn" onClick={onMenu} aria-label={t("menu.open")} data-testid="menu-open">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>
    </header>
  );
}
