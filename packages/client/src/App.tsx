import { Home } from "./pages/Home.jsx";
import { BilgingPractice } from "./pages/BilgingPractice.jsx";
import { GunneryPractice } from "./pages/GunneryPractice.jsx";
import { NavigationPractice } from "./pages/NavigationPractice.jsx";
import { SailingPractice } from "./pages/SailingPractice.jsx";
import { CarpentryPractice } from "./pages/CarpentryPractice.jsx";
import { Router, useRoute } from "./router.jsx";
import { PirateProvider } from "./state/PirateProvider.jsx";

function Routes() {
  const { path } = useRoute();
  if (path === "/practice/bilging") return <BilgingPractice />;
  if (path === "/practice/sailing") return <SailingPractice />;
  if (path === "/practice/carpentry") return <CarpentryPractice />;
  if (path === "/practice/gunnery") return <GunneryPractice />;
  if (path === "/practice/navigation") return <NavigationPractice />;
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
