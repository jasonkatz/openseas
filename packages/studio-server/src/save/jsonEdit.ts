/**
 * Edits to a JSON file that leave every other byte of it alone. A content file is laid out by
 * hand (a threshold a line, a curve on one line, a deck a row a line), and Save writes a draft's
 * numbers into it (ADR 0046): a diff of that commit should show the numbers and nothing else. So
 * a value is replaced where it stands, drawn the way the value it replaces was drawn.
 */

interface Node {
  readonly kind: "object" | "array" | "scalar";
  /** Where the value's text starts and ends in the file. */
  readonly start: number;
  readonly end: number;
  readonly members?: ReadonlyArray<{ key: string; keyStart: number; value: Node }>;
  readonly items?: readonly Node[];
}

class Parser {
  private i = 0;
  constructor(private readonly text: string) {}

  parse(): Node {
    const node = this.value();
    this.space();
    if (this.i !== this.text.length) this.fail("something after the value");
    return node;
  }
  private fail(what: string): never {
    throw new Error(`not JSON: ${what} at ${this.i}`);
  }
  private space(): void {
    while (this.i < this.text.length && " \t\r\n".includes(this.text[this.i]!)) this.i++;
  }
  private string(): string {
    const start = this.i;
    if (this.text[this.i] !== '"') this.fail("a string was expected");
    this.i++;
    while (this.i < this.text.length && this.text[this.i] !== '"') this.i += this.text[this.i] === "\\" ? 2 : 1;
    if (this.i >= this.text.length) this.fail("a string does not end");
    this.i++;
    return JSON.parse(this.text.slice(start, this.i)) as string;
  }
  private value(): Node {
    this.space();
    const start = this.i;
    const c = this.text[this.i];
    if (c === "{") {
      this.i++;
      const members: Array<{ key: string; keyStart: number; value: Node }> = [];
      this.space();
      if (this.text[this.i] === "}") this.i++;
      else
        for (;;) {
          this.space();
          const keyStart = this.i;
          const key = this.string();
          this.space();
          if (this.text[this.i++] !== ":") this.fail("a colon was expected");
          members.push({ key, keyStart, value: this.value() });
          this.space();
          const sep = this.text[this.i++];
          if (sep === "}") break;
          if (sep !== ",") this.fail("a comma was expected");
        }
      return { kind: "object", start, end: this.i, members };
    }
    if (c === "[") {
      this.i++;
      const items: Node[] = [];
      this.space();
      if (this.text[this.i] === "]") this.i++;
      else
        for (;;) {
          items.push(this.value());
          this.space();
          const sep = this.text[this.i++];
          if (sep === "]") break;
          if (sep !== ",") this.fail("a comma was expected");
        }
      return { kind: "array", start, end: this.i, items };
    }
    if (c === '"') this.string();
    else {
      while (this.i < this.text.length && !",]} \t\r\n".includes(this.text[this.i]!)) this.i++;
      if (this.i === start) this.fail("a value was expected");
      JSON.parse(this.text.slice(start, this.i));
    }
    return { kind: "scalar", start, end: this.i };
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isContainer = (v: unknown): boolean => typeof v === "object" && v !== null;

/** How wide a value may be drawn on one line when there is no drawing of it to follow. */
const WIDTH = 100;

function inline(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(inline).join(", ")}]`;
  if (isObject(value)) {
    const parts = Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${inline(v)}`);
    return parts.length ? `{ ${parts.join(", ")} }` : "{}";
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * A value's text, drawn as `old` was: on one line if that was, a member a line if that was, and
 * each member in turn as the one it replaces. With nothing to follow, a value that holds only
 * plain values goes on one line when it fits, and anything else a member a line.
 */
function draw(text: string, value: unknown, old: Node | null, indent: string): string {
  if (!isContainer(value)) return JSON.stringify(value) ?? "null";
  const oldIsSame = old !== null && (Array.isArray(value) ? old.kind === "array" : old.kind === "object");
  const oldEmpty = oldIsSame && (old.items ?? old.members ?? []).length === 0;
  const flat = oldIsSame && !oldEmpty ? !text.slice(old.start, old.end).includes("\n") : Object.values(value as object).every((v) => !isContainer(v)) && inline(value).length <= WIDTH;
  if (flat) return inline(value);
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const olds = oldIsSame ? (old.items ?? []) : [];
    // A longer list draws its new entries as its last old one was drawn.
    const lines = value.map((v, i) => `${inner}${draw(text, v, olds[i] ?? olds[olds.length - 1] ?? null, inner)}`);
    return `[\n${lines.join(",\n")}\n${indent}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return "{}";
  const olds = new Map((oldIsSame ? (old.members ?? []) : []).map((m) => [m.key, m.value]));
  const lines = entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${draw(text, v, olds.get(k) ?? null, inner)}`);
  return `{\n${lines.join(",\n")}\n${indent}}`;
}

