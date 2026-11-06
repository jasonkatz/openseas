import { authClient, t, usePirate } from "@openseas/boards";
import { ConfirmButton } from "../crew/CrewPanel.jsx";
import { AccountSection } from "./Account.jsx";
import { useShip } from "../state/ShipProvider.jsx";
import { useMuted } from "../state/settings.js";

export interface MenuProps {
  showMarks: boolean;
  onShowMarks(on: boolean): void;
  onClose(): void;
}

/** The one menu, over the scene, the same everywhere (DESIGN.md 3.11). */
export function Menu({ showMarks, onShowMarks, onClose }: MenuProps) {
  const { pirate } = usePirate();
  const { ship, leave } = useShip();
  const [muted, setMuted] = useMuted();

  const signOut = async (): Promise<void> => {
    try {
      await authClient.signOut();
    } finally {
      window.location.assign("/");
    }
  };

  return (
    <>
      <button className="scrim" aria-label={t("menu.close")} onClick={onClose} />
      <section className="card menu" role="dialog" aria-label={t("menu.title")} data-testid="menu">
        <header className="row between">
          <h2>{t("menu.title")}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t("menu.close")} data-testid="menu-close">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>
        <label className="toggle">
          <input type="checkbox" checked={!muted} onChange={(e) => setMuted(!e.target.checked)} data-testid="toggle-sound" />
          <span>
            {t("menu.sound")} <small className="muted">{t("menu.sound_hint")}</small>
          </span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={showMarks} onChange={(e) => onShowMarks(e.target.checked)} data-testid="toggle-marks" />
          <span>
            {t("menu.marks")} <small className="muted">{t("menu.marks_hint")}</small>
          </span>
        </label>
        <div className="section">
          <h3 className="section-head">{t("menu.account")}</h3>
          <AccountSection />
          {ship && (
            <button
              className="btn btn-ghost"
              onClick={() => {
                leave();
                onClose();
              }}
              data-testid="menu-leave-ship"
            >
              {t("menu.leave_ship")}
            </button>
          )}
          {pirate?.guest ? (
            <>
              <ConfirmButton label={t("menu.sign_out")} confirm={t("menu.sign_out_guest_sure")} onConfirm={() => void signOut()} className="btn btn-ghost" testId="sign-out" />
              <p className="muted small">{t("menu.sign_out_hint")}</p>
            </>
          ) : (
            <button className="btn btn-ghost" onClick={() => void signOut()} data-testid="sign-out">
              {t("menu.sign_out")}
            </button>
          )}
        </div>
        <p className="muted small colophon-line">{t("menu.about")}</p>
      </section>
    </>
  );
}
