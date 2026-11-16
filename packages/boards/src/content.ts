import { loadContent, msg } from "@openseas/content";

/** Content is validated once at startup on the client too; a bad file fails the build's smoke test. */
export const content = loadContent();

/**
 * Strings laid over the message table on this page (ADR 0057): the studio's draft rewrites a
 * puzzle's words, and the board says them at once. Presentation only, as a swapped frame is (ADR
 * 0050). The game never sets one.
 */
let over: Readonly<Record<string, string>> = {};
let revision = 0;
const listeners = new Set<() => void>();

/** Every player-facing string goes through here (CLAUDE.md rule 5). */
export const t = (key: string, vars?: Record<string, string | number>): string => {
  const words = over[key];
  if (words === undefined) return msg(content, key, vars);
  return vars ? words.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`)) : words;
};

/** A string as the build ships it, whatever is laid over it; undefined where the table has no such key. */
export const shippedMessage = (key: string): string | undefined => content.messages[key];

/** Lay these strings over the message table, in place of whatever was laid before. An empty set puts every string back. */
export function overrideMessages(next: Readonly<Record<string, string>>): void {
  const a = Object.keys(over);
  const b = Object.keys(next);
  if (a.length === b.length && a.every((k) => over[k] === next[k])) return;
  over = { ...next };
  revision++;
  for (const l of listeners) l();
}

/** Counts each change to what is laid over the table: a board bakes its words when it is made, so it is made again. */
export const messageOverrideRevision = (): number => revision;
export function subscribeMessages(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