/** The whitespace a line starts with, for the line `at` is on. */
function indentAt(text: string, at: number): string {
  const lineStart = text.lastIndexOf("\n", at - 1) + 1;
  return /^[ \t]*/.exec(text.slice(lineStart, at))![0];
}

/**
 * The file's text with the value at `path` set. Every key but the last must already be there: a
 * number is written where the file has a place for it, never into a branch the file does not
 * have. A last key the file lacks is added: before `before` when that names a key beside it,
 * else after the last. Throws when the text is not JSON or the path leads nowhere.
 */
export function setJsonValue(text: string, path: readonly string[], value: unknown, before?: string): string {
  if (path.length === 0) throw new Error("no path");
  let node = new Parser(text).parse();
  for (const key of path.slice(0, -1)) {
    const next = node.kind === "object" ? node.members!.find((m) => m.key === key) : undefined;
    if (!next) throw new Error(`no ${path.join(".")} in the file`);
    node = next.value;
  }
  if (node.kind !== "object") throw new Error(`no ${path.join(".")} in the file`);
  const last = path[path.length - 1]!;
  const members = node.members!;
  const at = members.find((m) => m.key === last);
  if (at) return text.slice(0, at.value.start) + draw(text, value, at.value, indentAt(text, at.keyStart)) + text.slice(at.value.end);

  const flat = !text.slice(node.start, node.end).includes("\n");
  if (members.length === 0 || flat) {
    // An object on one line, or an empty one, is drawn again whole with the key in it.
    const whole = JSON.parse(text.slice(node.start, node.end)) as Record<string, unknown>;
    const drawn = members.length === 0 ? draw(text, { [last]: value }, null, indentAt(text, node.start)) : inline({ ...whole, [last]: value });
    return text.slice(0, node.start) + drawn + text.slice(node.end);
  }
  const anchor = before ? members.find((m) => m.key === before) : undefined;
  const indent = indentAt(text, (anchor ?? members[0]!).keyStart);
  const entry = `${JSON.stringify(last)}: ${draw(text, value, null, indent)}`;
  if (anchor) return `${text.slice(0, anchor.keyStart)}${entry},\n${indent}${text.slice(anchor.keyStart)}`;
  const tail = members[members.length - 1]!.value.end;
  return `${text.slice(0, tail)},\n${indent}${entry}${text.slice(tail)}`;
}

/**
 * The file's text without the key at `path`, its line and comma with it. The text unchanged when
 * the file has no such key.
 */
export function removeJsonValue(text: string, path: readonly string[]): string {
  let node = new Parser(text).parse();
  for (const key of path.slice(0, -1)) {
    const next = node.kind === "object" ? node.members!.find((m) => m.key === key) : undefined;
    if (!next) return text;
    node = next.value;
  }
  const members = node.kind === "object" ? node.members! : [];
  const i = members.findIndex((m) => m.key === path[path.length - 1]);
  if (i < 0) return text;
  if (members.length === 1 || !text.slice(node.start, node.end).includes("\n")) {
    const whole = JSON.parse(text.slice(node.start, node.end)) as Record<string, unknown>;
    delete whole[members[i]!.key];
    return text.slice(0, node.start) + inline(whole) + text.slice(node.end);
  }
  // From the end of the member before it (or the start of the one after it, for the first) so that one comma and one line go.
  if (i > 0) return text.slice(0, members[i - 1]!.value.end) + text.slice(members[i]!.value.end);
  return text.slice(0, members[0]!.keyStart) + text.slice(members[1]!.keyStart);
}

/** The value at a path of object keys, or undefined when the file has none there. */
export function getJsonValue(text: string, path: readonly string[]): unknown {
  let cur: unknown = JSON.parse(text);
  for (const key of path) {
    if (!isObject(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}
