import { lazy, Suspense } from "react";
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

/** One lane per engine, and the voyage bench. The scenario a page opens on rides in the query string (scenario/codec.ts). */
function Lanes() {
  const { path } = useRoute();
  if (path === "/cooling") return <CoolingPractice />;
  if (path === "/engines") return <EnginesPractice />;
  if (path === "/plating") return <PlatingPractice />;
  if (path === "/gunnery") return <GunneryPractice />;
  if (path === "/navigation") return <NavigationPractice />;
  if (path === "/battle") return <BattlePractice />;
  if (path === "/swordfight") return <SwordfightPractice />;
  if (path === "/salvage") return <SalvagePractice />;
  if (path === "/overload") return <OverloadPractice />;
  if (path === "/deflectors") return <DeflectorsPractice />;
  if (path === "/reactor") return <ReactorPractice />;
  if (path === "/scanner") return <ScannerPractice />;
  if (path === "/tug") return <TugPractice />;
  if (path === "/racks") return <RacksPractice />;
  if (path === "/cutting") return <CuttingPractice />;
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
