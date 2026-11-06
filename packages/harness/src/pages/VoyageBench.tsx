import { useEffect, useMemo, useState } from "react";
import { STATIONS } from "@openseas/engine";
import { content, t } from "@openseas/boards";
import { Link } from "../router.jsx";
import { baseWorld, resolveScenario, type VoyageScenario } from "../voyage/scenario.js";
import { formatVoyage, parseVoyage } from "../voyage/codec.js";
import { ScenarioPanel } from "../voyage/ScenarioPanel.jsx";
import { RunView } from "../voyage/RunView.jsx";
import { BatchView } from "../voyage/BatchView.jsx";

/**
 * The voyage bench (ADR 0027): a ship, a crew at their stations playing as well as the scenario
 * says, a route and its brigands, sailed through the engine's reducers as the server sails them.
 * One voyage turn by turn, with the sea battle on the real board (watched, or plotted by hand),
 * or a batch of voyages for the averages. The scenario is the page's query string.
 */
export function VoyageBench() {
  const initial = useMemo(() => parseVoyage(content, window.location.search), []);
  const [scenario, setScenario] = useState<VoyageScenario>(initial.scenario);
  const [tab, setTab] = useState<"voyage" | "batch">(initial.autostart === "batch" ? "batch" : "voyage");
  // The scenario (as its query string) to sail at once when its voyage view opens: a link with
  // start=sail, or a run opened from a batch. Editing the scenario after that does not re-sail it.
  const [sailFor, setSailFor] = useState<string | null>(initial.autostart === "sail" ? formatVoyage(content, initial.scenario) : null);
  const [nonce, setNonce] = useState(0);
  const [copied, setCopied] = useState(false);

  const resolved = useMemo(() => resolveScenario(content, scenario), [scenario]);
  const world = resolved.ok ? resolved.world : baseWorld(content, scenario.shipClassId, scenario.routeId) ?? baseWorld(content, content.world.shipClasses[0]!.id, content.world.routes[0]!.id)!;
  const stations = STATIONS.filter((s) => world.ship.stations.includes(s));
  const qs = formatVoyage(content, scenario);

  useEffect(() => {
    window.history.replaceState(null, "", `/voyage${qs ? `?${qs}` : ""}`);
  }, [qs]);

  const openRun = (seed: string): void => {
    const next = { ...scenario, seed };
    setScenario(next);
    setSailFor(formatVoyage(content, next));
    setNonce((n) => n + 1);
    setTab("voyage");
  };
  const share = (): void => {
    const link = `${window.location.origin}/voyage?${formatVoyage(content, scenario, tab === "batch" ? "batch" : "sail")}`;
    void navigator.clipboard?.writeText(link).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  return (
    <main className="page vpage" data-testid="voyage-page">
      <header className="vhead">
        <p className="eyebrow">
          <Link to="/">{t("harness.title")}</Link> · {t("harness.voyage.eyebrow")}
        </p>
        <h1 className="vtitle">{t("harness.voyage.title")}</h1>
        <p className="muted">{t("harness.voyage.tagline")}</p>
      </header>

      <div className="vlayout">
        <aside className="bench vaside" aria-label={t("harness.scenario")}>
          <ScenarioPanel content={content} scenario={scenario} onChange={setScenario} world={world} />
          <div className="bench-actions vshare">
            <button type="button" className="btn btn-ghost btn-mini" onClick={share} data-testid="voyage-share">
              {t("harness.voyage.share")}
            </button>
            {copied && <span className="small ok">{t("harness.voyage.copied")}</span>}
          </div>
        </aside>

        <section className="vmain">
          {!resolved.ok && (
            <div className="error vinvalid" role="alert" data-testid="voyage-invalid">
              <p>{t("harness.voyage.invalid")}</p>
              <ul>
                {resolved.errors.map((e, i) => (
                  <li key={i} className="mono small">
                    {e}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="vtabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "voyage"} className={tab === "voyage" ? "is-on" : ""} onClick={() => setTab("voyage")} data-testid="voyage-tab-voyage">
              {t("harness.voyage.tab_voyage")}
            </button>
            <button type="button" role="tab" aria-selected={tab === "batch"} className={tab === "batch" ? "is-on" : ""} onClick={() => setTab("batch")} data-testid="voyage-tab-batch">
              {t("harness.voyage.tab_batch")}
            </button>
          </div>
          {tab === "voyage" &&
            (resolved.ok ? (
              <RunView key={`${qs}|${nonce}`} setup={resolved.setup} crew={scenario.crew} stations={stations} autostart={sailFor === qs} />
            ) : (
              <p className="muted vempty">{t("harness.voyage.fix_first")}</p>
            ))}
          <div hidden={tab !== "batch"}>
            <BatchView scenario={scenario} valid={resolved.ok} onRuns={(runs) => setScenario((s) => ({ ...s, runs }))} onOpen={openRun} stations={stations} autostart={initial.autostart === "batch"} />
          </div>
        </section>
      </div>
    </main>
  );
}
