import { PirateProvider, usePirate } from "@openseas/boards";
import { Landing } from "./shell/Landing.jsx";
import { Shell } from "./shell/Shell.jsx";
import { BattleProvider } from "./ship/battle/useBattle.js";
import { MeleeProvider } from "./ship/melee/useMelee.js";
import { PlaceProvider } from "./state/place.jsx";
import { CrewProvider } from "./state/CrewProvider.jsx";
import { SheetProvider } from "./state/SheetProvider.jsx";
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
      <BattleProvider>
        <MeleeProvider>
          <SocialProvider>
            <ToastProvider>
              <SheetProvider>
                <CrewProvider>
                  <PlaceProvider>
                    <Shell />
                  </PlaceProvider>
                </CrewProvider>
              </SheetProvider>
            </ToastProvider>
          </SocialProvider>
        </MeleeProvider>
      </BattleProvider>
    </ShipProvider>
  );
}

export function App() {
  return (
    <PirateProvider offerSignIn>
      <Game />
    </PirateProvider>
  );
}
