import type { PirateLookWire, PirateSheet as SheetData, PirateSummary, TitleProgress } from "@openseas/protocol";
import { content, t, usePirate } from "@openseas/boards";
import { Flag } from "../crew/Flag.jsx";
import { RankChip } from "../crew/CrewPanel.jsx";
import { useSheet, type SheetTab } from "../state/SheetProvider.jsx";
import { lookFor, pirateRules, randomLook, titleAsks, titleName, titleOf } from "./look.js";
import { Portrait } from "./Portrait.jsx";

/**
 * The pirate's own sheet (DESIGN.md 3.6): who they are on deck, what their record says and the
 * titles it has earned. It opens over the scene from their name in the top bar, the same everywhere,
 * like the menu and the crew card (DESIGN.md 3.11).
 */
export function PirateSheet() {
  const { pirate } = usePirate();
  const { tab, openSheet, closeSheet, sheet, error } = useSheet();
  if (!tab || !pirate) return null;
  const look = lookFor(pirate.id, pirate.look);
  const title = titleName(pirate.title);
  return (
    <>
      <button className="scrim" aria-label={t("menu.close")} onClick={closeSheet} />
      <section className="card menu pirate-sheet" role="dialog" aria-label={t("sheet.title")} data-testid="pirate-sheet">
        <button className="icon-btn dialog-close" onClick={closeSheet} aria-label={t("menu.close")} data-testid="sheet-close">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        <header className="sheet-id">
          <Portrait look={look} size={76} name={pirate.name} />
          <div className="sheet-id-text">
            <h2 data-testid="sheet-name">{pirate.name}</h2>
            {title && (
              <p className="pirate-title" data-testid="sheet-shown-title">
                {title}
              </p>
            )}
            {pirate.crew ? (
              <p className="profile-crew small">
                <Flag flag={pirate.crew.flag} size={20} /> <b>{pirate.crew.name}</b> <RankChip rank={pirate.crew.rank} />
              </p>
            ) : (
              <p className="muted small">{t("profile.no_crew")}</p>
            )}
          </div>
        </header>
        <Tabs tab={tab} onTab={openSheet} />
        {error && (
          <p className="error small" role="alert" data-testid="sheet-error">
            {t(`error.${error}`)}
          </p>
        )}
        {tab === "pirate" && <IdentityTab pirate={pirate} look={look} sheet={sheet} />}
        {tab === "record" && <RecordTab pirate={pirate} sheet={sheet} />}
        {tab === "titles" && <TitlesTab pirate={pirate} sheet={sheet} />}
      </section>
    </>
  );
}

function Tabs({ tab, onTab }: { tab: SheetTab; onTab(tab: SheetTab): void }) {
  const items: { id: SheetTab; label: string }[] = [
    { id: "pirate", label: t("sheet.tab_pirate") },
    { id: "record", label: t("sheet.tab_record") },
    { id: "titles", label: t("sheet.tab_titles") },
  ];
  return (
    <div className="tabs" role="tablist">
      {items.map((i) => (
        <button key={i.id} role="tab" aria-selected={tab === i.id} className={`tab ${tab === i.id ? "is-on" : ""}`} onClick={() => onTab(i.id)} data-testid={`sheet-tab-${i.id}`}>
          {i.label}
        </button>
      ))}
    </div>
  );
}

