import { PirateProvider, usePirate } from "@openseas/boards";
import { Landing } from "./shell/Landing.jsx";
import { Shell } from "./shell/Shell.jsx";
import { PlaceProvider } from "./state/place.jsx";
import { ShipProvider } from "./state/ShipProvider.jsx";
import { SocialProvider } from "./state/SocialProvider.jsx";
import { ToastProvider } from "./state/toasts.jsx";

/**
 * The game: one graphical experience (ADR 0018, ADR 0020, DESIGN.md 3.11). A pirate signs in on the
 * landing and is in the world until they sign out.
 */
function Game() {
  const { phase, pirate } = usePirate();
  if (phase !== "ready" || !pirate) return <Landing />;
  return (
    <ShipProvider>
      <SocialProvider>
        <ToastProvider>
          <PlaceProvider>
            <Shell />
          </PlaceProvider>
        </ToastProvider>
      </SocialProvider>
    </ShipProvider>
  );
}

export function App() {
  return (
    <PirateProvider>
      <Game />
    </PirateProvider>
  );
}
