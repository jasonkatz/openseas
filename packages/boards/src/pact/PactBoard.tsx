import { useEffect, useRef } from "react";
import { pactViewString, type PactMove, type PactState } from "@openseas/engine";
import { t } from "../content.js";
import { useKitBoard } from "../kit/useKitBoard.js";
import { PactRenderer } from "./renderer.js";

export interface PactBoardProps {
  state: PactState;
  version?: number;
  interactive: boolean;
  /** Frame a bid or card worth making after a pause: on for practice, off for recorded rounds. */
  hints: boolean;
  onMove(move: PactMove): void;
  /** Another seat is to act: the board asks for its bid or card at its own pace. */
  onNext(): void;
  onFrame(): void;
}

/** Hosts the Pact canvas (prototype, ADR 0036). All drawing lives in the renderer; every number shown is the engine's. */
export function PactBoard(props: PactBoardProps) {
  const latest = useRef(props);
  latest.current = props;
  const { host, renderer } = useKitBoard<PactState, PactRenderer>(
    (el) =>
      new PactRenderer(
        el,
        {
          onMove: (move) => latest.current.onMove(move),
          onNext: () => latest.current.onNext(),
          onFrame: () => latest.current.onFrame(),
        },
        {
          hints: props.hints,
          labels: {
            seats: [t("pact.you"), t("pact.left"), t("pact.partner"), t("pact.right")],
            bidPrompt: t("pact.bid_prompt"),
            pickBid: t("pact.pick_bid"),
            bidButton: (bid) => t("pact.bid_button", { bid }),
            bidNilButton: t("pact.bid_nil_button"),
            nil: t("pact.nil"),
            bidOf: (bid) => t("pact.bid_of", { bid }),
            waiting: (name) => t("pact.waiting", { name }),
            waitingBid: (name) => t("pact.waiting_bid", { name }),
            yourTurn: t("pact.your_turn"),
            yourLead: t("pact.your_lead"),
            broken: t("pact.broken"),
            trickYou: t("pact.trick_you"),
            trickPartner: t("pact.trick_partner"),
            trickThem: (name) => t("pact.trick_them", { name }),
            deal: t("pact.deal"),
            lastHand: t("pact.last_hand"),
            countTitle: (hand) => t("pact.count_title", { hand }),
            countPact: (took, pact) => t("pact.count_pact", { took, pact }),
            made: t("pact.count_made"),
            short: t("pact.count_short"),
            nilMade: t("pact.count_nil_made"),
            nilLost: t("pact.count_nil_lost"),
            bags: (bags) => t("pact.count_bags", { bags }),
            penalty: t("pact.count_penalty"),
            set: t("pact.count_set"),
            added: (points) => t("pact.count_added", { points }),
            total: (total) => t("pact.count_total", { total }),
            us: t("pact.us"),
            them: t("pact.them"),
            calloutMade: t("pact.callout_made"),
            calloutShort: t("pact.callout_short"),
            calloutNil: t("pact.callout_nil"),
            calloutSet: t("pact.callout_set"),
          },
        },
      ),
    props,
  );

  useEffect(() => {
    renderer.current?.setHints(props.hints);
  }, [props.hints, renderer]);

  return <div ref={host} className="board-host" data-testid="pact-board" data-board={pactViewString(props.state)} />;
}
