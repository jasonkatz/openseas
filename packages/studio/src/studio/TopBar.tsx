import { useEffect, useState } from "react";
import { CORE_PUZZLE_IDS, PROTOTYPE_PUZZLE_IDS, type PuzzleId } from "@openseas/engine";
import { pickCount } from "@openseas/protocol";
import { t } from "@openseas/boards";
import { useFrame } from "../frame/RoundFrame.jsx";
import { formatNumber } from "../frame/numbers.js";
import { Link } from "../router.jsx";
import { playLink } from "../scenario/codec.js";
import { DraftDiscard, DraftStatus, SaveControl } from "../service/DraftSection.jsx";
import { TesterLinks } from "../service/TesterLinks.jsx";
import { ResetIcon, modeOfKey, type NumberSection } from "../tuning/TuningPanel.jsx";
import { Caret, ModeIcon } from "./icons.jsx";
import { Menu, MenuButton, useMenu } from "./Menu.jsx";
import { humanize, type ModeId } from "./modes.js";

/** Where a change is made: a number's control by its key, or a frame's or a cue's row. */
export type Target = { readonly kind: "number"; readonly key: string } | { readonly kind: "sprites" | "sounds"; readonly name: string };

/**
 * The studio's top bar (DESIGN.md 3.14, ADR 0056). On its left, where the page is: the way back,
 * the puzzle and a menu of the others, and what the draft changes. On its right, what becomes of
 * the draft: whether the service has it, the ways to pass it on, and Save.
 */
export function TopBar({ title, puzzle, sections, onGoto }: { title: string; puzzle: PuzzleId; sections: readonly NumberSection[]; onGoto(mode: ModeId, target?: Target): void }) {
  return (
    <header className="studio-top st">
      <div className="top-side">
        <Link to="/" className="btn btn-mini btn-quiet btn-sq" aria-label={t("app.back")} title={t("app.back")}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
        <PuzzleMenu title={title} puzzle={puzzle} />
        <ChangedChip sections={sections} onGoto={onGoto} />
      </div>
      <div className="top-side">
        <DraftStatus />
        <ShareMenu />
        <SaveControl />
      </div>
    </header>
  );
}

/** The puzzle on the page, and every other puzzle a tap away: the game's, then the prototypes. */
function PuzzleMenu({ title, puzzle }: { title: string; puzzle: PuzzleId }) {
  const menu = useMenu();
  const item = (id: PuzzleId) => (
    <Link key={id} to={`/${id}`} className="menu-item" aria-current={id === puzzle ? "page" : undefined} onClick={() => menu.setOpen(false)} data-testid={`goto-${id}`}>
      {t(`home.practice_${id}`)}
    </Link>
  );
  return (
    <Menu
      id="puzzle"
      menu={menu}
      trigger={
        <h1 className="top-title">
          <MenuButton id="puzzle" menu={menu} className="top-title-btn">
            <span className="puzzle-title">{title}</span>
            <Caret />
          </MenuButton>
        </h1>
      }
    >
      <nav className="menu-list" aria-label={t("studio.menu.puzzles")}>
        <span className="stat-label">{t("studio.menu.puzzles")}</span>
        {CORE_PUZZLE_IDS.map(item)}
        <span className="stat-label">{t("studio.menu.prototypes")}</span>
        {PROTOTYPE_PUZZLE_IDS.map(item)}
      </nav>
    </Menu>
  );
}

/**
 * What the draft changes from the shipped puzzle, as a count that opens the list: each number
 * with its value and the shipped one, each picked take, a way to its control, a button that puts
 * it back, and one that puts everything back. While the server would refuse the draft it says so.
 */
