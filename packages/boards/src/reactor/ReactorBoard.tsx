import type { ReactorState } from "@openseas/engine";

export interface ReactorBoardProps {
  state: ReactorState;
  version?: number;
  interactive: boolean;
  showMarks: boolean;
  onFrame(): void;
}

/** Reactor (prototype, ADR 0036). This is the stub the real board replaces. */
export function ReactorBoard(_props: ReactorBoardProps) {
  return <div className="board-host" data-testid="reactor-board" />;
}
