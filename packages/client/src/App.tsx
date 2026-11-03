import { PirateProvider } from "@openseas/boards";
import { Home } from "./pages/Home.jsx";
import { Router } from "./router.jsx";

/**
 * The game: one graphical experience (ADR 0018, DESIGN.md 3.11), being rebuilt from the shell out.
 * The practice pages live in the harness now. Until the shell lands, the game opens on the
 * pirate's card and nothing more.
 */
export function App() {
  return (
    <Router>
      <PirateProvider>
        <Home />
      </PirateProvider>
    </Router>
  );
}
