import { CORE_PUZZLE_IDS, PROTOTYPE_PUZZLE_IDS, type PuzzleId } from "@openseas/engine";
import { t } from "../content.js";
import { mediaUrl } from "../Figure.jsx";
import { GUIDES } from "../guides/index.js";
import { Link } from "../router.jsx";

function Card({ id }: { id: PuzzleId }) {
  const guide = GUIDES[id];
  return (
    <li>
      <Link to={`/${id}`} className="card" data-testid={`guide-${id}`}>
        <span className="card-thumb">
          <img src={mediaUrl(id, guide.hero.name, "webp")} alt="" loading="lazy" decoding="async" />
        </span>
        <span className="card-text">
          <span className="card-title">{t(`${id}.title`)}</span>
          <span className="card-tagline">{guide.tagline}</span>
        </span>
      </Link>
    </li>
  );
}

function Shelf({ heading, blurb, ids }: { heading: string; blurb: string; ids: readonly PuzzleId[] }) {
  return (
    <section className="shelf">
      <h2>{heading}</h2>
      <p className="muted">{blurb}</p>
      <ul className="cards">
        {ids.map((id) => (
          <Card key={id} id={id} />
        ))}
      </ul>
    </section>
  );
}

/** The list of guides: the game's own puzzles, then the prototypes. */
export function Home() {
  return (
    <main className="page home">
      <header className="masthead">
        <p className="eyebrow">{t("docs.brand")}</p>
        <h1>{t("docs.title")}</h1>
        <p className="lede">{t("docs.lede")}</p>
      </header>
      <Shelf heading={t("docs.core_heading")} blurb={t("docs.core_blurb")} ids={CORE_PUZZLE_IDS} />
      <Shelf heading={t("docs.prototype_heading")} blurb={t("docs.prototype_blurb")} ids={PROTOTYPE_PUZZLE_IDS} />
    </main>
  );
}
