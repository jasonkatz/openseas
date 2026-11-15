import { useCallback, useState } from "react";
import type { PuzzleId } from "@openseas/engine";
import { t } from "@openseas/boards";
import { ASSET_SELECT, SoundPanel, SpritePanel } from "../assets/AssetPanels.jsx";
import { useFrame } from "../frame/RoundFrame.jsx";
import { PlayShell } from "../play/PlayShell.jsx";
import type { ShellProps } from "../practice/PracticeShell.jsx";
import { ChatPanel } from "../service/ChatPanel.jsx";
import { DraftBanner } from "../service/DraftSection.jsx";
import { LooseRefusals, NumbersPanel, modeOfKey, useNumberSections } from "../tuning/TuningPanel.jsx";
import { ModeIcon } from "./icons.jsx";
import { RAIL, isNumberMode, type ModeId } from "./modes.js";
import { PlayPanel } from "./PlayPanel.jsx";
import { TopBar, type Target } from "./TopBar.jsx";
import { readRestart, writeRestart } from "./useStudio.js";

const HINTS_KEY = "openseas.studio.hints";
function readHints(): boolean {
  try {
    return window.localStorage.getItem(HINTS_KEY) === "1";
  } catch {
    return false;
  }
}

/** Bring a control into view and mark it for a moment: where a change in the top bar's list was made. */
function flash(testId: string): void {
  const el = document.querySelector(`[data-testid="${CSS.escape(testId)}"]`);
  if (!el) return;
  el.scrollIntoView({ block: "center" });
  el.classList.add("is-flash");
  window.setTimeout(() => el.classList.remove("is-flash"), 1300);
}

/**
 * A puzzle's studio page (DESIGN.md 3.14, ADR 0055), laid out for a desktop as a design tool is.
 * A bar across the top says where the page is and what becomes of the draft. A rail down the left
 * edge picks a mode, and the panel beside it is that mode's: the round, the numbers in three
 * parts, the sprites, the sounds. The board stands in the middle at a phone's proportions,
 * exactly as `/play` draws it, in every mode. The chat is on the right (ADR 0047). Every panel
 * stays in the page while one shows, so a file being tried or a value half typed outlasts a look
 * at another. A phone never sees this: it gets the puzzle alone (App.tsx).
 */
export function StudioShell(p: ShellProps) {
  const [mode, setMode] = useState<ModeId>("play");
  const [query, setQuery] = useState("");
  const [hints, setHints] = useState(readHints);
  const [restart, setRestart] = useState(readRestart);
  const puzzle = p.puzzle as PuzzleId;
  const { changes, picks, refusals, report, scenario, store } = useFrame();
  const sections = useNumberSections();

  const changed = new Set<ModeId>(changes.map((c) => modeOfKey(sections, c.key) ?? "tuning"));
  if (Object.keys(picks.sprites).length > 0) changed.add("sprites");
  if (Object.keys(picks.sounds).length > 0) changed.add("sounds");

  const goto = useCallback((next: ModeId, target?: Target) => {
    setMode(next);
    setQuery("");
    if (!target) return;
    if (target.kind !== "number") window.dispatchEvent(new CustomEvent(ASSET_SELECT, { detail: target }));
    const id = target.kind === "number" ? `control-${target.key}` : target.kind === "sprites" ? `frame-${target.name}` : `cue-${target.name}`;
    // After the panel has turned to the mode: a hidden control has no place to scroll to.
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => flash(id)));
  }, []);

  const seed = report.seed ?? scenario.seed;
  return (
    <main className="studio" data-testid="studio" data-mode={mode}>
      <TopBar title={t(`${p.puzzle}.title`)} puzzle={puzzle} sections={sections} onGoto={goto} />
      <DraftBanner />

      <nav className="studio-rail st" role="tablist" aria-orientation="vertical" aria-label={t("studio.modes")}>
        {RAIL.map((id, i) =>
          id === null ? (
            <span key={i} className="rail-gap" aria-hidden="true" />
          ) : (
            <button key={id} type="button" role="tab" className="rail-btn" aria-selected={mode === id} aria-label={t(`studio.mode.${id}`)} data-tip={t(`studio.mode.${id}`)} onClick={() => goto(id)} data-testid={`tab-${id}`}>
              <ModeIcon mode={id} />
              {changed.has(id) && <i className="rail-dot" data-testid={`tab-dot-${id}`} />}
            </button>
          ),
        )}
      </nav>

      <aside className="studio-panel st" aria-label={t(`studio.mode.${mode}`)}>
        <header className="panel-head">
          <div>
            <h2>{t(`studio.mode.${mode}`)}</h2>
            <p>{t(`studio.mode_hint.${mode}`)}</p>
          </div>
          <div className="panel-tools" hidden={!isNumberMode(mode)} data-mode-panel="setup">
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("studio.find")} aria-label={t("studio.find")} data-testid="find" />
            <button
              type="button"
              className="btn btn-mini btn-sq"
              aria-pressed={hints}
              aria-label={t("studio.hints")}
              title={t("studio.hints")}
              onClick={() => {
                setHints(!hints);
                try {
                  window.localStorage.setItem(HINTS_KEY, hints ? "0" : "1");
                } catch {
                  /* private mode */
                }
              }}
              data-testid="toggle-hints"
            >
              ?
            </button>
            <label className="switch-label" title={t("studio.restart_on_change")}>
              {t("studio.redeal")}
              <input
                type="checkbox"
                role="switch"
                className="switch"
                checked={restart}
                aria-label={t("studio.restart_on_change")}
                onChange={(e) => {
                  setRestart(e.target.checked);
                  writeRestart(e.target.checked);
                }}
                data-testid="restart-on-change"
              />
            </label>
          </div>
        </header>
        <div className="panel-body">
          <LooseRefusals sections={sections} />
          <div hidden={mode !== "play"} data-mode-panel="play">
            <PlayPanel phase={p.phase} onStart={p.onStart} />
          </div>
          <NumbersPanel sections={sections} mode={mode} query={query} hints={hints} />
          <div hidden={mode !== "sprites"} data-mode-panel="sprites">
            <SpritePanel puzzle={puzzle} legend={p.legend} active={mode === "sprites"} />
          </div>
          <div hidden={mode !== "sounds"} data-mode-panel="sounds">
            <SoundPanel puzzle={puzzle} />
          </div>
        </div>
      </aside>

      <div className="studio-stage">
        <div className="studio-device">
          <PlayShell {...p} />
        </div>
      </div>

      <aside className="studio-rest st">{store.state === "stored" && store.canChat ? <ChatPanel /> : <p className="chat-off">{t("studio.chat.off")}</p>}</aside>

      <footer className="studio-status st" data-testid="studio-status">
        <span className={refusals.length > 0 ? "is-refused" : ""}>
          <i className={`status-dot ${refusals.length > 0 ? "is-refused" : ""}`} aria-hidden="true" />
          {refusals.length > 0 ? t("studio.status_refused") : t("studio.status_ok")}
        </span>
        <span className="mono">{seed ? t("play.seed", { seed }) : t("play.seed_fresh")}</span>
      </footer>
    </main>
  );
}
