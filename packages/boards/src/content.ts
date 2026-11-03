import { loadContent, msg } from "@openseas/content";

/** Content is validated once at startup on the client too; a bad file fails the build's smoke test. */
export const content = loadContent();

/** Every player-facing string goes through here (CLAUDE.md rule 5). */
export const t = (key: string, vars?: Record<string, string | number>): string => msg(content, key, vars);
