import { t } from "../content.js";
import type { TierPaceValue } from "./useTierPace.js";

/**
 * The live tier indicator every board's HUD carries (ADR 0039): a pip for each tier, filled up to
 * the one the player is playing at, and its name. The pips' count and the name say it without color.
 */
export function TierPace({ pace, label = true }: { pace: TierPaceValue | null; label?: boolean }) {
  if (!pace) return null;
  const name = t(`tier.${pace.tier}`);
  return (
    <span className={`tier-pace tier-pace-${pace.index}`} role="img" aria-label={t("practice.pace_now", { tier: name })} title={t("practice.pace_now", { tier: name })} data-testid="hud-pace" data-tier={pace.tier}>
      <span className="pace-pips" aria-hidden="true">
        {Array.from({ length: pace.count }, (_, i) => (
          <i key={i} className={i <= pace.index ? "on" : undefined} style={{ height: `${40 + (60 * (i + 1)) / pace.count}%` }} />
        ))}
      </span>
      {label && (
        <b key={pace.tier} className="pace-name">
          {name}
        </b>
      )}
    </span>
  );
}
