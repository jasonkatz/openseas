import { useEffect, useState } from "react";
import { t, type LabClock } from "@openseas/boards";
import { SPEEDS } from "../scenario/codec.js";

export interface ClockPanelProps {
  clock: LabClock | null;
  /** Round start on the clock, for the elapsed readout. */
  startedAt: number | null;
  tickMs: number | null;
  playing: boolean;
}

/** Speed, pause and stepping for a lab round's clock. The game's modes show why they have none. */
export function ClockPanel({ clock, startedAt, tickMs, playing }: ClockPanelProps) {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!clock) return;
    const off = clock.onChange(() => bump((n) => n + 1));
    const id = window.setInterval(() => bump((n) => n + 1), 250);
    return () => {
      off();
      window.clearInterval(id);
    };
  }, [clock]);

  if (!playing) return null;
  if (!clock) {
    return (
      <section className="bench-section">
        <h3>{t("harness.clock")}</h3>
        <p className="muted small">{t("harness.clock_fixed")}</p>
      </section>
    );
  }
  const elapsedMs = startedAt === null ? 0 : Math.max(0, clock.now() - startedAt);
  const tick = tickMs ? Math.max(0, Math.floor(elapsedMs / tickMs) - 1) : null;
  return (
    <section className="bench-section" data-testid="clock">
      <h3>{t("harness.clock")}</h3>
      <div className="bench-inline">
        <select value={clock.speed} onChange={(e) => clock.setSpeed(Number(e.target.value))} data-testid="clock-speed">
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {t("harness.speed_label", { rate: s })}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-mini" onClick={() => (clock.isPaused ? clock.resume() : clock.pause())} data-testid="clock-pause" aria-pressed={clock.isPaused}>
          {clock.isPaused ? t("harness.clock_resume") : t("harness.clock_pause")}
        </button>
        <button type="button" className="btn btn-mini" onClick={() => clock.step(tickMs ?? 1000)} data-testid="clock-step">
          {tickMs ? t("harness.clock_step_tick") : t("harness.clock_step_second")}
        </button>
      </div>
      <p className="muted small mono" data-testid="clock-readout">
        {t("harness.clock_elapsed", { seconds: (elapsedMs / 1000).toFixed(1) })}
        {tick !== null && ` · ${t("harness.clock_tick", { tick })}`}
        {clock.isPaused && ` · ${t("harness.clock_paused")}`}
      </p>
    </section>
  );
}
