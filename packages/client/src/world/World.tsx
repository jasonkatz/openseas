import { useEffect, useRef, useState } from "react";
import { t } from "@openseas/boards";
import type { WorldEvents, WorldInput, WorldScene } from "./scene.js";

export type { Deck, DeckCrew, DeckStation, Focus, Insets, IslandWalk, WorldInput, WorldShip, WorldShipLocation, WorldWalker } from "./scene.js";

export interface WorldProps {
  input: WorldInput;
  events: WorldEvents;
}

/**
 * The world as a React host around the three.js scene. The scene module is loaded on demand so the
 * first paint is the landing card, not a bundle. Without WebGL the shell says so; every place is
 * still reachable from the cards, which carry the same actions as the spots in the scene.
 */
export function World({ input, events }: WorldProps) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<WorldScene | null>(null);
  const latest = useRef({ input, events });
  latest.current = { input, events };
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    void import("./scene.js")
      .then(({ WorldScene }) => {
        if (!alive || !host.current) return;
        const s = new WorldScene(host.current, {
          onIsland: (id) => latest.current.events.onIsland(id),
          onShip: (id) => latest.current.events.onShip(id),
          onBuilding: (islandId, b) => latest.current.events.onBuilding(islandId, b),
          onStation: (st) => latest.current.events.onStation(st),
          onWheel: () => latest.current.events.onWheel(),
          onWalk: (x, z) => latest.current.events.onWalk(x, z),
          onPirate: (id) => latest.current.events.onPirate(id),
          onGangway: () => latest.current.events.onGangway(),
        });
        s.onReady = () => setReady(true);
        s.setInput(latest.current.input);
        s.start();
        scene.current = s;
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
      scene.current?.dispose();
      scene.current = null;
    };
  }, []);

  useEffect(() => {
    scene.current?.setInput(input);
  }, [input]);

  return (
    <div
      ref={host}
      className={`world ${ready ? "is-ready" : ""} ${failed ? "is-failed" : ""}`}
      data-testid="world"
      data-ready={ready ? "1" : "0"}
      data-focus={input.focus.kind === "all" ? "all" : `${input.focus.kind}:${input.focus.id}`}
      data-ships={input.ships.length}
    >
      {failed && (
        <p className="world-fallback" role="status">
          {t("world.webgl_missing")}
        </p>
      )}
    </div>
  );
}
