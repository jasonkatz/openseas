import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "./content.js";
import { useRoute } from "./router.jsx";
import { search, type Hit } from "./site.js";

/** The search: every page, heading, glossary word and guide, found as it is typed. Opened with `/` or Ctrl+K. */
export function Search({ open, onClose }: { open: boolean; onClose(): void }) {
  const { navigate } = useRoute();
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const hits = useMemo(() => (open ? search(query) : []), [open, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setAt(0);
    input.current?.focus();
  }, [open]);

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [at]);

  if (!open) return null;

  const go = (hit: Hit | undefined): void => {
    if (!hit) return;
    onClose();
    navigate(hit.path);
  };

  return (
    <div className="search-veil" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="search" role="dialog" aria-modal="true" aria-label={t("docs.search")} data-testid="search">
        <input
          ref={input}
          type="search"
          value={query}
          placeholder={t("docs.search_placeholder")}
          aria-label={t("docs.search")}
          aria-controls="search-hits"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setQuery(e.target.value);
            setAt(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowDown") {
              e.preventDefault();
              setAt((i) => Math.min(i + 1, hits.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setAt((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") go(hits[at]);
          }}
        />
        {query.trim() === "" ? (
          <p className="search-note">{t("docs.search_hint")}</p>
        ) : hits.length === 0 ? (
          <p className="search-note" data-testid="search-empty">{t("docs.search_none", { query: query.trim() })}</p>
        ) : (
          <ul ref={list} id="search-hits" role="listbox" aria-label={t("docs.search_results")}>
            {hits.map((hit, i) => (
              <li key={hit.path + hit.kind} role="option" aria-selected={i === at} data-testid="search-hit" onMouseEnter={() => setAt(i)} onClick={() => go(hit)}>
                <span className="hit-title">{hit.title}</span>
                <span className="hit-kind">{t(`docs.area.${hit.area}`)} · {t(`docs.kind.${hit.kind}`)}</span>
                <span className="hit-sub">{hit.sub}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
