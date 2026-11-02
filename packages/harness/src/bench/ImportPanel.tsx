import { useState } from "react";
import { t } from "@openseas/boards";
import type { PuzzleId } from "@openseas/engine";
import { parseRoundFile, type RoundFile } from "../review/roundFile.js";

export interface ImportPanelProps {
  puzzle: PuzzleId;
  disabled: boolean;
  onLoad(round: RoundFile, notes: string[]): string | null;
}

export function importErrorText(error: string): string {
  if (error.startsWith("bad_move:")) return t("harness.import_error_bad_move", { index: error.slice("bad_move:".length) });
  return t(`harness.import_error_${error}`);
}

/** Paste a round (from the bench or a database row) and step through it on this page's board. */
export function ImportPanel({ puzzle, disabled, onLoad }: ImportPanelProps) {
  const [text, setText] = useState("");
  const [message, setMessage] = useState<{ kind: "error" | "note"; text: string } | null>(null);
  const load = (): void => {
    const parsed = parseRoundFile(text);
    if (!parsed.ok) {
      setMessage({ kind: "error", text: importErrorText(parsed.error) });
      return;
    }
    if (parsed.round.puzzle !== puzzle) {
      setMessage({ kind: "error", text: t("harness.import_error_wrong_puzzle", { puzzle: t(`${parsed.round.puzzle}.title`) }) });
      return;
    }
    const problem = onLoad(parsed.round, parsed.notes);
    if (problem) setMessage({ kind: "error", text: problem });
    else {
      setMessage(parsed.notes.length ? { kind: "note", text: parsed.notes.map((n) => t(`harness.import_note_${n}`)).join(" ") } : null);
      setText("");
    }
  };
  return (
    <section className="bench-section" data-testid="import">
      <h3>{t("harness.import")}</h3>
      <p className="muted small">{t("harness.import_blurb")}</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} spellCheck={false} disabled={disabled} data-testid="import-text" placeholder='{"puzzle":"bilging","seed":"…","moves":[…]}' />
      <div className="bench-actions">
        <button type="button" className="btn btn-mini" onClick={load} disabled={disabled || text.trim().length === 0} data-testid="import-load">
          {t("harness.import_load")}
        </button>
        {message && (
          <span className={`small ${message.kind === "error" ? "error" : "muted"}`} role={message.kind === "error" ? "alert" : undefined} data-testid="import-message">
            {message.text}
          </span>
        )}
      </div>
    </section>
  );
}
