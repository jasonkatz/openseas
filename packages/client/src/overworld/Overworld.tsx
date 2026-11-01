import { useEffect, useRef, useState } from "react";
import type { ShipLocation } from "@openseas/protocol";
import { content, t } from "../content.js";
import type { ChartInput, ChartShip, OverworldScene } from "./scene.js";

export type { ChartShip } from "./scene.js";

export interface OverworldProps {
  ships: ChartShip[];
  here: string | null;
  selected?: string | null;
  selectedShip?: string | null;
  reachable?: string[];
  /** Ms a ship takes to ease to a new progress; the ship's turn length is the natural value. */
  smoothMs?: number;
  compact?: boolean;
  onIsland?(id: string): void;
  onShip?(id: string): void;
}

export function chartLocation(l: ShipLocation): ChartShip["location"] {
  return l.kind === "docked" ? { kind: "docked", islandId: l.islandId } : { kind: "at-sea", from: l.from, to: l.to, progress: l.progress };
}

function inputFrom(p: OverworldProps): ChartInput {
  return {
    islands: content.world.islands.map((i) => ({ id: i.id, name: t(i.nameKey), x: i.x, y: i.y })),
    routes: content.world.routes.map((r) => ({ id: r.id, from: r.from, to: r.to })),
    ships: p.ships,
    here: p.here,
    selected: p.selected ?? null,
    reachable: p.reachable ?? [],
    selectedShip: p.selectedShip ?? null,
    smoothMs: p.smoothMs ?? 0,
  };
}

/**
 * The chart, as a React island around a three.js scene (ADR 0019). The scene module is loaded on
 * demand so puzzle pages never carry three.js. Without WebGL the frame says so; the notice board
 * lists the same ships.
 */
export function Overworld(p: OverworldProps) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<OverworldScene | null>(null);
  const latest = useRef(p);
  latest.current = p;
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    void import("./scene.js")
      .then(({ OverworldScene }) => {
        if (!alive || !host.current) return;
        const s = new OverworldScene(host.current, {
          onIsland: (id) => latest.current.onIsland?.(id),
          onShip: (id) => latest.current.onShip?.(id),
        });
        s.setInput(inputFrom(latest.current));
        s.start();
        scene.current = s;
        setReady(true);
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
    scene.current?.setInput(inputFrom(p));
  }, [p.ships, p.here, p.selected, p.selectedShip, p.reachable, p.smoothMs]);

  return (
    <div
      ref={host}
      className={`overworld ${p.compact ? "overworld-compact" : ""} ${ready ? "is-ready" : ""}`}
      data-testid="overworld"
      data-islands={content.world.islands.length}
      data-ships={p.ships.length}
      data-ready={ready ? "1" : "0"}
    >
      {failed && <p className="status ow-fallback">{t("sea.no_webgl")}</p>}
    </div>
  );
}
