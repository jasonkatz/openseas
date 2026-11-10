import type { ScannerState } from "@openseas/engine";

export interface ScannerBoardProps {
  state: ScannerState;
  version?: number;
  interactive: boolean;
  showMarks: boolean;
  onFrame(): void;
}

/** Scanner (prototype, ADR 0036). This is the stub the real board replaces. */
export function ScannerBoard(_props: ScannerBoardProps) {
  return <div className="board-host" data-testid="scanner-board" />;
}
