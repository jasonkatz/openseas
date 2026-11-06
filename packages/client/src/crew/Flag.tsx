import { useMemo } from "react";
import type { CrewFlagWire } from "@openseas/protocol";
import { content, t } from "@openseas/boards";
import { flagColor, flagDataUrl, flagLabel, FLAG_ASPECT } from "./flag.js";

/** A crew's flag as an image, `size` pixels tall, painted at twice that for sharp screens. */
export function Flag({ flag, size = 18, className = "", decorative = false }: { flag: CrewFlagWire; size?: number; className?: string; decorative?: boolean }) {
  const src = useMemo(() => flagDataUrl(flag, Math.round(size * 2)), [flag, size]);
  const label = flagLabel(flag);
  return (
    <img
      className={`flag ${className}`}
      src={src}
      width={Math.round(size * FLAG_ASPECT)}
      height={size}
      alt={decorative ? "" : label}
      title={label}
      draggable={false}
      data-flag={`${flag.field}.${flag.accent}.${flag.pattern}.${flag.emblem}`}
    />
  );
}

const rules = content.world.crews;
const pick = <T,>(list: readonly T[], n: number): T => list[n % list.length]!;

/** A flag nobody has asked for yet: for the dice button, and a founder who wants a surprise. */
export function randomFlag(seed = Math.floor(Math.random() * 1e9)): CrewFlagWire {
  let x = seed;
  const next = (): number => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return Math.floor(x / 65536);
  };
  const field = pick(rules.colors, next()).id;
  let accent = pick(rules.colors, next()).id;
  if (accent === field) accent = rules.colors.find((c) => c.id !== field)!.id;
  return { field, accent, pattern: pick(rules.patterns, next()).id, emblem: pick(rules.emblems, next()).id };
}

/**
 * Build a flag from its parts: two colors, a pattern and an emblem, each picked from content, with
 * the whole flag previewed large and every choice drawn as the flag it would make.
 */
export function FlagEditor({ flag, onChange }: { flag: CrewFlagWire; onChange(f: CrewFlagWire): void }) {
  const set = (part: Partial<CrewFlagWire>): void => {
    const next = { ...flag, ...part };
    // The emblem must always show: two colors the same swap round.
    if (next.field === next.accent) {
      if (part.field) next.accent = flag.field;
      else next.field = flag.accent;
    }
    onChange(next);
  };
  return (
    <div className="flag-editor" data-testid="flag-editor">
      <div className="flag-preview">
        <Flag flag={flag} size={84} />
        <button type="button" className="btn btn-ghost btn-small" onClick={() => onChange(randomFlag())} data-testid="flag-dice">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
            <rect x="4" y="4" width="16" height="16" rx="3.5" />
            <circle cx="9" cy="9" r="1.3" fill="currentColor" />
            <circle cx="15" cy="15" r="1.3" fill="currentColor" />
            <circle cx="15" cy="9" r="1.3" fill="currentColor" />
            <circle cx="9" cy="15" r="1.3" fill="currentColor" />
          </svg>
          {t("crew.flag_dice")}
        </button>
      </div>
      <fieldset className="flag-row">
        <legend>{t("crew.flag_field")}</legend>
        <Swatches value={flag.field} onPick={(id) => set({ field: id })} testId="flag-field" />
      </fieldset>
      <fieldset className="flag-row">
        <legend>{t("crew.flag_accent")}</legend>
        <Swatches value={flag.accent} onPick={(id) => set({ accent: id })} testId="flag-accent" />
      </fieldset>
      <fieldset className="flag-row">
        <legend>{t("crew.flag_pattern")}</legend>
        <div className="flag-choices">
          {rules.patterns.map((p) => (
            <button
              type="button"
              key={p.id}
              className={`flag-choice ${flag.pattern === p.id ? "is-on" : ""}`}
              aria-pressed={flag.pattern === p.id}
              aria-label={t(p.nameKey)}
              title={t(p.nameKey)}
              onClick={() => set({ pattern: p.id })}
              data-testid={`flag-pattern-${p.id}`}
            >
              <Flag flag={{ ...flag, pattern: p.id }} size={26} decorative />
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="flag-row">
        <legend>{t("crew.flag_emblem")}</legend>
        <div className="flag-choices">
          {rules.emblems.map((e) => (
            <button
              type="button"
              key={e.id}
              className={`flag-choice ${flag.emblem === e.id ? "is-on" : ""}`}
              aria-pressed={flag.emblem === e.id}
              aria-label={t(e.nameKey)}
              title={t(e.nameKey)}
              onClick={() => set({ emblem: e.id })}
              data-testid={`flag-emblem-${e.id}`}
            >
              <Flag flag={{ ...flag, emblem: e.id, pattern: "plain" }} size={26} decorative />
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

function Swatches({ value, onPick, testId }: { value: string; onPick(id: string): void; testId: string }) {
  return (
    <div className="swatches" role="radiogroup">
      {rules.colors.map((c) => (
        <button
          type="button"
          key={c.id}
          role="radio"
          aria-checked={value === c.id}
          className={`swatch ${value === c.id ? "is-on" : ""}`}
          style={{ background: flagColor(c.id) }}
          aria-label={t(c.nameKey)}
          title={t(c.nameKey)}
          onClick={() => onPick(c.id)}
          data-testid={`${testId}-${c.id}`}
        >
          {value === c.id && (
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.5 4.5L19 7" stroke="#000" strokeOpacity="0.55" />
              <path d="M5 12.5l4.5 4.5L19 7" stroke="#fff" strokeWidth="1.8" />
            </svg>
          )}
        </button>
      ))}
    </div>
  );
}
