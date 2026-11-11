import { loadContent, msg } from "@openseas/content";

/** The same content the game loads: guides read their numbers from it, so a retune reaches the page. */
export const content = loadContent();

/** Every string of the site's own chrome goes through the message table (CLAUDE.md rule 5). Guide prose is in `guides/`. */
export const t = (key: string, vars?: Record<string, string | number>): string => msg(content, key, vars);
