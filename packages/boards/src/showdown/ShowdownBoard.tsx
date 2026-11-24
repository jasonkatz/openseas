import { useEffect, useRef } from "react";
import { showdownViewString, type ShowdownMove, type ShowdownState } from "@openseas/engine";
import { t } from "../content.js";
import { useKitBoard } from "../kit/useKitBoard.js";
import { ShowdownRenderer } from "./renderer.js";

export interface ShowdownBoardProps {
  state: ShowdownState;
  version?: number;
  interactive: boolean;
  /** Frame a move worth making after a pause: on for practice, off for recorded rounds. */
  hints: boolean;
  onMove(move: ShowdownMove): void;
  /** A rival is to act: the board asks for its action at its own pace. */
  onNext(): void;
  onFrame(): void;
}

/** Hosts the Showdown canvas (prototype, ADR 0036). All drawing lives in the renderer; every number shown is the engine's. */
export function ShowdownBoard(props: ShowdownBoardProps) {
  const latest = useRef(props);
  latest.current = props;
  const { host, renderer } = useKitBoard<ShowdownState, ShowdownRenderer>(
    (el) =>
      new ShowdownRenderer(
        el,
        {
          onMove: (move) => latest.current.onMove(move),
          onNext: () => latest.current.onNext(),
          onFrame: () => latest.current.onFrame(),
        },
        {
          hints: props.hints,
          labels: {
            fold: t("showdown.fold"),
            check: t("showdown.check"),
            call: (amount) => t("showdown.call", { amount }),
            bet: (amount) => t("showdown.bet", { amount }),
            raise: (amount) => t("showdown.raise", { amount }),
            capped: t("showdown.capped"),
            short: t("showdown.short"),
            deal: t("showdown.deal"),
            you: t("showdown.you"),
            style: (style) => t(`showdown.style.${style}`),
            waiting: (name) => t("showdown.waiting", { name }),
            act: (action, amount) => t(`showdown.act.${action}`, { amount }),
            allIn: (amount) => t("showdown.all_in", { amount }),
            out: t("showdown.out"),
            chips: (amount) => t("showdown.chips_value", { amount }),
            blind: (amount) => t("showdown.blind", { amount }),
            pot: (amount) => t("showdown.pot_value", { amount }),
            hand: (name) => t(`showdown.hands.${name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`),
            youWin: (amount) => t("showdown.you_win", { amount }),
            theyWin: (name, amount) => t("showdown.they_win", { name, amount }),
            split: t("showdown.split"),
            trap: t("showdown.trap"),
            youOut: t("showdown.you_out"),
            theyOut: (name) => t("showdown.they_out", { name }),
          },
        },
      ),
    props,
  );

  useEffect(() => {
    renderer.current?.setHints(props.hints);
  }, [props.hints, renderer]);

  return <div ref={host} className="board-host" data-testid="showdown-board" data-board={showdownViewString(props.state)} />;
}
