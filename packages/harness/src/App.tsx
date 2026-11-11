import { lazy, Suspense, type ComponentType } from "react";
import { isPuzzleId, type PuzzleId } from "@openseas/engine";
import { PirateProvider, t } from "@openseas/boards";
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
import { Router, useRoute } from "./router.jsx";

/** The voyage bench is its own chunk: the puzzle pages never load the ship simulator or its charts. */
const VoyageBench = lazy(() => import("./pages/VoyageBench.jsx").then((m) => ({ default: m.VoyageBench })));

/** Every puzzle's practice page, at `/<id>`. A puzzle the engine registers without a page here fails to typecheck. */
const LANES: Readonly<Record<PuzzleId, ComponentType>> = {
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

/** One lane per engine, and the voyage bench. The scenario a page opens on rides in the query string (scenario/codec.ts). */
function Lanes() {
  const { path } = useRoute();
  const id = path.slice(1);
  if (isPuzzleId(id)) {
    const Page = LANES[id];
    return <Page />;
  }
  if (path === "/voyage")
    return (
      <Suspense fallback={<p className="page muted">{t("app.loading")}</p>}>
        <VoyageBench />
      </Suspense>
    );
  return <Home />;
}

export function App() {
  return (
    <Router>
      <PirateProvider>
        <Lanes />
      </PirateProvider>
    </Router>
  );
}