/** The look and the title: the two things a pirate chooses about themselves. */
function IdentityTab({ pirate, look, sheet }: { pirate: PirateSummary; look: PirateLookWire; sheet: SheetData | null }) {
  const { setLook, setTitle } = useSheet();
  // The start titles are every pirate's; the rest wait for the sheet to say which are earned.
  const earned = pirateRules.titles.filter((x) => x.requires.kind === "start" || sheet?.titles.some((p) => p.id === x.id && p.earned));
  return (
    <>
      <div className="section">
        <div className="row between">
          <h3 className="section-head">{t("sheet.look")}</h3>
          <button type="button" className="btn btn-ghost btn-small dice-btn" onClick={() => setLook(randomLook(look))} data-testid="look-dice">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
              <rect x="4" y="4" width="16" height="16" rx="3.5" />
              <circle cx="9" cy="9" r="1.3" fill="currentColor" />
              <circle cx="15" cy="15" r="1.3" fill="currentColor" />
              <circle cx="15" cy="9" r="1.3" fill="currentColor" />
              <circle cx="9" cy="15" r="1.3" fill="currentColor" />
            </svg>
            {t("sheet.dice")}
          </button>
        </div>
        <p className="muted small">{t("sheet.look_hint")}</p>
        <fieldset className="flag-row">
          <legend>{t("sheet.jacket")}</legend>
          <div className="swatches look-jackets" role="radiogroup" aria-label={t("sheet.jacket")}>
            {pirateRules.jackets.map((c) => {
              const on = look.jacket === c.id;
              return (
                <button
                  type="button"
                  key={c.id}
                  role="radio"
                  aria-checked={on}
                  className={`jacket-swatch ${on ? "is-on" : ""}`}
                  onClick={() => !on && setLook({ ...look, jacket: c.id })}
                  data-testid={`look-jacket-${c.id}`}
                >
                  <i style={{ background: c.hex }} aria-hidden="true" />
                  <span>{t(c.nameKey)}</span>
                </button>
              );
            })}
          </div>
        </fieldset>
        <fieldset className="flag-row">
          <legend>{t("sheet.headgear")}</legend>
          <div className="flag-choices look-headgear" role="radiogroup" aria-label={t("sheet.headgear")}>
            {pirateRules.headgear.map((h) => {
              const on = look.headgear === h.id;
              return (
                <button
                  type="button"
                  key={h.id}
                  role="radio"
                  aria-checked={on}
                  className={`flag-choice headgear-choice ${on ? "is-on" : ""}`}
                  onClick={() => !on && setLook({ ...look, headgear: h.id })}
                  data-testid={`look-headgear-${h.id}`}
                >
                  <Portrait look={{ ...look, headgear: h.id }} size={42} />
                  <span>{t(h.nameKey)}</span>
                </button>
              );
            })}
          </div>
        </fieldset>
      </div>
      <div className="section">
        <h3 className="section-head">{t("sheet.title_head")}</h3>
        <div className="title-picks" role="radiogroup" aria-label={t("sheet.title_head")}>
          <button type="button" role="radio" aria-checked={pirate.title === null} className={`title-pick ${pirate.title === null ? "is-on" : ""}`} onClick={() => pirate.title !== null && setTitle(null)} data-testid="sheet-title-none">
            {t("sheet.no_title")}
          </button>
          {earned.map((x) => {
            const on = pirate.title === x.id;
            return (
              <button type="button" key={x.id} role="radio" aria-checked={on} className={`title-pick ${on ? "is-on" : ""}`} onClick={() => !on && setTitle(x.id)} data-testid={`sheet-title-${x.id}`}>
                {t(x.nameKey)}
              </button>
            );
          })}
        </div>
        <p className="muted small">{t("sheet.title_hint")}</p>
      </div>
      <p className="muted small colophon-line">{t("sheet.to_menu")}</p>
    </>
  );
}

