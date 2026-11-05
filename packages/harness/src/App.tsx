import { PirateProvider } from "@openseas/boards";
import { Home } from "./pages/Home.jsx";
import { BattlePractice } from "./pages/BattlePractice.jsx";
import { BilgingPractice } from "./pages/BilgingPractice.jsx";
import { CarpentryPractice } from "./pages/CarpentryPractice.jsx";
import { GunneryPractice } from "./pages/GunneryPractice.jsx";
import { NavigationPractice } from "./pages/NavigationPractice.jsx";
import { SailingPractice } from "./pages/SailingPractice.jsx";
import { SwordfightPractice } from "./pages/SwordfightPractice.jsx";
import { Router, useRoute } from "./router.jsx";

/** One route per engine. The scenario a page opens on rides in the query string (scenario/codec.ts). */
function Routes() {
  const { path } = useRoute();
  if (path === "/bilging") return <BilgingPractice />;
  if (path === "/sailing") return <SailingPractice />;
  if (path === "/carpentry") return <CarpentryPractice />;
  if (path === "/gunnery") return <GunneryPractice />;
  if (path === "/navigation") return <NavigationPractice />;
  if (path === "/battle") return <BattlePractice />;
  if (path === "/swordfight") return <SwordfightPractice />;
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
