import { lazy, Suspense } from "react";
import { PirateProvider, t } from "@openseas/boards";
import { Home } from "./pages/Home.jsx";
import { BattlePractice } from "./pages/BattlePractice.jsx";
import { BilgingPractice } from "./pages/BilgingPractice.jsx";
import { CarpentryPractice } from "./pages/CarpentryPractice.jsx";
import { GunneryPractice } from "./pages/GunneryPractice.jsx";
import { NavigationPractice } from "./pages/NavigationPractice.jsx";
import { SailingPractice } from "./pages/SailingPractice.jsx";
import { SwordfightPractice } from "./pages/SwordfightPractice.jsx";
import { Router, useRoute } from "./router.jsx";

/** The voyage bench is its own chunk: the puzzle pages never load the ship simulator or its charts. */
const VoyageBench = lazy(() => import("./pages/VoyageBench.jsx").then((m) => ({ default: m.VoyageBench })));

/** One route per engine, and the voyage bench. The scenario a page opens on rides in the query string (scenario/codec.ts). */
function Routes() {
  const { path } = useRoute();
  if (path === "/bilging") return <BilgingPractice />;
  if (path === "/sailing") return <SailingPractice />;
  if (path === "/carpentry") return <CarpentryPractice />;
  if (path === "/gunnery") return <GunneryPractice />;
  if (path === "/navigation") return <NavigationPractice />;
  if (path === "/battle") return <BattlePractice />;
  if (path === "/swordfight") return <SwordfightPractice />;
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
        <Routes />
      </PirateProvider>
    </Router>
  );
}
