import { t } from "@openseas/boards";
import { useCrew } from "../state/CrewProvider.jsx";
import { CrewPanel } from "./CrewPanel.jsx";

/** The crew card over the scene, the same everywhere, like the menu (DESIGN.md 3.11). */
export function CrewDialog() {
  const { panel, openPanel, closePanel } = useCrew();
  if (!panel) return null;
  return (
    <>
      <button className="scrim" aria-label={t("menu.close")} onClick={closePanel} />
      <section className="card menu crew-dialog" role="dialog" aria-label={t("crew.title")} data-testid="crew-dialog">
        <button className="icon-btn dialog-close" onClick={closePanel} aria-label={t("menu.close")} data-testid="crew-close">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        <CrewPanel tab={panel} onTab={(tab) => openPanel(tab)} />
      </section>
    </>
  );
}
