import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import type { PuzzleId } from "@openseas/engine";
import { wordCount } from "@openseas/protocol";
import { messageOverrideRevision, pieceOverrideRevision, subscribeMessages, subscribePieces, t } from "@openseas/boards";
import { SoundPanel } from "../assets/SoundPanel.jsx";
import { SpritePanel } from "../assets/SpritePanel.jsx";
import { useFrame } from "../frame/RoundFrame.jsx";
import { PlayShell } from "../play/PlayShell.jsx";
import type { ShellProps } from "../practice/PracticeShell.jsx";
import { ChatPanel } from "../service/ChatPanel.jsx";
import { DraftBanner } from "../service/DraftSection.jsx";
import { LooseRefusals, NumbersPanel, anyNumberMatch, modeOfKey, useNumberSections } from "../tuning/TuningPanel.jsx";
import { ModeIcon, Tool } from "./icons.jsx";
import { RAIL, isNumberMode, type ModeId } from "./modes.js";
import { PlayPanel } from "./PlayPanel.jsx";
import { TextPanel, textMatches, useTextEntries } from "./TextPanel.jsx";
import { TopBar, type Target } from "./TopBar.jsx";
import { Transport, useAltKey } from "./Transport.jsx";
import { useRoundClock } from "./roundClock.js";
import { readRestart, writeRestart } from "./useStudio.js";
import { WidePanel, canWiden, isWide, readWide, writeWide } from "./wide.js";
import { useWideMotion } from "./wideMotion.js";

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
 * A puzzle's studio page (DESIGN.md 3.14, ADR 0056, ADR 0068), laid out for a desktop as a design tool is.
 * A bar across the top says where the page is and what becomes of the draft. A rail down the left
 * edge picks a mode, and the panel beside it is that mode's: the round, the numbers in three
 * parts, the pieces and the sounds (ADR 0065), the words (ADR 0057). The board stands in the middle at a phone's proportions,
 * exactly as `/play` draws it, with the transport bar under it that plays the round from any mode.
 * Any mode but Play can open its panel wide over the middle: the board then moves to the top of the
 * right-hand column, still live, and the chat takes the bottom. The board is one element in every
 * layout, so the round on it carries on through a change of mode or width. The chat is on the right (ADR 0047). Every panel
 * stays in the page while one shows, so a file being tried or a value half typed outlasts a look
 * at another. A phone never sees this: it gets the puzzle alone (App.tsx).
 */
