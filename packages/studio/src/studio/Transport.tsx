import { useEffect, useRef } from "react";
import { t } from "@openseas/boards";
import { useFrame } from "../frame/RoundFrame.jsx";
import { localSeed, type PracticePhase } from "../practice/usePractice.js";
import { Tool } from "./icons.jsx";
import { SPEEDS, useRoundClock } from "./roundClock.js";

/** True when a key pressed here is someone typing, not a shortcut. */
export function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

/**
 * Run `fn` on Alt and a key, wherever focus is but a field. The boards take plain letters and the
 * space bar for play (ADR 0068), so the studio's own keys all carry Alt, and are caught before a
 * board hears them. Matched on the key's place (`KeyP`), which Alt does not change on any layout.
 */
export function useAltKey(code: string, fn: () => void): void {
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.code !== code || e.repeat || typing(e.target)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      latest.current();
    };
    window.addEventListener("keydown", down, true);
    return () => window.removeEventListener("keydown", down, true);
  }, [code]);
}

const speedLabel = (s: number): string => (s === 0.5 ? "½×" : `${s}×`);

/**
 * The transport bar under the board (DESIGN.md 3.14, ADR 0068): the round played from any mode,
 * so a number can be tried without turning the rail back to Play. Start or go on, pause, step a
 * held round on, deal the same seed again, deal a fresh one, hold up the shipped numbers, and the
 * clock's speed. It drives the round's clock and the frame's own start, and nothing else: no move
 * is made or taken back here.
 */
export function Transport({ phase, onStart, ready }: { phase: PracticePhase; onStart(seed?: string): void; ready: boolean }) {
  const frame = useFrame();
  const { scenario, setScenario, report, changes, refusals } = frame;
  const { clock, tickMs, paused, speed } = useRoundClock();
  const playing = phase === "playing";
  const held = playing && paused;
  const seed = report.seed ?? scenario.seed;
  const canDeal = ready && refusals.length === 0;

  const toggle = (): void => {
    if (playing && clock) return clock.isPaused ? clock.resume() : clock.pause();
    if (ready) onStart();
  };
  const restart = (): void => {
    if (seed && ready) onStart(seed);
  };
  const deal = (): void => {
    if (!canDeal) return;
    const next = localSeed();
    // A pinned seed stays pinned: the new one takes its place.
    if (scenario.seed !== null) setScenario({ ...scenario, seed: next });
    onStart(next);
  };
  const setSpeed = (s: number): void => {
    clock?.setSpeed(s);
    setScenario({ ...scenario, speed: s });
  };
  const hold = (on: boolean) => (): void => frame.setComparing(on);

  useAltKey("KeyP", toggle);
  useAltKey("KeyR", restart);
  useAltKey("KeyN", deal);

  const playLabel = playing ? (paused ? t("studio.transport.resume") : t("studio.transport.pause")) : t("studio.transport.start");
  return (
    // A press does not take focus: the boards read Space and Enter, and a focused button would take them.
    <div className="transport st" role="toolbar" onMouseDown={(e) => e.preventDefault()} aria-label={t("studio.transport")} data-testid="transport" data-paused={held ? "1" : "0"}>
      <button type="button" className="tp-btn tp-main" disabled={!playing && !ready} onClick={toggle} aria-label={playLabel} data-tip={`${playLabel} · Alt P`} data-testid="transport-play">
        <Tool icon={playing && !paused ? "pause" : "play"} />
      </button>
      <button type="button" className="tp-btn" disabled={!held} onClick={() => clock?.step(tickMs ?? 1000)} aria-label={t("studio.transport.step")} data-tip={t("studio.transport.step")} data-testid="transport-step">
        <Tool icon="step" />
      </button>
      <span className="tp-gap" aria-hidden="true" />
      <button type="button" className="tp-btn" disabled={!seed || !ready} onClick={restart} aria-label={t("studio.transport.restart")} data-tip={`${t("studio.transport.restart")} · Alt R`} data-testid="transport-restart">
        <Tool icon="restart" />
      </button>
      <button type="button" className="tp-btn" disabled={!canDeal} onClick={deal} aria-label={t("studio.transport.deal")} data-tip={`${t("studio.transport.deal")} · Alt N`} data-testid="transport-deal">
        <Tool icon="deal" />
      </button>
      <button
        type="button"
        className={`tp-btn ${frame.comparing ? "is-held" : ""}`}
        disabled={changes.length === 0 || phase === "idle"}
        onPointerDown={hold(true)}
        onPointerUp={hold(false)}
        onPointerLeave={hold(false)}
        onPointerCancel={hold(false)}
        onKeyDown={(e) => (e.key === " " || e.key === "Enter") && !e.repeat && frame.setComparing(true)}
        onKeyUp={hold(false)}
        onBlur={hold(false)}
        aria-pressed={frame.comparing}
        aria-label={t("studio.compare")}
        data-tip={t("studio.compare_hint")}
        data-testid="compare"
      >
        <Tool icon="compare" />
      </button>
      <span className="tp-gap" aria-hidden="true" />
      <div className="tp-speed" role="radiogroup" aria-label={t("studio.transport.speed")}>
        {SPEEDS.map((s) => (
          <button key={s} type="button" role="radio" className="tp-seg mono" aria-checked={(clock ? speed : scenario.speed) === s} onClick={() => setSpeed(s)} data-testid={`transport-speed-${s}`}>
            {speedLabel(s)}
          </button>
        ))}
      </div>
    </div>
  );
}
