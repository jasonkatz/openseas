import { useState } from "react";
import { PROTOTYPE_PUZZLE_IDS, type PuzzleId } from "@openseas/engine";
import { content, t } from "../content.js";
import { Figure } from "../Figure.jsx";
import { GUIDES, LEVELS, type Level, type Stage } from "../guides/index.js";
import { Rich } from "../Rich.jsx";
import { Link } from "../router.jsx";
import { Pager } from "../Shell.jsx";
import { guidePath } from "../site.js";
import { useTitle } from "./DocPage.jsx";

const SECTIONS = ["theme", "rules", "controls", "scoring", "opening", "ladder", "mistakes"] as const;

/** The rung the address names (`#expert`), or the first. */
function levelFromHash(): Level {
  const hash = window.location.hash.slice(1);
  return (LEVELS as readonly string[]).includes(hash) ? (hash as Level) : "beginner";
}

/** One puzzle's guide. Every guide has the same sections in the same order. */
export function GuidePage({ id }: { id: PuzzleId }) {
  const guide = GUIDES[id];
  const title = t(`${id}.title`);
  const prototype = (PROTOTYPE_PUZZLE_IDS as readonly string[]).includes(id);
  const [level, setLevel] = useState<Level>(levelFromHash);
  useTitle(title);

  const pick = (l: Level): void => {
    setLevel(l);
    window.history.replaceState(null, "", `#${l}`);
  };
  const stage = guide.stages.find((s) => s.level === level) ?? guide.stages[0];
  // The puzzle's own ladder of stages (ADR 0066), from content: a puzzle with none has no such section.
  const file = content.puzzles[id];
  const opening = "stages" in file && file.stages.length > 0 ? [...file.stages.map((s) => ({ id: s.id, seconds: s.roundSeconds })), { id: "full", seconds: file.roundSeconds }] : [];
  const sections = SECTIONS.filter((s) => s !== "opening" || opening.length > 0);

  return (
    <div className="guide" data-testid={`guide-page-${id}`}>
      <nav className="crumbs">
        <Link to="/puzzles" className="back" data-testid="back-home">
          ‹ {t("docs.all_guides")}
        </Link>
      </nav>

      <header className="guide-head">
        <div className="guide-head-text">
          <p className={`badge ${prototype ? "badge-prototype" : "badge-core"}`}>{t(prototype ? "docs.badge_prototype" : "docs.badge_core")}</p>
          <h1>{title}</h1>
          <p className="lede">{guide.tagline}</p>
          <dl className="facts">
            {guide.facts.map((f) => (
              <div key={f.label}>
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
          <nav className="jump" aria-label={t("docs.jump")}>
            {sections.map((s) => (
              <a key={s} href={`#${s}`}>
                {t(`docs.section_${s}`)}
              </a>
            ))}
          </nav>
        </div>
        <Figure puzzle={id} media={guide.hero} eager />
      </header>

      <section id="theme" className="block">
        <h2>{t("docs.section_theme")}</h2>
        <p>
          <Rich text={guide.theme.setting} />
        </p>
        <h3>{t(prototype ? "docs.section_purpose_prototype" : "docs.section_purpose")}</h3>
        <p>
          <Rich text={guide.theme.purpose} />
        </p>
      </section>

      <section id="rules" className={`block ${guide.rulesMedia ? "with-figure" : ""}`}>
        <div>
          <h2>{t("docs.section_rules")}</h2>
          <ol className="rules">
            {guide.rules.map((r) => (
              <li key={r}>
                <Rich text={r} />
              </li>
            ))}
          </ol>
        </div>
        {guide.rulesMedia && <Figure puzzle={id} media={guide.rulesMedia} />}
      </section>

      <section id="controls" className="block">
        <h2>{t("docs.section_controls")}</h2>
        <div className="table-scroll">
          <table className="controls">
            <thead>
              <tr>
                <th scope="col">{t("docs.controls_action")}</th>
                <th scope="col">{t("docs.controls_touch")}</th>
                <th scope="col">{t("docs.controls_desktop")}</th>
              </tr>
            </thead>
            <tbody>
              {guide.controls.map((c) => (
                <tr key={c.action}>
                  <th scope="row">{c.action}</th>
                  <td>{c.touch || "—"}</td>
                  <td>{c.desktop || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="scoring" className="block">
        <h2>{t("docs.section_scoring")}</h2>
        <ul className="plain">
          {guide.scoring.map((s) => (
            <li key={s}>
              <Rich text={s} />
            </li>
          ))}
        </ul>
      </section>

      {opening.length > 0 && (
        <section id="opening" className="block" data-testid="guide-opening">
          <h2>{t("docs.section_opening")}</h2>
          <p className="muted">{t("docs.opening_blurb")}</p>
          <ol className="rules">
            {opening.map((s) => (
              <li key={s.id} data-stage={s.id}>
                <b>{t(`${id}.stage.${s.id}`)}</b> <span className="muted">{t("docs.opening_seconds", { seconds: s.seconds })}</span>. {t(`${id}.stage.${s.id}_intro`)}
                {guide.stageMedia?.[s.id] && <Figure puzzle={id} media={guide.stageMedia[s.id]!} />}
              </li>
            ))}
          </ol>
        </section>
      )}

      <section id="ladder" className="block ladder">
        <h2>{t("docs.section_ladder")}</h2>
        <p className="muted">{t("docs.ladder_blurb")}</p>
        <div className="rungs" role="tablist" aria-label={t("docs.section_ladder")}>
          {LEVELS.map((l, i) => (
            <button key={l} type="button" role="tab" id={`tab-${l}`} aria-selected={l === level} aria-controls="rung" className="rung-tab" data-testid={`level-${l}`} onClick={() => pick(l)}>
              <span className="rung-n">{i + 1}</span>
              {t(`docs.level.${l}`)}
            </button>
          ))}
        </div>
        <StageView key={stage.level} id={id} stage={stage} />
        {level !== "expert" && (
          <button type="button" className="next-rung" onClick={() => pick(LEVELS[LEVELS.indexOf(level) + 1]!)}>
            {t("docs.next")}: {t(`docs.level.${LEVELS[LEVELS.indexOf(level) + 1]!}`)} ›
          </button>
        )}
      </section>

      <section id="mistakes" className="block">
        <h2>{t("docs.section_mistakes")}</h2>
        <ul className="plain mistakes">
          {guide.mistakes.map((m) => (
            <li key={m}>
              <Rich text={m} />
            </li>
          ))}
        </ul>
      </section>

      <Pager area="guides" path={guidePath(id)} />
    </div>
  );
}

function StageView({ id, stage }: { id: PuzzleId; stage: Stage }) {
  return (
    <div id="rung" role="tabpanel" aria-labelledby={`tab-${stage.level}`} className="rung" data-testid="rung">
      <p className="goal">
        <span className="tag">{t("docs.goal")}</span>
        <Rich text={stage.goal} />
      </p>
      {stage.tips.map((tip) => (
        <article key={tip.title} className={`tip ${tip.media ? "with-figure" : ""}`}>
          <div>
            <h3>{tip.title}</h3>
            <p>
              <Rich text={tip.body} />
            </p>
          </div>
          {tip.media && <Figure puzzle={id} media={tip.media} />}
        </article>
      ))}
      <p className="drill">
        <span className="tag">{t("docs.drill")}</span>
        <Rich text={stage.drill} />
      </p>
    </div>
  );
}
