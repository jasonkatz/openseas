import { t } from "@openseas/boards";
import type { HarnessPuzzle } from "../puzzles.js";
import { getPath, leaves, pruneOverrides, type Overrides } from "../scenario/overrides.js";
import { valueToText } from "./format.js";

export interface ConfigEditorProps<S, M, C> {
  puzzle: HarnessPuzzle<S, M, C>;
  overrides: Overrides;
  onChange(overrides: Overrides): void;
  disabled: boolean;
}

/**
 * A form over the content config, one field per leaf. Fields that differ from content are marked
 * and can be put back one at a time. Gunnery's decks get a picker rather than a JSON box.
 */
export function ConfigEditor<S, M, C>({ puzzle, overrides, onChange, disabled }: ConfigEditorProps<S, M, C>) {
  const fields = leaves(puzzle.config);
  const set = (path: string, value: unknown): void => onChange(pruneOverrides(puzzle.config, { ...overrides, [path]: value }));
  const unset = (path: string): void => {
    const next: Record<string, unknown> = { ...overrides };
    delete next[path];
    onChange(next);
  };
  const changed = fields.filter((f) => f.path in overrides).length;

  return (
    <div className="config-editor">
      <p className="muted small">{t("harness.config_overridden", { count: changed, total: fields.length })}</p>
      <ul className="config-fields">
        {fields.map(({ path, value: base }) => {
          const current = path in overrides ? overrides[path] : base;
          const overridden = path in overrides;
          const locked = puzzle.locked.includes(path);
          const id = `config-${puzzle.id}-${path.replace(/\./g, "-")}`;
          return (
            <li key={path} className={`config-field ${overridden ? "is-overridden" : ""}`}>
              <label htmlFor={id} title={locked ? t("harness.config_locked") : path}>
                {path}
              </label>
              <Field id={id} puzzle={puzzle} path={path} base={base} value={current} disabled={disabled || locked} onChange={(v) => set(path, v)} />
              {overridden && !disabled && (
                <button type="button" className="field-reset" onClick={() => unset(path)} title={t("harness.config_reset_field")} aria-label={t("harness.config_reset_field")}>
                  ↺
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Field<S, M, C>(props: { id: string; puzzle: HarnessPuzzle<S, M, C>; path: string; base: unknown; value: unknown; disabled: boolean; onChange(v: unknown): void }) {
  const { id, puzzle, path, base, value, disabled, onChange } = props;
  if (puzzle.id === "gunnery" && path === "decks") {
    const decks = getPath(puzzle.config, "decks") as ReadonlyArray<readonly string[]>;
    const chosen = Array.isArray(value) && value.length === 1 ? decks.findIndex((d) => JSON.stringify(d) === JSON.stringify(value[0])) : -1;
    return (
      <select id={id} value={chosen} disabled={disabled} data-testid={`config-field-${path}`} onChange={(e) => onChange(Number(e.target.value) < 0 ? base : [decks[Number(e.target.value)]])}>
        <option value={-1}>{t("harness.decks_all")}</option>
        {decks.map((_, i) => (
          <option key={i} value={i}>
            {t("harness.decks_one", { n: i + 1 })}
          </option>
        ))}
      </select>
    );
  }
  if (typeof base === "boolean") {
    return <input id={id} type="checkbox" checked={Boolean(value)} disabled={disabled} data-testid={`config-field-${path}`} onChange={(e) => onChange(e.target.checked)} />;
  }
  if (typeof base === "number") {
    return (
      <input
        id={id}
        type="number"
        inputMode="decimal"
        value={typeof value === "number" && Number.isFinite(value) ? value : ""}
        disabled={disabled}
        data-testid={`config-field-${path}`}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(e.target.value === "" || !Number.isFinite(n) ? Number.NaN : n);
        }}
      />
    );
  }
  // Strings and arrays: text, parsed as JSON when it parses (arrays), kept as text otherwise.
  return (
    <input
      id={id}
      type="text"
      value={valueToText(value)}
      disabled={disabled}
      data-testid={`config-field-${path}`}
      onChange={(e) => {
        const text = e.target.value;
        if (typeof base === "string") onChange(text);
        else {
          try {
            onChange(JSON.parse(text));
          } catch {
            onChange(text);
          }
        }
      }}
    />
  );
}