export function StudioShell(p: ShellProps) {
  const [mode, setMode] = useState<ModeId>("play");
  const [query, setQuery] = useState("");
  const [hints, setHints] = useState(readHints);
  const [restart, setRestart] = useState(readRestart);
  const [wide, setWideState] = useState(readWide);
  const widened = isWide(wide, mode);
  const toggleWide = (): void => {
    if (!canWiden(mode)) return;
    setWideState(!wide);
    writeWide(!wide);
  };
  useAltKey("Backslash", toggleWide);
  const stage = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const rest = useRef<HTMLElement>(null);
  useWideMotion(widened, panel, stage, rest);
  const { paused, clock } = useRoundClock();
  const held = p.phase === "playing" && paused;
  const puzzle = p.puzzle as PuzzleId;
  const { changes, refusals, report, scenario, store } = useFrame();
  const sections = useNumberSections();
  // The page says the draft's words too (ADR 0057): it is drawn again when they are laid over the message table.
  useSyncExternalStore(subscribeMessages, messageOverrideRevision, () => 0);
  // And its pieces: a legend draws them, and is drawn again when one is redrawn (ADR 0065).
  useSyncExternalStore(subscribePieces, pieceOverrideRevision, () => 0);
  const [piece, setPiece] = useState<string | null>(null);
  const [cue, setCue] = useState<string | null>(null);
  const texts = useTextEntries();
  // One search over everything typed into a panel: the numbers of three modes, and the words.
  const searchable = isNumberMode(mode) || mode === "text";
  const q = searchable ? query.trim().toLowerCase() : "";
  const found = q === "" || anyNumberMatch(sections, q) || texts.some((e) => textMatches(e, scenario.words.texts[e.key] ?? e.shipped, q)) || "category".includes(q);

  const changed = new Set<ModeId>(changes.map((c) => modeOfKey(sections, c.key) ?? "tuning"));
  if (wordCount(scenario) > 0) changed.add("text");
  if (Object.keys(scenario.look.pieces).length > 0) changed.add("sprites");
  if (Object.keys(scenario.look.cues).length > 0) changed.add("sounds");

  const goto = useCallback((next: ModeId, target?: Target) => {
    setMode(next);
    setQuery("");
    if (!target) return;
    if (target.kind === "piece") return setPiece(target.key);
    if (target.kind === "cue") return setCue(target.key);
    const id = target.kind === "number" ? `control-${target.key}` : target.kind === "text" ? `text-${target.key}` : "control-category";
    // After the panel has turned to the mode: a hidden control has no place to scroll to.
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => flash(id)));
  }, []);

  const seed = report.seed ?? scenario.seed;
  return (
    <main className={`studio ${widened ? "is-wide" : ""}`} data-testid="studio" data-mode={mode} data-wide={widened ? "1" : "0"}>
      <TopBar title={t(`${p.puzzle}.title`)} puzzle={puzzle} sections={sections} texts={texts} onGoto={goto} />
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

      <aside ref={panel} className="studio-panel st" aria-label={t(`studio.mode.${mode}`)}>
        <header className="panel-head">
          <div className="panel-title">
            <div>
              <h2>{t(`studio.mode.${mode}`)}</h2>
              <p>{t(`studio.mode_hint.${mode}`)}</p>
            </div>
            {canWiden(mode) && (
              <button
                type="button"
                className="btn btn-mini btn-sq btn-quiet"
                aria-pressed={widened}
                aria-label={widened ? t("studio.wide.close") : t("studio.wide.open")}
                title={`${widened ? t("studio.wide.close") : t("studio.wide.open")} · Alt \\`}
                onClick={toggleWide}
                data-testid="panel-wide"
              >
                <Tool icon={widened ? "collapse" : "expand"} />
              </button>
            )}
          </div>
          <div className="panel-tools" hidden={!searchable} data-mode-panel="setup">
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("studio.find")} aria-label={t("studio.find")} data-testid="find" />
            <button
              type="button"
              className="btn btn-mini btn-sq"
              hidden={mode === "text"}
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
            <label className="switch-label" title={t("studio.restart_on_change")} hidden={mode === "text"}>
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
        <WidePanel.Provider value={widened}>
          <div className="panel-body">
            <LooseRefusals sections={sections} />
            <div hidden={mode !== "play"} data-mode-panel="play">
              <PlayPanel onStart={p.onStart} />
            </div>
            <NumbersPanel sections={sections} mode={mode} query={q} hints={hints} shown={isNumberMode(mode) || (mode === "text" && q !== "")} />
            <TextPanel entries={texts} query={q} shown={mode === "text" || (isNumberMode(mode) && q !== "")} />
            {!found && (
              <p className="panel-empty" data-testid="find-none">
                {t("studio.find_none", { query: query.trim() })}
              </p>
            )}
            <div hidden={mode !== "sprites"} data-mode-panel="sprites">
              <SpritePanel puzzle={puzzle} focus={piece} onFocus={setPiece} />
            </div>
            <div hidden={mode !== "sounds"} data-mode-panel="sounds">
              <SoundPanel puzzle={puzzle} focus={cue} onFocus={setCue} />
            </div>
          </div>
        </WidePanel.Provider>
      </aside>

      <div ref={stage} className="studio-stage">
        <div className="studio-device">
          <PlayShell {...p} />
          {held && (
            <button type="button" className="studio-held" onClick={() => clock?.resume()} aria-label={t("studio.transport.resume")} data-testid="held">
              <span>{t("studio.transport.held")}</span>
            </button>
          )}
        </div>
        <Transport phase={p.phase} onStart={p.onStart} ready={p.ready} />
      </div>

      <aside ref={rest} className="studio-rest st">{store.state === "stored" && store.canChat ? <ChatPanel /> : <p className="chat-off">{t("studio.chat.off")}</p>}</aside>

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
