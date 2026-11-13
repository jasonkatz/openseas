import { lazy, Suspense, type ComponentType } from "react";
import type { PuzzleId } from "@openseas/engine";
import { t } from "@openseas/boards";
import { Home } from "./pages/Home.jsx";
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
import { RoundFrame, type FrameMode } from "./frame/RoundFrame.jsx";
import { useMediaQuery } from "./practice/PracticeShell.jsx";
import { HARNESS_PUZZLES } from "./puzzles.js";
import { Router, useRoute } from "./router.jsx";

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
};

const isPuzzle = (id: string): id is PuzzleId => Object.hasOwn(PAGES, id);
const PLAY = "/play/";

/** A puzzle's page inside its frame. The key makes a new frame, and so a new reading of the address bar, for every path. */
function Puzzle({ id, mode }: { id: PuzzleId; mode: FrameMode }) {
  const Page = PAGES[id];
  return (
    <RoundFrame key={`${mode}/${id}`} mode={mode} puzzle={HARNESS_PUZZLES[id]}>
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
    if (isPuzzle(id)) return <Puzzle id={id} mode="play" />;
    return (
      <main className="page" data-testid="play-unknown">
        <h1>{t("play.unknown_title")}</h1>
        <p className="muted">{t("play.unknown")}</p>
      </main>
    );
  }
  const id = path.slice(1);
  if (isPuzzle(id)) return <Puzzle id={id} mode={desktop ? "studio" : "play"} />;
  if (path === "/voyage")
    return (
      <Suspense fallback={<p className="page muted">{t("app.loading")}</p>}>
        <VoyageBench />
      </Suspense>
    );
  return <Home />;
}

/** Nothing here asks anything of the game's server: every round is local (ADR 0042 decision 3). */
export function App() {
  return (
    <Router>
      <Lanes />
    </Router>
  );
}
