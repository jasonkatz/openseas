/** Input-to-render latency samples, reported with each finished round (DESIGN.md 5.3). */
export class LatencyMeter {
  private samples: number[] = [];
  private pending: number | null = null;

  /** Call when the player's input is received. */
  markInput(now = performance.now()): void {
    this.pending = now;
  }

  /** Call once the frame reflecting that input has been presented. */
  markRendered(now = performance.now()): void {
    if (this.pending === null) return;
    this.samples.push(now - this.pending);
    this.pending = null;
    if (this.samples.length > 2000) this.samples.splice(0, this.samples.length - 2000);
  }

  summary(): { inputToRenderP50: number; inputToRenderP95: number; samples: number } {
    const sorted = [...this.samples].sort((a, b) => a - b);
    const pct = (p: number): number => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]! : 0);
    return { inputToRenderP50: round(pct(0.5)), inputToRenderP95: round(pct(0.95)), samples: sorted.length };
  }
}

const round = (n: number): number => Math.round(n * 100) / 100;
