import { useCallback, useMemo, useState } from "react";
import { PlayBoard, PlayPieceIcon, TierPace, hostScale, isMuted, setMuted, skinOf, spaceTheme, t, usePlayRound } from "@openseas/boards";
import { SWAP, checkSkin, checkTheme, layerOf, stageLayers, swapEngine, unsupported, type Engine, type PuzzleDoc, type Skin, type Theme } from "@openseas/puzzle";
import { ResultScore } from "../practice/PracticeShell.jsx";
import "./domain.css";

/**
 * The puzzles of the domain engine (ADR 0083), by id: each a puzzle document and its rules, run
 * by one engine on the game's scale. They are apart from the game's own puzzles, whose engines
 * and pages are each their own.
 */
const ENGINES: Readonly<Record<string, () => Engine<unknown>>> = {
  swap: () => swapEngine({ scale: hostScale() }) as unknown as Engine<unknown>,
};
const DOCS: Readonly<Record<string, PuzzleDoc>> = { swap: SWAP };
export const DOMAIN_PUZZLES: readonly string[] = Object.keys(DOCS);
export const isDomainPuzzle = (id: string): boolean => Object.hasOwn(DOCS, id);

/** A seed for a local round. It only has to differ from the last one. */
function freshSeed(): string {
  const words = new Uint32Array(2);
  crypto.getRandomValues(words);
  return `${words[0]!.toString(36)}${words[1]!.toString(36)}`;
}

const fmt = (seconds: number): string => `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, "0")}`;

/** The skin's key for each drawing of the pieces that exist at a stage. */
function piecesAt(doc: PuzzleDoc, stage: string, kinds: (setting: string) => number): string[] {
  const on = stageLayers(doc, stage) ?? [];
  const out: string[] = [];
  for (const p of doc.pieces) {
    const layer = layerOf(doc, "pieces", p.id);
    if (layer !== null && !on.includes(layer)) continue;
    if (p.family) for (let k = 1; k <= kinds(p.family); k++) out.push(`${p.id}_${k}`);
    else out.push(p.id);
  }
  return out;
}

/**
 * A domain puzzle, alone (ADR 0083): its board, a bar of what the engine reads of the round, a
 * card to start from with the ladder's stages, and a card for the round judged. Every round is
 * local, and when one ends its log is played again from its seed, as a host would, and the two
 * scores are held against each other. The address may fix the deal: `?seed=` and `?stage=`.
 */
export function DomainPlay({ id }: { id: string }) {
  const doc = DOCS[id]!;
  const theme = useMemo(() => spaceTheme(), []);
  const skin = useMemo(() => skinOf(doc), [doc]);
  const problems = useMemo(() => [...unsupported(doc), ...checkTheme(theme), ...(skin ? checkSkin(doc, skin, theme) : [`no skin for ${doc.id}`])], [doc, skin, theme]);
  if (!skin || problems.length > 0)
    return (
      <main className="page" data-testid="domain-not-ready">
        <h1>{t("domain.not_ready")}</h1>
        <ul className="play-list">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </main>
    );
  return <Round id={id} doc={doc} skin={skin} theme={theme} />;
}

