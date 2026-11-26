/**
 * A small highlighter for the two languages the docs show: JSON documents and TypeScript rules.
 * It only colours: it never changes a character, so what a reader copies is what was written.
 */
export type Tone = "plain" | "comment" | "string" | "key" | "number" | "keyword" | "hook" | "type";
export interface Span {
  readonly tone: Tone;
  readonly text: string;
}

const KEYWORDS = new Set([
  "import", "export", "default", "from", "type", "interface", "const", "let", "function", "return", "if", "else", "for", "while", "of", "in",
  "new", "null", "true", "false", "void", "readonly", "extends", "as", "continue", "break", "this", "undefined", "declare", "keyof", "typeof",
]);

/** Every hook the loop asks: named in code, they are what a reader looks for. */
export const HOOKS = new Set([
  "onStart", "canMove", "onMove", "onCascade", "onMoveEnd", "onTick", "onSignal", "onTaskNeeded", "onOpen", "onClose", "onTurn", "onEnd",
  "whoseTurn", "pickMove", "listMoves", "worth", "pointsFor", "placing", "score", "hint", "checkSettings", "defineRules",
]);

const TOKEN = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|(-?\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)/g;

export function highlight(code: string, lang: string): Span[] {
  if (lang !== "json" && lang !== "ts") return [{ tone: "plain", text: code }];
  const out: Span[] = [];
  let at = 0;
  const push = (tone: Tone, text: string): void => {
    if (text === "") return;
    const last = out[out.length - 1];
    if (last && last.tone === tone) out[out.length - 1] = { tone, text: last.text + text };
    else out.push({ tone, text });
  };
  for (const m of code.matchAll(TOKEN)) {
    const start = m.index;
    push("plain", code.slice(at, start));
    at = start + m[0].length;
    const [text, comment, string, number, word] = m;
    if (comment !== undefined) push(lang === "ts" ? "comment" : "plain", text);
    else if (string !== undefined) {
      // A JSON string before a colon is a key.
      const isKey = /^\s*:/.test(code.slice(at, at + 8));
      push(isKey ? "key" : "string", text);
    } else if (number !== undefined) push("number", text);
    else if (word !== undefined) {
      if (lang === "json") push(word === "true" || word === "false" || word === "null" ? "keyword" : "plain", text);
      else if (HOOKS.has(word)) push("hook", text);
      else if (KEYWORDS.has(word)) push("keyword", text);
      else if (/^[A-Z]/.test(word)) push("type", text);
      else push("plain", text);
    }
  }
  push("plain", code.slice(at));
  return out;
}
