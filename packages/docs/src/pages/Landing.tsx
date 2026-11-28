import type { ReactNode } from "react";
import { CORE_PUZZLE_IDS, type PuzzleId } from "@openseas/engine";
import { t } from "../content.js";
import { mediaUrl } from "../Figure.jsx";
import { GUIDES } from "../guides/index.js";
import { Link } from "../router.jsx";
import { guidePath, type Area } from "../site.js";
import { useTitle } from "./DocPage.jsx";

/** Line drawings on the pieces' 24 unit square, one for each area. */
const ICONS: Record<Area, ReactNode> = {
  domain: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <circle cx="17" cy="17" r="3.5" />
    </>
  ),
  guides: <path d="M3.5 20.5h5v-5h5v-5h5v-5h2" />,
  reference: <path d="M9 4C7 4 6.5 5 6.5 7v2.5C6.5 11 5.5 12 4 12c1.5 0 2.5 1 2.5 2.5V17c0 2 .5 3 2.5 3M15 4c2 0 2.5 1 2.5 3v2.5c0 1.5 1 2.5 2.5 2.5-1.5 0-2.5 1-2.5 2.5V17c0 2-.5 3-2.5 3" />,
  puzzles: <path d="M7 3v18M17 3v18M7 7.5h10M7 12h10M7 16.5h10" />,
};

interface AreaCard {
  readonly id: Area;
  readonly links: readonly { to: string; label: string }[];
}

const CARDS: readonly AreaCard[] = [
  { id: "domain", links: [{ to: "/domain", label: "docs.home.domain_1" }, { to: "/domain/round", label: "docs.home.domain_2" }, { to: "/domain/glossary", label: "docs.home.domain_3" }] },
  { id: "guides", links: [{ to: "/guides", label: "docs.home.guides_1" }, { to: "/guides/quickstart", label: "docs.home.guides_2" }, { to: "/guides/write-a-puzzle", label: "docs.home.guides_3" }] },
  { id: "reference", links: [{ to: "/reference/puzzle", label: "docs.home.reference_1" }, { to: "/reference/hooks", label: "docs.home.reference_2" }, { to: "/reference/types", label: "docs.home.reference_3" }] },
  { id: "puzzles", links: [{ to: "/puzzles", label: "docs.home.puzzles_1" }, { to: "/puzzles/cooling", label: "docs.home.puzzles_2" }, { to: "/puzzles/salvage", label: "docs.home.puzzles_3" }] },
];

const STEPS = [
  { to: "/domain", n: 1 },
  { to: "/guides/write-a-puzzle", n: 2 },
  { to: "/reference", n: 3 },
] as const;

function Thumb({ id }: { id: PuzzleId }) {
  return (
    <li>
      <Link to={guidePath(id)} className="thumb">
        <img src={mediaUrl(id, GUIDES[id].hero.name, "webp")} alt="" loading="lazy" decoding="async" />
        <span>{t(`${id}.title`)}</span>
      </Link>
    </li>
  );
}

/** The front page: what the site is, its four areas, and where to start. */
export function Landing() {
  useTitle("");
  return (
    <div className="landing" data-testid="landing">
      <header className="hero">
        <p className="eyebrow">{t("docs.home.eyebrow")}</p>
        <h1>{t("docs.home.title")}</h1>
        <p className="lede">{t("docs.home.lede")}</p>
        <div className="hero-go">
          <Link to="/domain" className="button button-go" data-testid="start">{t("docs.home.start")}</Link>
          <Link to="/guides/write-a-puzzle" className="button">{t("docs.home.write")}</Link>
        </div>
      </header>

      <ul className="area-cards">
        {CARDS.map((card) => (
          <li key={card.id} className="area-card" data-testid={`card-${card.id}`}>
            <svg className="area-icon" viewBox="0 0 24 24" aria-hidden="true">{ICONS[card.id]}</svg>
            <h2>
              <Link to={`/${card.id}`}>{t(`docs.area.${card.id}`)}</Link>
            </h2>
            <p>{t(`docs.home.${card.id}_blurb`)}</p>
            <ul>
              {card.links.map((l) => (
                <li key={l.to}>
                  <Link to={l.to}>{t(l.label)}</Link>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      <section className="path">
        <h2>{t("docs.home.path_title")}</h2>
        <p className="muted">{t("docs.home.path_blurb")}</p>
        <ol>
          {STEPS.map((s) => (
            <li key={s.n}>
              <Link to={s.to} className="step">
                <span className="step-n">{s.n}</span>
                <b>{t(`docs.home.step_${s.n}`)}</b>
                <span>{t(`docs.home.step_${s.n}_blurb`)}</span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <section className="strip">
        <div className="strip-head">
          <h2>{t("docs.home.strip_title")}</h2>
          <Link to="/puzzles">{t("docs.home.strip_all")}</Link>
        </div>
        <ul>
          {CORE_PUZZLE_IDS.map((id) => (
            <Thumb key={id} id={id} />
          ))}
        </ul>
      </section>
    </div>
  );
}
