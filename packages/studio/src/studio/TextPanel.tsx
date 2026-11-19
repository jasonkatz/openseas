import { useEffect, useMemo, useRef, useState } from "react";
import { PUZZLE_CATEGORIES } from "@openseas/content";
import { TEXT_MAX, textVars, type PuzzleCategory } from "@openseas/protocol";
import { content, shippedMessage, t } from "@openseas/boards";
import { useFrame } from "../frame/RoundFrame.jsx";
import { ResetIcon } from "../tuning/TuningPanel.jsx";
import { useWidePanel } from "./wide.js";
import { TEXT_GROUPS, textEntries, textMatches, textProblem, type TextEntry } from "./texts.js";

export { textMatches, type TextEntry };

/**
 * The Text panel (DESIGN.md 3.14, ADR 0057): the puzzle's category, and every string of the
 * message table that is the puzzle's, each to rewrite. A string is the draft's once it differs
 * from the shipped one, the board says it at once, and a button puts it back. A string that
 * fills in a name (`{count}`) must keep it: an edit that drops one is refused where it is typed,
 * and the draft keeps the last words that were sound.
 */
export function TextPanel({ entries, query, shown }: { entries: readonly TextEntry[]; query: string; shown: boolean }) {
  const { puzzle, words, setText, setCategory } = useFrame();
  const q = query.trim().toLowerCase();
  const shippedCategory = content.puzzles[puzzle.id].category;
  const category = words.category ?? shippedCategory;
  const groups = useMemo(() => TEXT_GROUPS.map((id) => ({ id, entries: entries.filter((e) => e.group === id) })).filter((g) => g.entries.length > 0 || g.id === "identity"), [entries]);
  const hit = (e: TextEntry): boolean => textMatches(e, words.texts[e.key] ?? e.shipped, q);
  const categoryHit = q === "" || `category ${t("studio.category")} ${t(`studio.category.${category}`)}`.toLowerCase().includes(q);
  return (
    <div className="tune" data-testid="text-panel" data-mode-panel="text" hidden={!shown}>
      {groups.map((g) => {
        const any = g.entries.some(hit) || (g.id === "identity" && categoryHit);
        return (
          <section key={g.id} className="panel-sec" hidden={!any} data-testid={`text-group-${g.id}`}>
            <h3 className="panel-cap">
              {q !== "" && <span className="panel-cap-mode">{t("studio.mode.text")}</span>}
              {t(`studio.text_group.${g.id}`)}
            </h3>
            {g.id === "identity" && (
              <div className={`num-row ${words.category ? "is-changed" : ""}`} hidden={!categoryHit} data-testid="control-category" data-changed={words.category ? "1" : "0"}>
                <div className="num-label" title={t("studio.category_hint")}>
                  <i className="num-dot" aria-hidden="true" />
                  <span className="num-name">{t("studio.category")}</span>
                </div>
                <div className="num-ctl">
                  <select value={category} aria-label={t("studio.category")} onChange={(e) => setCategory(e.target.value as PuzzleCategory)} data-testid="input-category">
                    {PUZZLE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {t(`studio.category.${c}`)}
                      </option>
                    ))}
                  </select>
                </div>
                {words.category && (
                  <button type="button" className="num-reset" onClick={() => setCategory(null)} aria-label={t("studio.reset_one", { key: t("studio.category"), value: t(`studio.category.${shippedCategory}`) })} title={t("studio.reset_one", { key: t("studio.category"), value: t(`studio.category.${shippedCategory}`) })} data-testid="reset-category">
                    <ResetIcon />
                  </button>
                )}
              </div>
            )}
            {g.entries.map((e) => (
              <TextRow key={e.key} entry={e} value={words.texts[e.key] ?? e.shipped} hidden={!hit(e)} onSet={(text) => setText(e.key, text)} />
            ))}
          </section>
        );
      })}
      <p className="panel-note panel-foot">{t("studio.text_note")}</p>
    </div>
  );
}

/** A string to rewrite. The field keeps what is typed; the draft takes it only while it is sound, and follows the draft when that changes under it. */
function TextRow({ entry: e, value, hidden, onSet }: { entry: TextEntry; value: string; hidden: boolean; onSet(text: string | null): void }) {
  const [text, setTextState] = useState(value);
  const typed = useRef(value);
  useEffect(() => {
    if (typed.current !== value) setTextState(value);
    typed.current = value;
  }, [value]);
  const problem = text === value ? null : textProblem(e.shipped, text);
  const changed = value !== e.shipped;
  const vars = textVars(e.shipped);
  const long = e.shipped.length > 34 || e.shipped.includes("\n");
  const change = (next: string): void => {
    setTextState(next);
    if (textProblem(e.shipped, next)) return;
    typed.current = next === e.shipped ? e.shipped : next;
    onSet(next);
  };
  const field = { value: text, maxLength: TEXT_MAX + 50, "aria-label": e.label, "data-testid": `input-text-${e.key}` } as const;
  // Opened wide, the shipped words stand beside the field, so a rewrite is read against what it replaces (ADR 0068).
  const wide = useWidePanel();
  return (
    <div className={`num-row is-block ${wide ? "is-side" : ""} ${changed ? "is-changed" : ""} ${problem ? "is-refused" : ""}`} hidden={hidden} data-testid={`text-${e.key}`} data-changed={changed ? "1" : "0"}>
      <div className="num-label" title={`${e.key}: ${e.shipped}`}>
        <i className="num-dot" aria-hidden="true" />
        <span className="num-name">{e.label}</span>
        {vars.map((v) => (
          <code key={v} className="num-unit">{`{${v}}`}</code>
        ))}
      </div>
      {wide && (
        <p className="text-shipped" aria-label={t("studio.text_shipped")} data-testid={`shipped-text-${e.key}`}>
          {e.shipped}
        </p>
      )}
      <div className="num-ctl">{long ? <textarea rows={Math.min(6, Math.ceil(text.length / 38) + 1)} onChange={(ev) => change(ev.target.value)} {...field} /> : <input type="text" onChange={(ev) => change(ev.target.value)} {...field} />}</div>
      {changed && (
        <button
          type="button"
          className="num-reset"
          onClick={() => {
            typed.current = e.shipped;
            setTextState(e.shipped);
            onSet(null);
          }}
          aria-label={t("studio.reset_one", { key: e.label, value: e.shipped })}
          title={t("studio.reset_one", { key: e.label, value: e.shipped })}
          data-testid={`reset-text-${e.key}`}
        >
          <ResetIcon />
        </button>
      )}
      {problem && (
        <p className="tune-refusal" role="alert" data-testid={`refusal-text-${e.key}`}>
          {t(`studio.text_problem.${problem}`, { vars: vars.map((v) => `{${v}}`).join(" ") })}
        </p>
      )}
    </div>
  );
}

/** The puzzle's strings, for the panel and for whoever asks where a changed one lives. */
export function useTextEntries(): readonly TextEntry[] {
  const { puzzle } = useFrame();
  return useMemo(() => textEntries(puzzle.id, content.messages).filter((e) => shippedMessage(e.key) !== undefined), [puzzle.id]);
}