/** What the pirate has done: the record off the voyage tables and the ledger, and their standing. */
function RecordTab({ pirate, sheet }: { pirate: PirateSummary; sheet: SheetData | null }) {
  if (!sheet) return <p className="muted small">{t("sheet.loading")}</p>;
  const r = sheet.record;
  const since = new Date(r.since).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
  const stats: { key: string; value: number; label: string }[] = [
    { key: "voyages", value: r.voyages, label: t("sheet.stat_voyages") },
    { key: "captained", value: r.captained, label: t("sheet.stat_captained") },
    { key: "victories", value: r.victories, label: t("sheet.stat_victories") },
    { key: "plunder", value: r.plunder, label: t("sheet.stat_plunder") },
    { key: "boards", value: r.boards, label: t("sheet.stat_boards") },
    { key: "ships", value: pirate.ships.length, label: t("sheet.stat_ships") },
  ];
  // Standing in the order the game lists its puzzles, not the order it was earned in.
  const order = Object.keys(content.puzzles);
  const ratings = [...pirate.ratings].sort((a, b) => order.indexOf(a.puzzle) - order.indexOf(b.puzzle));
  return (
    <div className="section" data-testid="sheet-record">
      <p className="muted small">{t("sheet.since", { date: since })}</p>
      <ul className="crew-stats sheet-stats">
        {stats.map((s) => (
          <li key={s.key} data-testid={`sheet-stat-${s.key}`}>
            <b>{s.value}</b>
            <small>{s.label}</small>
          </li>
        ))}
      </ul>
      <h3 className="section-head">{t("sheet.standing")}</h3>
      {ratings.length === 0 ? (
        <p className="muted small">{t("sheet.no_standing")}</p>
      ) : (
        <ul className="sheet-standing">
          {ratings.map((x) => (
            <li key={x.puzzle}>
              <span>{t(`home.practice_${x.puzzle}`)}</span>
              <span className="tier-chip">{t(`tier.${x.tier}`)}</span>
              <small className="muted">{x.rounds === 1 ? t("sheet.boards_one") : t("sheet.boards", { count: x.rounds })}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Every title, earned or not, with what it asks and how far along the pirate is: something to chase. */
function TitlesTab({ pirate, sheet }: { pirate: PirateSummary; sheet: SheetData | null }) {
  const { setTitle } = useSheet();
  if (!sheet) return <p className="muted small">{t("sheet.loading")}</p>;
  const count = sheet.titles.filter((x) => x.earned).length;
  return (
    <div className="section">
      <p className="muted small" data-testid="sheet-titles-count">
        {t("sheet.titles_earned", { count, total: sheet.titles.length })}
      </p>
      <ul className="title-list">
        {sheet.titles.map((p) => {
          const title = titleOf(p.id);
          if (!title) return null;
          const wearing = pirate.title === p.id;
          return (
            <li key={p.id} className={p.earned ? "is-earned" : ""} data-testid={`title-${p.id}`} data-earned={p.earned ? "1" : "0"}>
              <span className="title-mark" aria-hidden="true">
                {p.earned ? (
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12.5l4.5 4.5L19 7" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
                    <rect x="5" y="11" width="14" height="9" rx="2" />
                    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                  </svg>
                )}
              </span>
              <span className="title-text">
                <b>{t(title.nameKey)}</b>
                <small className="muted">{titleAsks(title)}</small>
                {!p.earned && <Progress p={p} kind={title.requires.kind} />}
              </span>
              {p.earned &&
                (wearing ? (
                  <span className="title-state">{t("sheet.wearing")}</span>
                ) : (
                  <button type="button" className="btn btn-ghost btn-small" onClick={() => setTitle(p.id)} data-testid={`title-wear-${p.id}`}>
                    {t("sheet.wear")}
                  </button>
                ))}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Progress({ p, kind }: { p: TitleProgress; kind: string }) {
  if (kind === "standing") {
    const tier = p.have >= 0 ? content.ratingTiers[p.have] : undefined;
    return <small className="title-progress">{tier ? t("sheet.progress_tier", { tier: t(tier.nameKey) }) : t("sheet.progress_unrated")}</small>;
  }
  const share = p.need > 0 ? Math.min(1, p.have / p.need) : 0;
  return (
    <small className="title-progress">
      <span className="title-bar" aria-hidden="true">
        <i style={{ width: `${Math.round(share * 100)}%` }} />
      </span>
      {t("sheet.progress", { have: p.have, need: p.need })}
    </small>
  );
}