function Round({ id, doc, skin, theme }: { id: string; doc: PuzzleDoc; skin: Skin; theme: Theme }) {
  const engine = useMemo(() => ENGINES[id]!(), [id]);
  const asked = useMemo(() => new URLSearchParams(window.location.search), []);
  const fixedSeed = asked.get("seed");
  const stages = doc.ladder.map((s) => s.stage);
  const firstStage = stages.includes(asked.get("stage") ?? "") ? asked.get("stage")! : "full";
  const first = useMemo(() => ({ seed: fixedSeed ?? freshSeed(), stage: firstStage }), [fixedSeed, firstStage]);
  const round = usePlayRound(engine, skin, first);
  const [muted, setMutedState] = useState(isMuted);
  const playing = round.phase === "playing";
  const lowTime = playing && round.timeLeft !== null && round.timeLeft <= 10;
  const text = (key: string): string => skin.texts[key] ?? "";

  const toggleMute = useCallback(() => {
    setMuted(!isMuted());
    setMutedState(isMuted());
  }, []);
  const nextSeed = (): string => fixedSeed ?? freshSeed();
  const kinds = (setting: string): number => {
    const v = round.frame.values[setting];
    return typeof v === "number" ? v : 0;
  };

  return (
    <main className="page puzzle puzzle-compact play domain" data-testid="play" data-phase={round.phase}>
      <header className="puzzle-bar puzzle-bar-compact play-bar">
        <section className="hud-strip" aria-live="off">
          <div className="stat stat-score">
            <span className="stat-label">
              {t("practice.score")}
              <span className="stage-chip" data-testid="hud-stage" data-stage={round.stage}>
                {text(`stage.${round.stage}`)}
              </span>
            </span>
            <span className="stat-value" data-testid="hud-score">
              <span key={round.read.score} className={round.read.score ? "bump" : undefined}>
                {round.read.score}
              </span>
              <TierPace pace={round.pace} label={false} />
            </span>
          </div>
          {round.timeLeft !== null && round.seconds !== null && (
            <div className={`stat ${lowTime ? "stat-urgent" : ""}`}>
              <span className="stat-label">{t("practice.time")}</span>
              <span className={`stat-value ${lowTime ? "urgent" : ""}`} data-testid="hud-time">
                {fmt(round.timeLeft)}
              </span>
              <span className="bar" aria-hidden="true">
                <i style={{ width: `${Math.min(100, (round.timeLeft / Math.max(1, round.seconds)) * 100)}%` }} />
              </span>
            </div>
          )}
          {Object.entries(round.read.gauges).map(([gauge, g]) => (
            <div key={gauge} className={`stat ${g.danger !== undefined && g.value >= g.danger ? "stat-urgent" : ""}`}>
              <span className="stat-label">{text(`gauge.${gauge}`)}</span>
              <span className="stat-value" data-testid={`hud-gauge-${gauge}`}>
                {g.value}
              </span>
              {g.most !== undefined && (
                <span className="bar" aria-hidden="true">
                  <i style={{ width: `${Math.min(100, (g.value / Math.max(1, g.most)) * 100)}%` }} />
                </span>
              )}
            </div>
          ))}
        </section>
        <button className="icon-btn" onClick={toggleMute} aria-label={muted ? t("app.unmute") : t("app.mute")} aria-pressed={muted} data-testid="toggle-sound">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" stroke="none" />
            {muted ? <path d="M16 9.5l5 5m0-5l-5 5" /> : <path d="M15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11" />}
          </svg>
        </button>
      </header>

      <section className={`board-wrap ${lowTime ? "low-time" : ""} ${playing ? "is-playing" : ""}`}>
        <PlayBoard doc={doc} skin={skin} theme={theme} frame={round.frame} interactive={playing} onMove={round.move} />

        {!playing && (
          <div className="board-veil">
            {round.phase === "idle" && (
              <div className="veil-card" data-testid="domain-start">
                <p className="eyebrow">
                  {t("domain.eyebrow")} · {t("domain.version", { version: doc.version })}
                </p>
                <h2>{text("name")}</h2>
                <p className="how">{text("how_to")}</p>
                {text("how_to_keyboard") !== "" && <p className="how how-kbd">{text("how_to_keyboard")}</p>}
                <div className="domain-stages" role="group" aria-label={t("domain.stage_pick")}>
                  {stages.map((stage) => (
                    <button key={stage} className={`btn btn-mini ${stage === round.stage ? "is-on" : ""}`} aria-pressed={stage === round.stage} onClick={() => round.preview(round.seed, stage)} data-testid={`stage-${stage}`}>
                      {text(`stage.${stage}`)}
                    </button>
                  ))}
                </div>
                <p className="note" data-testid="stage-intro">
                  {text(`stage.${round.stage}_intro`)}
                </p>
                <ul className="domain-legend" aria-label={t("domain.legend")}>
                  {piecesAt(doc, round.stage, kinds).map((key) => (
                    <li key={key}>
                      <PlayPieceIcon skin={skin} piece={key} size={26} />
                      <span>{text(`piece.${key}`)}</span>
                    </li>
                  ))}
                </ul>
                <div className="stack">
                  <button className="btn btn-brass" onClick={() => round.start(round.seed, round.stage)} data-testid="play-start">
                    {t("play.start")}
                  </button>
                </div>
              </div>
            )}
            {round.result && (
              <div className="veil-card" data-testid="result">
                <p className="eyebrow">{theme.texts["end"]}</p>
                {round.result.read.tier && (
                  <p className="result-tier" data-testid="result-tier" data-tier={round.result.read.tier}>
                    {t("practice.round_tier", { tier: theme.texts[`tier.${round.result.read.tier}`] ?? "" })}
                  </p>
                )}
                <ResultScore score={round.result.read.score} />
                <dl className="result-stats">
                  <div>
                    <dt>{t("practice.moves")}</dt>
                    <dd>{round.result.read.moves}</dd>
                  </div>
                  {Object.entries(round.result.read.stats).map(([stat, value]) => (
                    <div key={stat}>
                      <dt>{text(`stat.${stat}`)}</dt>
                      <dd data-testid={`stat-${stat}`}>{value}</dd>
                    </div>
                  ))}
                </dl>
                {round.result.replayed === round.result.read.score ? (
                  <p className="note" data-testid="replay-verified">
                    {t("domain.verified")}
                  </p>
                ) : (
                  <p className="error" data-testid="replay-mismatch">
                    {round.result.replayed === null ? t("play.replay_mismatch") : t("domain.unverified", { score: round.result.replayed })}
                  </p>
                )}
                <p className="muted small" data-testid="play-seed">
                  {t("play.seed", { seed: round.seed })}
                </p>
                <div className="stack">
                  <button className="btn btn-brass" onClick={() => round.start(nextSeed(), round.stage)} data-testid="restart">
                    {t("practice.restart")}
                  </button>
                  <button className="btn btn-ghost" onClick={() => round.preview(nextSeed(), round.stage)} data-testid="change-stage">
                    {t("domain.change_stage")}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
