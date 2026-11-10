import type { OverloadState } from "@openseas/engine";

export interface OverloadBoardProps {
  state: OverloadState;
  version?: number;
  interactive: boolean;
  showMarks: boolean;
  onFrame(): void;
}

/** Overload (prototype, ADR 0036). This is the stub the real board replaces. */
export function OverloadBoard(_props: OverloadBoardProps) {
  return <div className="board-host" data-testid="overload-board" />;
}
