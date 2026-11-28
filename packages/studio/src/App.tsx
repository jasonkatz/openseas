import { lazy, Suspense, useEffect, useState, type ComponentType, type ReactNode } from "react";
import type { PuzzleId } from "@openseas/engine";
import type { TesterLink } from "@openseas/protocol";
import { t } from "@openseas/boards";
import { Home } from "./home/Home.jsx";
import { THUMB_PARAM } from "./home/thumbs.js";
import { BattlePractice } from "./pages/BattlePractice.jsx";
import { CoolingPractice } from "./pages/CoolingPractice.jsx";
import { PlatingPractice } from "./pages/PlatingPractice.jsx";
import { GunneryPractice } from "./pages/GunneryPractice.jsx";
import { NavigationPractice } from "./pages/NavigationPractice.jsx";
import { EnginesPractice } from "./pages/EnginesPractice.jsx";
import { SwordfightPractice } from "./pages/SwordfightPractice.jsx";
import { SalvagePractice } from "./pages/SalvagePractice.jsx";
import { OverloadPractice } from "./pages/OverloadPractice.jsx";
import { DeflectorsPractice } from "./pages/DeflectorsPractice.jsx";
import { ReactorPractice } from "./pages/ReactorPractice.jsx";
import { ScannerPractice } from "./pages/ScannerPractice.jsx";
import { TugPractice } from "./pages/TugPractice.jsx";
import { RacksPractice } from "./pages/RacksPractice.jsx";
import { CuttingPractice } from "./pages/CuttingPractice.jsx";
import { TractorPractice } from "./pages/TractorPractice.jsx";
import { RefiningPractice } from "./pages/RefiningPractice.jsx";
import { FreefallPractice } from "./pages/FreefallPractice.jsx";
import { ShowdownPractice } from "./pages/ShowdownPractice.jsx";
import { ForgingPractice } from "./pages/ForgingPractice.jsx";
import { AssemblyPractice } from "./pages/AssemblyPractice.jsx";
import { PactPractice } from "./pages/PactPractice.jsx";
import { PouringPractice } from "./pages/PouringPractice.jsx";
import { RoundFrame, type FrameMode } from "./frame/RoundFrame.jsx";
import { useMediaQuery } from "./practice/PracticeShell.jsx";
import { STUDIO_PUZZLES, type StudioPuzzle } from "./puzzles.js";
import { advanceDeflectorsMirror } from "./rungs/mirror/deflectors.js";
import { advanceGunneryMirror } from "./rungs/mirror/gunnery.js";
import { advanceOverloadMirror } from "./rungs/mirror/overload.js";
import { advanceRefiningMirror } from "./rungs/mirror/refining.js";
import { ASSEMBLY_RUNG, COOLING_RUNG, CUTTING_RUNG, DEFLECTORS_RUNG, FORGING_RUNG, FREEFALL_RUNG, GUNNERY_RUNG, OVERLOAD_RUNG, PATHS_RUNG, POURING_RUNG, RACKS_RUNG, REACTOR_RUNG, REFINING_RUNG, SCANNER_RUNG, TRACTOR_RUNG, TUG_RUNG } from "./rungs/mirrors.js";
import { Router, useRoute } from "./router.jsx";
import { fetchLink, looksLikeLinkId, type LinkLookup } from "./service/client.js";

/** A puzzle on the new engine (ADR 0092) is its own chunk too: no puzzle's page loads that engine. */
const SwapRung = lazy(() => import("./rungs/SwapRung.jsx").then((m) => ({ default: m.SwapRung })));

/** The voyage bench is its own chunk: the puzzle pages never load the ship simulator or its charts. */
const VoyageBench = lazy(() => import("./pages/VoyageBench.jsx").then((m) => ({ default: m.VoyageBench })));

