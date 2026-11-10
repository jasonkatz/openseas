import { useEffect, useRef } from "react";
import type { BattleEvent, BattlePlan, BattleState } from "@openseas/engine";
import { t } from "../content.js";
import { useBoardHost } from "../kit/useBoardHost.js";
import { BattleRenderer, battleViewString } from "./renderer.js";

export interface BattleBoardProps {
  state: BattleState;
  interactive: boolean;
  showMarks: boolean;
  showArcs: boolean;
  /** Ms left on the turn clock, or null when the clock is not running; and a turn's length. */
  turnLeftMs: number | null;
  turnMs: number;
  /** Bump to fly the plot as it stands: the host's turn clock ran out. */
  commitSignal: number;
  /** What to call the other ship. */
  raiderName: string;
  onCommit(plan: BattlePlan): void;
  onPlanChange?(plan: BattlePlan): void;
  onFrame(): void;
  onEvents(events: readonly BattleEvent[]): void;
  onNudge(): void;
}

/** Hosts the Pixi canvas and forwards input. All drawing lives in the renderer. */
export function BattleBoard(props: BattleBoardProps) {
  const planHost = useRef<HTMLDivElement>(null);
  const { host, renderer } = useBoardHost(
    (el, latest) =>
      new BattleRenderer(
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
            raider: props.raiderName,
            hull: t("battle.hull"),
            loaded: t("battle.turrets"),
            turn: (turn, max) => t("battle.turn", { turn, max }),
            slot: (n) => t("battle.slot", { n }),
            hold: t("battle.hold"),
            token: (tok) => t(`battle.token_${tok}`),
            port: t("battle.port"),
            starboard: t("battle.starboard"),
            grapple: t("battle.grapple"),
            fly: t("battle.fly_now"),
            clear: t("battle.clear"),
            hit: t("battle.hit"),
            hitTaken: t("battle.hit_taken"),
            miss: t("battle.miss"),
            asteroids: t("battle.asteroids"),
            rammed: t("battle.rammed"),
            blown: t("battle.carried"),
            spun: t("battle.spun"),
            outcome: (o) => t(`battle.${o}`),
            grappleReady: t("battle.grapple_ready"),
          },
        },
      ),
    props,
  );

  useEffect(() => {
    renderer.current?.setShowArcs(props.showArcs);
  }, [props.showArcs, renderer]);

  // The renderer only holds the clock, so it takes it before it is ready too.
  useEffect(() => {
    renderer.current?.setTurnClock(props.turnLeftMs, props.turnMs);
  }, [props.turnLeftMs, props.turnMs, renderer]);

  const firstSignal = useRef(props.commitSignal);
  useEffect(() => {
    if (props.commitSignal === firstSignal.current) return;
    const r = renderer.current;
    if (r?.isReady) r.commit();
  }, [props.commitSignal, renderer]);

  return (
    <div ref={host} className="board-host" data-testid="battle-board" data-board={battleViewString(props.state)}>
      <div ref={planHost} data-testid="battle-plan" data-plan='{"segments":[],"grapple":false}' hidden />
    </div>
  );
}
