import { useEffect, useRef } from "react";
import { parPerTurn, soloHeatStart, soloHeatTurn, soloHeatTurnsDue, type CoolingConfig, type CoolingMove, type CoolingState, type SoloHeat } from "@openseas/engine";
import type { ServerMessage } from "@openseas/protocol";
import { content, usePirate } from "@openseas/boards";
import type { PracticeApi } from "./usePractice.js";

const rules = content.world.ship;
const par = parPerTurn(rules, content.puzzles.cooling);
const STEP_MS = 200;

/**
 * A harness Cooling round plays against a lone ship's heat (ADR 0029), as a duty board plays
 * against its ship's. The board starts at the lone ship's depth. A recorded round then logs the
 * depths the server's lone ship pushes; an unrated or lab round runs the same ship here, on the
 * round's own clock, so a paused or slowed lab clock holds the heat too. A config without ship
 * heat keeps the board's own practice heat and is left alone.
 */
export function useSoloHeat(api: PracticeApi<CoolingState, CoolingMove, CoolingConfig>): void {
  const { socket } = usePirate();
  const latest = useRef(api);
  latest.current = api;
  const ship = useRef<{ round: object; solo: SoloHeat; turns: number } | null>(null);
  const playing = api.phase === "playing";
  const mode = api.round?.mode ?? null;
  const sessionId = api.round?.sessionId ?? null;

  useEffect(() => {
    if (!playing) return;
    const step = (): void => {
      const a = latest.current;
      const r = a.current();
      if (!r || r.isFinished) return;
      const cfg = r.state.config;
      if (!cfg.shipHeat) return;
      // The deal: the board starts at a dry, sound ship's depth, which is the heat's floor.
      if (ship.current?.round !== r) {
        const solo = soloHeatStart(cfg);
        ship.current = { round: r, solo, turns: 0 };
        if (r.state.heatRow !== solo.row) a.apply({ type: "heat", row: solo.row }, false);
      }
      if (mode === "recorded") return;
      const due = soloHeatTurnsDue(rules, Math.min(r.elapsedMs(), r.lengthMs - 1));
      const s = ship.current;
      if (s.turns >= due) return;
      let solo = s.solo;
      for (let t = s.turns; t < due; t++) solo = soloHeatTurn(rules, par, solo, r.state.score, cfg);
      ship.current = { round: r, solo, turns: due };
      if (solo.row !== r.state.heatRow) a.apply({ type: "heat", row: solo.row }, false);
    };
    step();
    const id = window.setInterval(step, STEP_MS);
    return () => window.clearInterval(id);
  }, [playing, mode]);

  // A recorded round's depth is the server's word, pushed each time its lone ship's heat moves.
  useEffect(() => {
    if (mode !== "recorded" || !sessionId) return;
    return socket.onMessage((m: ServerMessage) => {
      if (m.type !== "duty.heat" || m.sessionId !== sessionId) return;
      const r = latest.current.current();
      if (!r || r.isFinished) return;
      latest.current.apply({ type: "heat", row: m.row }, false);
    });
  }, [socket, mode, sessionId]);
}
