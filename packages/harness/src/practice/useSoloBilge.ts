import { useEffect, useRef } from "react";
import { parPerTurn, soloBilgeStart, soloBilgeTurn, soloBilgeTurnsDue, type BilgingConfig, type BilgingMove, type BilgingState, type SoloBilge } from "@openseas/engine";
import type { ServerMessage } from "@openseas/protocol";
import { content, usePirate } from "@openseas/boards";
import type { PracticeApi } from "./usePractice.js";

const rules = content.world.ship;
const par = parPerTurn(rules, content.puzzles.bilging);
const STEP_MS = 200;

/**
 * A harness Bilging round plays against a lone ship's bilge (ADR 0029), as a duty board plays
 * against its ship's. The board starts at the lone ship's depth. A recorded round then logs the
 * depths the server's lone ship pushes; an unrated or lab round runs the same ship here, on the
 * round's own clock, so a paused or slowed lab clock holds the water too. A config without ship
 * water keeps the board's own practice water and is left alone.
 */
export function useSoloBilge(api: PracticeApi<BilgingState, BilgingMove, BilgingConfig>): void {
  const { socket } = usePirate();
  const latest = useRef(api);
  latest.current = api;
  const ship = useRef<{ round: object; bilge: SoloBilge; turns: number } | null>(null);
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
      if (!cfg.shipWater) return;
      // The deal: the board starts at a dry, sound ship's depth, which is the bilge's floor.
      if (ship.current?.round !== r) {
        const bilge = soloBilgeStart(cfg);
        ship.current = { round: r, bilge, turns: 0 };
        if (r.state.waterRow !== bilge.row) a.apply({ type: "water", row: bilge.row }, false);
      }
      if (mode === "recorded") return;
      const { startedAt, deadlineAt, clock } = r.opts;
      const due = soloBilgeTurnsDue(rules, Math.min(clock.now(), deadlineAt - 1) - startedAt);
      const s = ship.current;
      if (s.turns >= due) return;
      let bilge = s.bilge;
      for (let t = s.turns; t < due; t++) bilge = soloBilgeTurn(rules, par, bilge, r.state.score, cfg);
      ship.current = { round: r, bilge, turns: due };
      if (bilge.row !== r.state.waterRow) a.apply({ type: "water", row: bilge.row }, false);
    };
    step();
    const id = window.setInterval(step, STEP_MS);
    return () => window.clearInterval(id);
  }, [playing, mode]);

  // A recorded round's depth is the server's word, pushed each time its lone ship's bilge moves.
  useEffect(() => {
    if (mode !== "recorded" || !sessionId) return;
    return socket.onMessage((m: ServerMessage) => {
      if (m.type !== "duty.water" || m.sessionId !== sessionId) return;
      const r = latest.current.current();
      if (!r || r.isFinished) return;
      latest.current.apply({ type: "water", row: m.row }, false);
    });
  }, [socket, mode, sessionId]);
}