const PAGES: Readonly<Record<PuzzleId, ComponentType>> = {
  cooling: CoolingPractice,
  engines: EnginesPractice,
  plating: PlatingPractice,
  gunnery: GunneryPractice,
  navigation: NavigationPractice,
  battle: BattlePractice,
  swordfight: SwordfightPractice,
  salvage: SalvagePractice,
  overload: OverloadPractice,
  deflectors: DeflectorsPractice,
  reactor: ReactorPractice,
  scanner: ScannerPractice,
  tug: TugPractice,
  racks: RacksPractice,
  cutting: CuttingPractice,
  tractor: TractorPractice,
  refining: RefiningPractice,
  freefall: FreefallPractice,
  showdown: ShowdownPractice,
  forging: ForgingPractice,
  assembly: AssemblyPractice,
  pact: PactPractice,
  pouring: PouringPractice,
};

const RUNGS: Record<string, { puzzle: StudioPuzzle<unknown, unknown, unknown>; page: ReactNode }> = {
  "/rungs/cooling": { puzzle: COOLING_RUNG as unknown as StudioPuzzle<unknown, unknown, unknown>, page: <CoolingPractice entry={COOLING_RUNG} /> },
  "/rungs/paths": { puzzle: PATHS_RUNG as unknown as StudioPuzzle<unknown, unknown, unknown>, page: <SalvagePractice entry={PATHS_RUNG} /> },
  "/rungs/gunnery": { puzzle: GUNNERY_RUNG as unknown as StudioPuzzle<unknown, unknown, unknown>, page: <GunneryPractice entry={GUNNERY_RUNG} advance={advanceGunneryMirror} /> },
  "/rungs/forging": { puzzle: FORGING_RUNG as unknown as StudioPuzzle<unknown, unknown, unknown>, page: <ForgingPractice entry={FORGING_RUNG} /> },
  "/rungs/assembly": { puzzle: ASSEMBLY_RUNG as unknown as StudioPuzzle<unknown, unknown, unknown>, page: <AssemblyPractice entry={ASSEMBLY_RUNG} /> },
  "/rungs/racks": { puzzle: RACKS_RUNG as unknown as StudioPuzzle<unknown, unknown, unknown>, page: <RacksPractice entry={RACKS_RUNG} /> },
  "/rungs/cutting": { puzzle: CUTTING_RUNG as unknown as StudioPuzzle<unknown, unknown, unknown>, page: <CuttingPractice entry={CUTTING_RUNG} /> },
  "/rungs/scanner": { puzzle: SCANNER_RUNG as unknown as StudioPuzzle<unknown, unknown, unknown>, page: <ScannerPractice entry={SCANNER_RUNG} /> },
  "/rungs/tug": { puzzle: TUG_RUNG as unknown as StudioPuzzle<unknown, unknown, unknown>, page: <TugPractice entry={TUG_RUNG} /> },
  "/rungs/reactor": { puzzle: REACTOR_RUNG as unknown as StudioPuzzle<unknown, unknown, unknown>, page: <ReactorPractice entry={REACTOR_RUNG} /> },
  "/rungs/tractor": { puzzle: TRACTOR_RUNG as unknown as StudioPuzzle<unknown, unknown, unknown>, page: <TractorPractice entry={TRACTOR_RUNG} /> },
  "/rungs/freefall": { puzzle: FREEFALL_RUNG as unknown as StudioPuzzle<unknown, unknown, unknown>, page: <FreefallPractice entry={FREEFALL_RUNG} /> },
  "/rungs/pouring": { puzzle: POURING_RUNG as unknown as StudioPuzzle<unknown, unknown, unknown>, page: <PouringPractice entry={POURING_RUNG} /> },
  "/rungs/overload": { puzzle: OVERLOAD_RUNG as unknown as StudioPuzzle<unknown, unknown, unknown>, page: <OverloadPractice entry={OVERLOAD_RUNG} advance={advanceOverloadMirror} /> },
  "/rungs/refining": { puzzle: REFINING_RUNG as unknown as StudioPuzzle<unknown, unknown, unknown>, page: <RefiningPractice entry={REFINING_RUNG} advance={advanceRefiningMirror} /> },
  "/rungs/deflectors": { puzzle: DEFLECTORS_RUNG as unknown as StudioPuzzle<unknown, unknown, unknown>, page: <DeflectorsPractice entry={DEFLECTORS_RUNG} advance={advanceDeflectorsMirror} /> },
};