function ChangedChip({ sections, onGoto }: { sections: readonly NumberSection[]; onGoto(mode: ModeId, target?: Target): void }) {
  const menu = useMenu();
  const { scenario, changes, refusals, picks, resetNumber, resetNumbers, setPick } = useFrame();
  const picked = pickCount(scenario);
  const count = changes.length + picked;
  const refused = refusals.length > 0;
  const go = (mode: ModeId, target: Target): void => {
    menu.setOpen(false);
    onGoto(mode, target);
  };
  const pickRows = (kind: "sprites" | "sounds") =>
    Object.keys(picks[kind]).map((name) => (
      <li key={`${kind}/${name}`} data-testid={`change-${kind}-${name}`}>
        <button type="button" className="menu-item" onClick={() => go(kind, { kind, name })}>
          <ModeIcon mode={kind} size={15} />
          <span className="change-name">{name}</span>
          <span className="muted">{t(`studio.change.${kind}`)}</span>
        </button>
        <button type="button" className="num-reset" onClick={() => setPick(kind, name, null)} aria-label={t("studio.assets.put_back")} title={t("studio.assets.put_back")}>
          <ResetIcon />
        </button>
      </li>
    ));
  return (
    <Menu
      id="changes"
      menu={menu}
      trigger={
        <MenuButton id="changes" menu={menu} className={`chip ${refused ? "is-refused" : count > 0 ? "is-changed" : ""}`} data-testid="changed-count">
          {refused ? t("studio.chip_refused") : count === 0 ? t("studio.chip_none") : t("studio.chip_changed", { count })}
          <Caret />
        </MenuButton>
      }
    >
      <div className="menu-sec">
        <span className="stat-label">{t("studio.changes_title")}</span>
        {refused && <p className="tune-refusal">{t("studio.refused_note")}</p>}
        {count === 0 ? (
          <p className="muted small">{t("studio.changed_none")}</p>
        ) : (
          <ul className="changes" data-testid="changes">
            {changes.map((c) => {
              const mode = modeOfKey(sections, c.key) ?? "tuning";
              return (
                <li key={c.key} data-testid={`change-${c.key}`}>
                  <button type="button" className="menu-item" title={c.key} onClick={() => go(mode, { kind: "number", key: c.key })}>
                    <ModeIcon mode={mode} size={15} />
                    <span className="change-name">{humanize(c.key.slice(c.key.lastIndexOf(".") + 1))}</span>
                    <b className="mono">{formatNumber(c.key, c.value)}</b>
                    <span className="muted mono">{formatNumber(c.key, c.shipped)}</span>
                  </button>
                  <button type="button" className="num-reset" onClick={() => resetNumber(c.key)} aria-label={t("studio.reset_one", { key: c.key, value: formatNumber(c.key, c.shipped) })} title={t("studio.reset_one", { key: c.key, value: formatNumber(c.key, c.shipped) })}>
                    <ResetIcon />
                  </button>
                </li>
              );
            })}
            {pickRows("sprites")}
            {pickRows("sounds")}
          </ul>
        )}
        <div className="tune-actions">
          <button type="button" className="btn btn-mini" disabled={count === 0 && !refused} onClick={resetNumbers} data-testid="reset-all">
            {t("studio.reset_all")}
          </button>
        </div>
      </div>
    </Menu>
  );
}

/** The ways to pass the draft on: the play link that carries it in its address, the tester links the service freezes, and, for the owner, discarding it. */
function ShareMenu() {
  const menu = useMenu();
  const { puzzle, scenario, refusals } = useFrame();
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(null), 1500);
    return () => window.clearTimeout(id);
  }, [copied]);
  const copy = (): void =>
    void navigator.clipboard.writeText(playLink(window.location.origin, puzzle.id, scenario)).then(
      () => setCopied(t("studio.copied")),
      () => setCopied(t("studio.copy_failed")),
    );
  return (
    <Menu
      id="share"
      menu={menu}
      align="right"
      trigger={
        <MenuButton id="share" menu={menu} className="btn btn-mini">
          {t("studio.share")}
          <Caret />
        </MenuButton>
      }
    >
      <section className="menu-sec">
        <span className="stat-label">{t("studio.share_play_link")}</span>
        <div className="tune-actions">
          <button type="button" className="btn btn-mini" disabled={refusals.length > 0} onClick={copy} data-testid="copy-play-link">
            {copied ?? t("studio.copy_play_link")}
          </button>
        </div>
        <p className="muted small">{t("studio.share_play_link_note")}</p>
      </section>
      <TesterLinks />
      <DraftDiscard />
    </Menu>
  );
}
