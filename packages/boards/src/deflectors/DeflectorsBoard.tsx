import type { DeflectorsState } from "@openseas/engine";

export interface DeflectorsBoardProps {
  state: DeflectorsState;
  version?: number;
  interactive: boolean;
  showMarks: boolean;
  onFrame(): void;
}

/** Deflectors (prototype, ADR 0036). This is the stub the real board replaces. */
export function DeflectorsBoard(_props: DeflectorsBoardProps) {
  return <div className="board-host" data-testid="deflectors-board" />;
}
