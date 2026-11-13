import type { ReactNode } from "react";
import { CORE_PUZZLE_IDS, PROTOTYPE_PUZZLE_IDS, type PuzzleId } from "@openseas/engine";
import { content, t } from "@openseas/boards";
import { Link } from "../router.jsx";

const GLYPHS: Record<PuzzleId, ReactNode> = {
  cooling: (
    <svg viewBox="0 0 64 64" width="56" height="56">
      <rect x="4" y="4" width="56" height="56" rx="6" fill="#121c30" stroke="#3c4555" strokeWidth="2" />
      <path d="M6 42 Q 16 37 26 42 T 46 42 T 58 41 V 57 H 6 Z" fill="#d9541f" opacity=".75" />
      <path d="M6 42 Q 16 37 26 42 T 46 42 T 58 41" fill="none" stroke="#ffc27a" strokeWidth="1.5" />
      <path d="M21 9l2 3.2 3.6-.9.6 3.7 3.6.9-1.3 3.5 2.7 2.5-2.7 2.5 1.3 3.5-3.6.9-.6 3.7-3.6-.9-2 3.2-2-3.2-3.6.9-.6-3.7-3.6-.9 1.3-3.5L9.6 21.6l2.7-2.5L11 15.6l3.6-.9.6-3.7 3.6.9z" fill="#f5d021" stroke="#0b1526" strokeWidth="1.3" />
      <circle cx="21" cy="21.6" r="3.4" fill="#9aa3b0" stroke="#0b1526" strokeWidth="1" />
      <path d="M44 9l6 6-1 12-5 5-5-6 1-12z" fill="#a66cf5" stroke="#0b1526" strokeWidth="1.3" />
      <rect x="12" y="38" width="16" height="13" rx="2" fill="#e5355a" stroke="#0b1526" strokeWidth="1.3" />
      <rect x="17" y="41.5" width="6" height="6" fill="#1b1d24" />
      <rect x="36" y="40" width="18" height="8" rx="2" fill="#f3772a" stroke="#0b1526" strokeWidth="1.3" />
      <rect x="40" y="43" width="10" height="2" rx="1" fill="#ffe08a" />
    </svg>
  ),
  engines: (
    <svg viewBox="0 0 64 64" width="56" height="56">
      <rect x="4" y="4" width="56" height="56" rx="6" fill="#121c30" stroke="#3c4555" strokeWidth="2" />
      <rect x="8" y="43" width="48" height="5" rx="2" fill="#cfc3a3" stroke="#0b1526" strokeWidth="1" />
      <rect x="28" y="44.5" width="8" height="1.5" rx=".75" fill="#5fe3ff" />
      <circle cx="20" cy="35" r="7" fill="#d8ccae" stroke="#0b1526" strokeWidth="1.3" />
      <circle cx="20" cy="35" r="5" fill="#e5603c" />
      <circle cx="34" cy="35" r="7" fill="#d8ccae" stroke="#0b1526" strokeWidth="1.3" />
      <circle cx="34" cy="35" r="5" fill="#f5d021" />
      <circle cx="34" cy="21" r="7" fill="#d8ccae" stroke="#0b1526" strokeWidth="1.3" />
      <circle cx="34" cy="21" r="5" fill="#3fa7f5" />
      <circle cx="48" cy="35" r="6.5" fill="none" stroke="#3fa7f5" strokeWidth="2" strokeDasharray="3 2" />
    </svg>
  ),
  plating: (
    <svg viewBox="0 0 64 64" width="56" height="56">
      <rect x="6" y="10" width="52" height="44" rx="4" fill="#3a4250" stroke="#0e1218" strokeWidth="2" />
      <rect x="6" y="24" width="52" height="1.5" fill="#0e1218" opacity=".8" />
      <rect x="6" y="39" width="52" height="1.5" fill="#0e1218" opacity=".8" />
      <circle cx="12" cy="17" r="1.3" fill="#a7b0bd" />
      <circle cx="52" cy="47" r="1.3" fill="#a7b0bd" />
      <path d="M22 18h16v10h10v10H32v10H22z" fill="#05080f" />
      <circle cx="42" cy="32" r=".9" fill="#dfe9ff" />
      <circle cx="27" cy="44" r=".7" fill="#dfe9ff" />
      <rect x="22" y="18" width="16" height="10" rx="1.5" fill="#b9c0c8" stroke="#0b1526" />
      <rect x="22" y="28" width="10" height="10" rx="1.5" fill="#c0703c" stroke="#0b1526" />
    </svg>
  ),
  gunnery: (
    <svg viewBox="0 0 64 64" width="56" height="56">
      <rect x="6" y="6" width="52" height="52" rx="6" fill="#1f242d" stroke="#3c4555" strokeWidth="2" />
      <rect x="12" y="10" width="40" height="44" rx="2" fill="#535c6a" />
      <path d="M12 21h40M12 32h40M12 43h40M25 10v44M39 10v44" stroke="#14181f" strokeWidth="1" />
      <rect x="4" y="22" width="12" height="11" rx="3" fill="#d8ccae" stroke="#0b1526" strokeWidth="1.2" />
      <rect x="6" y="27" width="8" height="1.6" fill="#e8892c" />
      <rect x="16" y="26" width="6" height="3" fill="#8a93a0" stroke="#0b1526" strokeWidth=".8" />
      <rect x="42" y="13" width="7" height="12" rx="1.5" fill="#e8892c" stroke="#0b1526" strokeWidth="1.2" />
      <rect x="41" y="12" width="9" height="3" rx="1" fill="#9aa3b0" stroke="#0b1526" strokeWidth=".8" />
      <path d="M33 47 a 5 5 0 1 1 0 -0.1" fill="none" stroke="#d8ccae" strokeWidth="3.5" />
      <path d="M24 38h12m0 0l-3-3m3 3l-3 3" fill="none" stroke="#f5d58a" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  ),
  navigation: (
    <svg viewBox="0 0 64 64" width="56" height="56">
      <circle cx="32" cy="32" r="26" fill="#070e1a" stroke="#d4a548" strokeWidth="2" />
      <circle cx="32" cy="32" r="17" fill="none" stroke="#5b7bb3" strokeWidth="1.5" />
      <circle cx="32" cy="32" r="8" fill="none" stroke="#5b7bb3" strokeWidth="1.5" />
      <path d="M32 9 l2.4 4.8 5.3 .8 -3.8 3.7 .9 5.3 -4.8 -2.5 -4.8 2.5 .9 -5.3 -3.8 -3.7 5.3 -.8z" fill="#f5d021" />
      <path d="M18 40 l1.6 3.2 3.5 .5 -2.5 2.5 .6 3.5 -3.2 -1.7 -3.2 1.7 .6 -3.5 -2.5 -2.5 3.5 -.5z" fill="none" stroke="#7fd7ff" strokeWidth="1.6" />
      <circle cx="46" cy="40" r="4" fill="#ff6b5e" />
    </svg>
  ),
  battle: (
    <svg viewBox="0 0 64 64" width="56" height="56">
      <rect x="4" y="4" width="56" height="56" rx="6" fill="#0b1428" stroke="#3c4555" strokeWidth="2" />
      <circle cx="46" cy="46" r="12" fill="#7850e6" opacity=".12" />
      <path d="M4 20h56M4 36h56M20 4v56M36 4v56" stroke="#7f9fdc" strokeOpacity=".18" strokeWidth="1" />
      <circle cx="12" cy="10" r=".9" fill="#dfe9ff" />
      <circle cx="53" cy="27" r=".9" fill="#dfe9ff" />
      <circle cx="28" cy="52" r=".7" fill="#dfe9ff" />
      <path d="M20 32l4-3 5 1 2 4-3 4-5 0-3-3z" fill="#8f8a84" stroke="#0b1526" strokeWidth="1" />
      <path d="M16 54v-8l4-10 4 10v8z" fill="#d8ccae" stroke="#0b1526" strokeWidth="1.2" />
      <ellipse cx="20" cy="45" rx="1.6" ry="2.6" fill="#3f78b0" />
      <path d="M48 10v8l-4 10-2-5-2 5-4-10v-8z" fill="#a9493a" stroke="#0b1526" strokeWidth="1.2" transform="rotate(180 42 18)" />
      <path d="M30 42h10" stroke="#ffe8a0" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="42" cy="42" r="2.5" fill="#fff3c4" />
    </svg>
  ),
  swordfight: (
    <svg viewBox="0 0 64 64" width="56" height="56">
      <rect x="6" y="6" width="52" height="52" rx="6" fill="#0b1526" />
      <rect x="10" y="40" width="13" height="13" rx="3" fill="#e5355a" />
      <rect x="24" y="40" width="13" height="13" rx="3" fill="#3fa7f5" />
      <rect x="24" y="27" width="13" height="13" rx="3" fill="#3fa7f5" />
      <rect x="38" y="27" width="13" height="26" rx="3" fill="#f5d021" />
      <rect x="10" y="27" width="13" height="13" rx="3" fill="#6c6f78" />
      <rect x="38" y="13" width="13" height="13" rx="3" fill="#4ad66d" stroke="#f2f0e6" strokeWidth="1.5" />
      <path d="M41 23l8-8" stroke="#f2f0e6" strokeWidth="3" strokeLinecap="round" />
      <path d="M12 12h16M20 8v8" stroke="#d4a548" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  ),
  salvage: (
    <svg viewBox="0 0 64 64" width="56" height="56">
      <rect x="4" y="4" width="56" height="56" rx="6" fill="#0b1526" />
      <path d="M14 46 L24 34 L36 38 L46 24 L50 14" fill="none" stroke="#7fd7ff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="14" cy="46" r="5" fill="#f5d021" />
      <circle cx="24" cy="34" r="5" fill="#f5d021" />
      <circle cx="36" cy="38" r="5" fill="#f5d021" />
      <circle cx="46" cy="24" r="5" fill="#f5d021" />
      <rect x="42" y="42" width="12" height="12" rx="2" fill="#c98a4b" stroke="#efe3c6" strokeWidth="1.5" />
      <path d="M16 16l6 6-6 6-6-6z" fill="#ff6b5e" />
    </svg>
  ),
  overload: (
    <svg viewBox="0 0 64 64" width="56" height="56">
      <rect x="4" y="4" width="56" height="56" rx="6" fill="#0b1526" />
      <circle cx="20" cy="20" r="9" fill="#12233d" stroke="#3fa7f5" strokeWidth="2" />
      <circle cx="44" cy="20" r="9" fill="#12233d" stroke="#3fa7f5" strokeWidth="2" />
      <circle cx="20" cy="44" r="9" fill="#12233d" stroke="#3fa7f5" strokeWidth="2" />
      <circle cx="44" cy="44" r="9" fill="#f5d021" stroke="#fff3c4" strokeWidth="2" />
      <path d="M46 36l-6 9h5l-3 8 7-10h-5z" fill="#0b1526" />
      <circle cx="20" cy="20" r="2.5" fill="#7fd7ff" />
      <circle cx="41" cy="20" r="2.5" fill="#7fd7ff" />
      <circle cx="47" cy="20" r="2.5" fill="#7fd7ff" />
    </svg>
  ),
  deflectors: (
    <svg viewBox="0 0 64 64" width="56" height="56">
      <rect x="4" y="4" width="56" height="56" rx="6" fill="#0b1526" />
      <path d="M4 22h24v24h32" fill="none" stroke="#ff6b5e" strokeWidth="3" strokeLinecap="round" />
      <path d="M22 28l12-12" stroke="#efe3c6" strokeWidth="4" strokeLinecap="round" />
      <path d="M22 40l12 12" stroke="#efe3c6" strokeWidth="4" strokeLinecap="round" />
      <path d="M40 16l12 12" stroke="#5b7bb3" strokeWidth="4" strokeLinecap="round" />
      <circle cx="58" cy="46" r="4" fill="#7bd88f" />
    </svg>
  ),
  reactor: (
    <svg viewBox="0 0 64 64" width="56" height="56">
      <rect x="4" y="4" width="56" height="56" rx="6" fill="#0b1526" />
      <rect x="10" y="10" width="20" height="20" rx="4" fill="#12233d" stroke="#7fd7ff" strokeWidth="2" />
      <rect x="34" y="10" width="20" height="20" rx="4" fill="#12233d" stroke="#7fd7ff" strokeWidth="2" />
      <rect x="10" y="34" width="20" height="20" rx="4" fill="#3a2a12" stroke="#f5d021" strokeWidth="2" />
      <rect x="34" y="34" width="20" height="20" rx="4" fill="#4a1a16" stroke="#ff6b5e" strokeWidth="2" />
      <rect x="58" y="38" width="6" height="12" rx="2" fill="#7bd88f" />
      <path d="M40 44h12m0 0l-4-4m4 4l-4 4" fill="none" stroke="#fff3c4" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  ),
  scanner: (
    <svg viewBox="0 0 64 64" width="56" height="56">
      <rect x="4" y="4" width="56" height="56" rx="6" fill="#06130f" />
      <path d="M32 12l20 20-20 20-20-20z" fill="none" stroke="#3fd08a" strokeWidth="2" opacity=".9" />
      <path d="M32 22l10 10-10 10-10-10z" fill="none" stroke="#3fd08a" strokeWidth="2" opacity=".5" />
      <circle cx="32" cy="32" r="3" fill="#b9ffd9" />
      <circle cx="52" cy="32" r="4" fill="#ff6b5e" />
      <path d="M14 14h6M14 14v6M50 50h-6M50 50v-6" stroke="#3fd08a" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  tug: (
    <svg viewBox="0 0 64 64" width="56" height="56">
      <rect x="4" y="4" width="56" height="56" rx="6" fill="#0b1526" />
      <rect x="40" y="10" width="12" height="12" rx="2" fill="#2a3f63" />
      <path d="M14 46h28" stroke="#7fd7ff" strokeWidth="2" strokeDasharray="3 3" />
      <path d="M46 42v-16" stroke="#7fd7ff" strokeWidth="2" strokeDasharray="3 3" />
      <circle cx="14" cy="46" r="7" fill="#f5d021" />
      <circle cx="46" cy="46" r="7" fill="none" stroke="#f5d021" strokeWidth="2" opacity=".5" />
      <rect x="40" y="24" width="12" height="4" rx="2" fill="#7bd88f" />
      <path d="M22 20l8 8-8 8-8-8z" fill="#ff6b5e" />
    </svg>
  ),
  racks: (
    <svg viewBox="0 0 64 64" width="56" height="56">
      <rect x="4" y="4" width="56" height="56" rx="6" fill="#0b1526" />
      <path d="M12 14v38h10V14M27 14v38h10V14M42 14v38h10V14" fill="none" stroke="#5b7bb3" strokeWidth="2" />
      <rect x="13.5" y="41" width="7" height="9" rx="2" fill="#f5d021" />
      <rect x="13.5" y="31" width="7" height="9" rx="2" fill="#f5d021" />
      <rect x="13.5" y="21" width="7" height="9" rx="2" fill="#ff6b5e" />
      <rect x="28.5" y="41" width="7" height="9" rx="2" fill="#7fd7ff" />
      <rect x="28.5" y="31" width="7" height="9" rx="2" fill="#7fd7ff" />
      <rect x="43.5" y="41" width="7" height="9" rx="2" fill="#ff6b5e" />
      <rect x="43.5" y="31" width="7" height="9" rx="2" fill="#7bd88f" />
    </svg>
  ),
  cutting: (
    <svg viewBox="0 0 64 64" width="56" height="56">
      <rect x="4" y="4" width="56" height="56" rx="6" fill="#0b1526" />
      <rect x="10" y="12" width="24" height="18" fill="#f5d021" />
      <rect x="10" y="34" width="24" height="18" fill="#7fd7ff" />
      <rect x="38" y="12" width="16" height="40" fill="#ff6b5e" />
      <rect x="18" y="40" width="8" height="6" fill="#f5d021" />
      <path d="M36 6v52" stroke="#fff3c4" strokeWidth="2.5" strokeDasharray="5 3" />
      <path d="M6 32h30" stroke="#fff3c4" strokeWidth="2.5" strokeDasharray="5 3" />
    </svg>
  ),
};

export function Home() {
  return (
    <main className="page home harness-home">
      <header className="masthead">
        <p className="eyebrow">{t("harness.eyebrow")}</p>
        <h1 className="wordmark">{t("harness.title")}</h1>
        <div className="rule" aria-hidden="true" />
        <p className="muted">{t("harness.tagline")}</p>
      </header>

      <section className="card card-ink status-card" data-testid="status-card">
        <h2>{t("harness.home.status")}</h2>
        <dl className="ledger">
          <div>
            <dt>{t("harness.home.build")}</dt>
            <dd className="mono small" data-testid="status-build">
              {t("harness.home.harness_commit", { commit: __HARNESS_COMMIT__.slice(0, 7) })} · {t("harness.home.content_version", { version: content.world.version })}
            </dd>
          </div>
        </dl>
        <p className="muted small">{t("harness.home.how")}</p>
      </section>

      <section className="practice">
        <h2 className="section-title">{t("harness.home.puzzles")}</h2>
        <ul className="practice-grid">
          {CORE_PUZZLE_IDS.map((id) => (
            <li key={id}>
              <Link to={`/${id}`} className="practice-tile live" data-testid={`tile-${id}`}>
                <span className="tile-glyph" aria-hidden="true">
                  {GLYPHS[id]}
                </span>
                <span className="tile-title">{t(`home.practice_${id}`)}</span>
                <span className="tile-blurb">{t(`home.practice_${id}_blurb`)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="practice">
        <h2 className="section-title">{t("harness.home.prototypes")}</h2>
        <p className="muted small">{t("harness.home.prototypes_blurb")}</p>
        <ul className="practice-grid">
          {PROTOTYPE_PUZZLE_IDS.map((id) => (
            <li key={id}>
              <Link to={`/${id}`} className="practice-tile live" data-testid={`tile-${id}`}>
                <span className="tile-glyph" aria-hidden="true">
                  {GLYPHS[id]}
                </span>
                <span className="tile-title">{t(`home.practice_${id}`)}</span>
                <span className="tile-blurb">{t(`home.practice_${id}_blurb`)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="practice">
        <h2 className="section-title">{t("harness.home.ships")}</h2>
        <ul className="practice-grid">
          <li>
            <Link to="/voyage" className="practice-tile live" data-testid="tile-voyage">
              <span className="tile-glyph" aria-hidden="true">
                <svg viewBox="0 0 64 64" width="56" height="56">
                  <rect x="4" y="4" width="56" height="56" rx="6" fill="#0b1428" stroke="#3c4555" strokeWidth="2" />
                  <circle cx="18" cy="48" r=".9" fill="#dfe9ff" />
                  <circle cx="48" cy="44" r=".9" fill="#dfe9ff" />
                  <circle cx="40" cy="9" r=".7" fill="#dfe9ff" />
                  <path d="M10 22 C 22 14, 40 30, 54 18" fill="none" stroke="#d4a548" strokeWidth="2" strokeDasharray="3 3" />
                  <path d="M6 22l2-3 4-.5 2 3-1.5 3.5-4 .5z" fill="#8f8a84" stroke="#0b1526" strokeWidth="1" />
                  <path d="M51 15l3-1.5 3 2 0 3.5-3 1.5-3-1.5z" fill="#8f8a84" stroke="#0b1526" strokeWidth="1" />
                  <path d="M32 46v-4l-4 2 0-9 4-9 4 9 0 9-4-2" fill="#d8ccae" stroke="#0b1526" strokeWidth="1.2" strokeLinejoin="round" />
                  <ellipse cx="32" cy="34" rx="1.5" ry="2.6" fill="#3f78b0" />
                  <path d="M30 46l2 6 2-6" fill="#7fe9ff" />
                </svg>
              </span>
              <span className="tile-title">{t("harness.home.voyage")}</span>
              <span className="tile-blurb">{t("harness.home.voyage_blurb")}</span>
            </Link>
          </li>
        </ul>
      </section>

      <footer className="colophon">{t("harness.home.footer")}</footer>
    </main>
  );
}