const isPuzzle = (id: string): id is PuzzleId => Object.hasOwn(PAGES, id);
const PLAY = "/play/";

/** A puzzle's page inside its frame. The key makes a new frame, and so a new reading of the address bar, for every path. */
function Puzzle({ id, mode, link }: { id: PuzzleId; mode: FrameMode; link?: TesterLink }) {
  const Page = PAGES[id];
  return (
    <RoundFrame key={`${mode}/${link?.id ?? id}`} mode={mode} puzzle={STUDIO_PUZZLES[id]} link={link ?? null}>
      <Page />
    </RoundFrame>
  );
}

/**
 * One lane per puzzle, the same puzzle alone under `/play/`, and the voyage bench. The draft a
 * page opens on rides in the query string (scenario/codec.ts). The studio is a desktop tool: on a
 * phone a puzzle's lane only plays (ADR 0042 decision 1).
 */
function Lanes() {
  const { path } = useRoute();
  const desktop = useMediaQuery("(min-width: 900px)");
  if (path.startsWith(PLAY)) {
    const id = path.slice(PLAY.length).replace(/\/$/, "");
    if (isPuzzle(id)) return <Puzzle id={id} mode={new URLSearchParams(window.location.search).has(THUMB_PARAM) ? "thumb" : "play"} />;
    const alone = RUNGS[`/${id}`];
    if (alone)
      return (
        <RoundFrame key={`play/${id}`} mode="play" puzzle={alone.puzzle} link={null}>
          {alone.page}
        </RoundFrame>
      );
    if (looksLikeLinkId(id)) return <LinkPlay key={id} id={id} />;
    return <Notice testId="play-unknown" title={t("play.unknown_title")} body={t("play.unknown")} />;
  }
  const id = path.slice(1);
  if (isPuzzle(id)) return <Puzzle id={id} mode={desktop ? "studio" : "play"} />;
  // A shipped page and board with the new engine playing the round (ADR 0097).
  const rung = RUNGS[path];
  if (rung) {
    const mode = desktop ? "studio" : "play";
    return (
      <RoundFrame key={`${mode}${path}`} mode={mode} puzzle={rung.puzzle} link={null}>
        {rung.page}
      </RoundFrame>
    );
  }
  if (path === "/rungs/swap")
    return (
      <Suspense fallback={<p className="page muted">{t("app.loading")}</p>}>
        <SwapRung />
      </Suspense>
    );
  if (path === "/voyage")
    return (
      <Suspense fallback={<p className="page muted">{t("app.loading")}</p>}>
        <VoyageBench />
      </Suspense>
    );
  return <Home />;
}

function Notice({ testId, title, body }: { testId: string; title: string; body: string }) {
  return (
    <main className="page" data-testid={testId}>
      <h1>{title}</h1>
      <p className="muted">{body}</p>
    </main>
  );
}

/**
 * A tester link (ADR 0042 decision 11): `/play/<id>` asks the studio's service for the frozen
 * draft and plays its puzzle alone on those numbers. A link that was withdrawn, never was, or
 * cannot be fetched says which, and deals nothing.
 */
function LinkPlay({ id }: { id: string }) {
  const [found, setFound] = useState<LinkLookup | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchLink(id).then((r) => alive && setFound(r));
    return () => {
      alive = false;
    };
  }, [id]);
  if (!found) return <p className="page muted">{t("app.loading")}</p>;
  if (found.ok) return <Puzzle id={found.link.puzzle} mode="play" link={found.link} />;
  if (found.reason === "withdrawn") return <Notice testId="play-withdrawn" title={t("play.withdrawn_title")} body={t("play.withdrawn")} />;
  if (found.reason === "not_found") return <Notice testId="play-unknown" title={t("play.unknown_title")} body={t("play.unknown")} />;
  return <Notice testId="play-unreachable" title={t("play.unreachable_title")} body={t("play.unreachable")} />;
}

/** Nothing here asks anything of the game's server: every round is local (ADR 0042 decision 3). */
export function App() {
  return (
    <Router>
      <Lanes />
    </Router>
  );
}
