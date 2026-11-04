import { useEffect, useRef } from "react";
import type { BattleEvent, BattlePlan, BattleState } from "@openseas/engine";
import { t } from "../content.js";
import { BattleRenderer, battleViewString } from "./renderer.js";

export interface BattleBoardProps {
  state: BattleState;
  interactive: boolean;
  showMarks: boolean;
  showArcs: boolean;
  /** Ms left on the turn clock, or null when the clock is not running; and a turn's length. */
  turnLeftMs: number | null;
  turnMs: number;
  /** Bump to sail the plot as it stands: the host's turn clock ran out. */
  commitSignal: number;
  /** What to call the other ship. */
  brigandName: string;
  onCommit(plan: BattlePlan): void;
  onPlanChange?(plan: BattlePlan): void;
  onFrame(): void;
  onEvents(events: readonly BattleEvent[]): void;
  onNudge(): void;
}

/** Hosts the Pixi canvas and forwards input. All drawing lives in the renderer. */
export function BattleBoard(props: BattleBoardProps) {
  const host = useRef<HTMLDivElement>(null);
  const renderer = useRef<BattleRenderer | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const planHost = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const r = new BattleRenderer(
      el,
      {
        onCommit: (plan) => latest.current.onCommit(plan),
        onPlanChange: (plan) => {
          planHost.current?.setAttribute("data-plan", JSON.stringify(plan));
          latest.current.onPlanChange?.(plan);
        },
        onFrame: () => latest.current.onFrame(),
        onEvents: (events) => latest.current.onEvents(events),
        onNudge: () => latest.current.onNudge(),
      },
      {
        showMarks: props.showMarks,
        showArcs: props.showArcs,
        labels: {
          you: t("battle.you"),
          brigand: props.brigandName,
          hull: t("battle.hull"),
          loaded: t("battle.cannons"),
          turn: (turn, max) => t("battle.turn", { turn, max }),
          slot: (n) => t("battle.slot", { n }),
          hold: t("battle.hold"),
          token: (tok) => t(`battle.token_${tok}`),
          port: t("battle.port"),
          starboard: t("battle.starboard"),
          grapple: t("battle.grapple"),
          sail: t("battle.sail_now"),
          clear: t("battle.clear"),
          hit: t("battle.hit"),
          hitTaken: t("battle.hit_taken"),
          miss: t("battle.miss"),
          rocks: t("battle.rocks"),
          rammed: t("battle.rammed"),
          blown: t("battle.blown"),
          spun: t("battle.spun"),
          outcome: (o) => t(`battle.${o}`),
          grappleReady: t("battle.grapple_ready"),
        },
      },
    );
    renderer.current = r;
    let alive = true;
    void r.init().then(() => {
      if (!alive) return;
      r.setState(latest.current.state);
      r.setInteractive(latest.current.interactive);
      r.setTurnClock(latest.current.turnLeftMs, latest.current.turnMs);
    });
    const onKey = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (r.keyboard(e.key)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      alive = false;
      window.removeEventListener("keydown", onKey);
      r.destroy();
      renderer.current = null;
    };
  }, []);

  useEffect(() => {
    const r = renderer.current;
    if (r && r.app.renderer) r.setState(props.state);
  }, [props.state]);

  useEffect(() => {
    const r = renderer.current;
    if (r && r.app.renderer) r.setInteractive(props.interactive);
  }, [props.interactive]);

  useEffect(() => {
    renderer.current?.setShowMarks(props.showMarks);
  }, [props.showMarks]);

  useEffect(() => {
    renderer.current?.setShowArcs(props.showArcs);
  }, [props.showArcs]);

  useEffect(() => {
    renderer.current?.setTurnClock(props.turnLeftMs, props.turnMs);
  }, [props.turnLeftMs, props.turnMs]);

  const firstSignal = useRef(props.commitSignal);
  useEffect(() => {
    if (props.commitSignal === firstSignal.current) return;
    const r = renderer.current;
    if (r && r.app.renderer) r.commit();
  }, [props.commitSignal]);

  return (
    <div ref={host} className="board-host" data-testid="battle-board" data-board={battleViewString(props.state)}>
      <div ref={planHost} data-testid="battle-plan" data-plan='{"segments":[],"grapple":false}' hidden />
    </div>
  );
}
