import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  BUILTIN,
  CONTEXT_ROOT,
  ENGINE_DTS,
  FUNCTIONS,
  HOOKS_ROOT,
  ID_TYPES,
  SDK_ROOTS,
  TYPE_DEFS,
  VIEW_ROOT,
  definitionOf,
  linked,
  membersOf,
  namedPath,
  type CodeExample,
  type Member,
  type Param,
  type Stage,
  type Value,
} from "../src/api/sdk/index.js";
import { HOOKS as COLOURED } from "../src/md/highlight.js";
import { compile } from "./support/compile.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const GUIDE = readFileSync(join(HERE, "..", "..", "..", "docs", "puzzles", "DOMAIN.md"), "utf8");
const API = join(HERE, "..", "content", "api");

// ---- the declarations, read with the compiler

const source = ts.createSourceFile("engine.d.ts", ENGINE_DTS, ts.ScriptTarget.ES2022, true);
const text = (node: ts.Node | undefined): string => (node ? node.getText(source).replace(/\s+/g, " ") : "");

interface Declared {
  readonly text: string;
  readonly params?: readonly { name: string; type: string; optional: boolean }[];
  readonly returns?: string;
  readonly type?: string;
  readonly optional: boolean;
}

function declared(member: ts.TypeElement): Declared {
  const whole = text(member).replace(/;$/, "");
  if (ts.isMethodSignature(member)) {
    return {
      text: whole,
      optional: !!member.questionToken,
      params: member.parameters.map((p) => ({ name: (p.dotDotDotToken ? "" : "") + text(p.name), type: text(p.type), optional: !!p.questionToken })),
      returns: text(member.type),
    };
  }
  const prop = member as ts.PropertySignature;
  return { text: whole, optional: !!prop.questionToken, type: text(prop.type) };
}

const INTERFACES = new Map<string, Map<string, Declared>>();
const EXPORTS = new Map<string, "type" | "interface" | "function">();
source.forEachChild((node) => {
  if (ts.isInterfaceDeclaration(node)) {
    EXPORTS.set(node.name.text, "interface");
    INTERFACES.set(node.name.text, new Map(node.members.map((m) => [text(m.name), declared(m)])));
  } else if (ts.isTypeAliasDeclaration(node)) {
    EXPORTS.set(node.name.text, "type");
    if (ts.isTypeLiteralNode(node.type)) INTERFACES.set(node.name.text, new Map(node.type.members.map((m) => [text(m.name), declared(m)])));
  } else if (ts.isFunctionDeclaration(node) && node.name) EXPORTS.set(node.name.text, "function");
});

/** A signature as the pages write it, read the way the declarations are. */
function parsed(signature: string): Declared {
  const file = ts.createSourceFile("x.ts", `interface X { ${signature} }`, ts.ScriptTarget.ES2022, true);
  const member = (file.statements[0] as ts.InterfaceDeclaration).members[0]!;
  const t = (node: ts.Node | undefined): string => (node ? node.getText(file).replace(/\s+/g, " ") : "");
  if (ts.isMethodSignature(member)) {
    return { text: signature, optional: false, params: member.parameters.map((p) => ({ name: t(p.name), type: t(p.type), optional: !!p.questionToken })), returns: t(member.type) };
  }
  return { text: signature, optional: false, type: t((member as ts.PropertySignature).type) };
}

/** The parts of a union, cut at the top level only. */
function parts(type: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  let quoted = false;
  for (let i = 0; i < type.length; i++) {
    const c = type[i]!;
    if (c === '"') quoted = !quoted;
    if (quoted) continue;
    if ("<({[".includes(c)) depth++;
    else if (">)}]".includes(c) && type[i - 1] !== "=") depth--;
    else if (c === "|" && depth === 0) {
      out.push(type.slice(from, i).trim());
      from = i + 1;
    }
  }
  out.push(type.slice(from).trim());
  return out.filter(Boolean);
}

// ---- everything the pages hold

interface Placed {
  readonly member: Member;
  readonly at: string;
  /** The interface it is a member of, in the declarations. */
  readonly of: string;
}

const OWNERS: Record<string, string> = { board: "Board", draw: "Draw", emit: "Changes" };

function everyMember(): Placed[] {
  const out: Placed[] = [];
  for (const root of SDK_ROOTS) {
    for (const member of membersOf(root)) {
      out.push({ member, at: `${root.root}.${member.name}`, of: root.name });
      for (const group of member.members ?? []) for (const inner of group.members) out.push({ member: inner, at: `${root.root}.${member.name}.${inner.name}`, of: OWNERS[member.name]! });
    }
  }
  return out;
}

const ALL = everyMember();
const HOOKS = membersOf(HOOKS_ROOT);

function everyExample(): { example: CodeExample; at: string }[] {
  const out: { example: CodeExample; at: string }[] = [];
  for (const root of SDK_ROOTS) out.push({ example: root.example, at: root.root });
  for (const { member, at } of ALL) for (const example of member.examples ?? []) out.push({ example, at });
  for (const fn of FUNCTIONS) for (const example of fn.examples ?? []) out.push({ example, at: fn.name });
  return out;
}

const TYPE_NAMES = [...EXPORTS].filter(([, kind]) => kind !== "function").map(([name]) => name);
const PUZZLES = { swap: "Swap", tricks: "Tricks" } as const;

/** An example as the file it would stand in. */
function fileOf(example: CodeExample): string {
  if (example.wrap === "file") return example.code;
  const X = PUZZLES[example.puzzle];
  const head = [
    `import { defineRules, zone } from "@openseas/engine";`,
    `import type { ${TYPE_NAMES.join(", ")} } from "@openseas/engine";`,
    `import type { ${X} } from "./${example.puzzle}.puzzle.gen";`,
    `type State = ${example.state ?? "{}"};`,
    example.given ?? "",
  ].join("\n");
  if (example.wrap === "rules") return `${head}\nexport const rules: Partial<Rules<${X}, State>> = {\n${example.code}\n};\nvoid defineRules; void zone;\n`;
  return `${head}\nexport function body(ctx: Ctx<${X}, State>, view: View<${X}, State>, seat: Seat, side: Side, e: Changes<${X}>): void {\n${example.code}\n}\nvoid defineRules; void zone;\n`;
}

function values(v: readonly Value[] | undefined): Set<string> {
  return new Set((v ?? []).map((x) => x.value));
}

/** A union names each of its parts among its values. A named set of values may stand in for its name. */
function covers(type: string, given: readonly Value[] | undefined, at: string): void {
  const each = parts(type);
  if (each.length < 2 && type !== "boolean") return;
  const have = values(given);
  if (type === "boolean") {
    expect(have.has("true") && have.has("false"), `${at}: says what true and false mean`).toBe(true);
    return;
  }
  for (const part of each) {
    const def = TYPE_DEFS.find((d) => d.name === part);
    const ok = have.has(part) || (def?.values !== undefined && def.values.every((v) => have.has(v.value)));
    expect(ok, `${at}: says what ${part} means, of ${type}`).toBe(true);
  }
}

function param(p: Param, at: string): void {
  const here = `${at}(${p.name})`;
  expect(p.description.length, here).toBeGreaterThan(8);
  if (p.optional) expect(p.absent, `${here} says what leaving it out means`).toBeTruthy();
  covers(p.type, p.values, here);
  for (const f of p.fields ?? []) param(f, here);
}

describe("the rules SDK", () => {
  it("declares a surface that compiles on its own", () => {
    expect(compile({ "use.ts": `import { defineRules, zone } from "@openseas/engine";\nimport type { Swap } from "./swap.puzzle.gen";\nimport type { Tricks } from "./tricks.puzzle.gen";\nexport type T = [Swap, Tricks, typeof defineRules, typeof zone];\n` })).toEqual([]);
  });

  it("documents every hook, member and type the declarations export, and nothing they do not", () => {
    for (const root of SDK_ROOTS) {
      const want = [...INTERFACES.get(root.name)!.keys()];
      const inherited = root === CONTEXT_ROOT ? membersOf(VIEW_ROOT).map((m) => m.name).filter((n) => !["seat", "allowed", "try"].includes(n)) : [];
      expect(membersOf(root).map((m) => m.name).sort(), root.name).toEqual([...want, ...inherited].sort());
    }
    for (const [page, of] of Object.entries(OWNERS)) {
      const have = ALL.filter((p) => p.of === of && p.at.split(".").length === 3).map((p) => p.member.name);
      expect(have.sort(), `${page} defines every member of ${of}`).toEqual([...INTERFACES.get(of)!.keys()].sort());
    }
    const documented = new Set([...TYPE_DEFS.map((d) => d.name), ...ID_TYPES.map((v) => v.value.replace(/<.*/, "")), ...FUNCTIONS.map((f) => f.name), "Rules", "View", "Ctx", "Board", "Draw", "Changes"]);
    expect([...EXPORTS.keys()].filter((name) => !documented.has(name))).toEqual([]);
    expect([...documented].filter((name) => !EXPORTS.has(name))).toEqual([]);
    for (const def of TYPE_DEFS) expect(definitionOf(def).length, def.name).toBeGreaterThan(10);
  });

  it("writes every member's signature as it is declared", () => {
    for (const { member, at, of } of ALL) {
      if (member.kind === "hook") continue;
      expect(member.signature, at).toBe(INTERFACES.get(member.from ? "View" : of)!.get(member.name)!.text);
    }
    for (const fn of FUNCTIONS) expect(ENGINE_DTS, fn.name).toContain(`export function ${fn.signature};`);
  });

  it("writes every hook's signature as one the declarations take", () => {
    const lines: string[] = [`import type { ${TYPE_NAMES.join(", ")} } from "@openseas/engine";`];
    for (const hook of HOOKS) {
      for (const [i, signature] of [hook.signature, hook.each?.signature].entries()) {
        if (!signature) continue;
        lines.push(`export function ${hook.name}${i}<P extends Puzzle, S>(shown: { ${signature} }): Rules<P, S>["${hook.name}"] { return shown.${hook.name}; }`);
      }
    }
    expect(compile({ "hooks.ts": lines.join("\n") })).toEqual([]);
  });

  it("names every parameter a signature has, with its type, and what the call gives back", () => {
    for (const { member, at } of ALL) {
      if (member.from) continue;
      const shown = parsed(member.signature);
      if (shown.params) {
        expect((member.params ?? []).map((p) => `${p.name}${p.optional ? "?" : ""}: ${p.type}`), at).toEqual(shown.params.map((p) => `${p.name}${p.optional ? "?" : ""}: ${p.type}`));
        expect(member.returns?.type, `${at} returns`).toBe(shown.returns);
      } else if (member.returns && member.kind !== "hook") expect(member.returns.type, `${at} type`).toBe(shown.type);
    }
  });

  it("says what every part of a union means, what leaving a parameter out means, and when a call is refused", () => {
    for (const { member, at } of ALL) {
      expect(member.description.length, at).toBeGreaterThan(10);
      for (const p of member.params ?? []) param(p, at);
      if (member.returns) covers(member.returns.type, member.returns.values, `${at} returns`);
      else if (member.kind === "property" && !member.from) covers(parsed(member.signature).type!, undefined, `${at} type`);
    }
    for (const fn of FUNCTIONS) for (const p of fn.params ?? []) param(p, fn.name);
    for (const def of TYPE_DEFS) {
      expect(def.description.length, def.name).toBeGreaterThan(10);
      for (const f of [...(def.fields ?? []), ...(def.forms ?? []).flatMap((form) => form.fields ?? [])]) param(f, def.name);
    }
    // A hook says when it is asked, what the loop does without it, and what it must and must never do.
    for (const hook of HOOKS) {
      expect(hook.asked, hook.name).toBeTruthy();
      expect(hook.given, hook.name).toBeTruthy();
      if (hook.need !== "required") expect(hook.absent, `${hook.name} says what leaving it out means`).toBeTruthy();
      expect(hook.rules?.length ?? 0, `${hook.name} has rules`).toBeGreaterThan(0);
    }
  });

  it("gives a named type's fields as they are declared", () => {
    for (const def of TYPE_DEFS) {
      const members = INTERFACES.get(def.name);
      if (!members || !def.fields || ["On", "Ask"].includes(def.name)) continue;
      const fields = def.fields.filter((f) => f.name !== "…");
      const want = [...members].filter(([name]) => fields.some((f) => f.name === name) || !["Move", "Event"].includes(def.name));
      expect(fields.map((f) => `${f.name}${f.optional ? "?" : ""}`), def.name).toEqual(want.map(([name, d]) => `${name}${d.optional ? "?" : ""}`));
      if (def.name === "Puzzle") continue;
      for (const f of fields) if (members.has(f.name) && !f.type.includes("[id]")) expect(f.type, `${def.name}.${f.name}`).toBe(members.get(f.name)!.type);
    }
    // A set of values lists every value its declaration has.
    for (const def of TYPE_DEFS) {
      if (!def.values) continue;
      expect(def.values.map((v) => v.value), def.name).toEqual(parts(definitionOf(def).replace(/^type \w+ = /, "").replace(/;$/, "")));
    }
  });

  it("uses no name it does not define", () => {
    const unknown = new Set<string>();
    const look = (signature: string): void => {
      for (const m of signature.replace(/"[^"]*"/g, "").matchAll(/\b[A-Z][A-Za-z]*\b/g)) if (!namedPath(m[0]) && !BUILTIN.has(m[0])) unknown.add(m[0]);
    };
    for (const { member } of ALL) {
      look(member.signature);
      if (member.each) look(member.each.signature);
    }
    for (const fn of FUNCTIONS) look(fn.signature);
    expect([...unknown]).toEqual([]);
    expect(linked("at(place: Cell<P>): Piece<P> | null").filter((run) => run.path).map((run) => run.text)).toEqual(["Cell", "Piece"]);
  });

  it("asks every hook the guide lists, at the stage the guide's loop asks it", () => {
    const table = GUIDE.slice(GUIDE.indexOf("### Hooks\n"), GUIDE.indexOf("### What a hook reports through"));
    const listed = [...table.matchAll(/^\| `(\w+)` \|/gm)].map((m) => m[1]!);
    expect(HOOKS.map((h) => h.name).sort()).toEqual([...listed].sort());
    for (const hook of listed) expect(COLOURED.has(hook), `${hook} is coloured as a hook`).toBe(true);

    const loop = GUIDE.slice(GUIDE.indexOf("### The loop\n"), GUIDE.indexOf("### Hooks\n"));
    const stages = new Map<string, Stage[]>();
    for (const row of loop.matchAll(/^\| ([A-Z][a-z ]+) \|[^|]+\| ([^|]+) \|$/gm)) {
      for (const hook of row[2]!.matchAll(/`(\w+)`/g)) stages.set(hook[1]!, [...(stages.get(hook[1]!) ?? []), row[1] as Stage]);
    }
    expect(stages.size).toBeGreaterThan(10);
    for (const hook of HOOKS) expect(hook.stages ?? [], hook.name).toEqual(stages.get(hook.name) ?? []);
  });

  it("compiles every example against the declarations", () => {
    const examples = everyExample();
    expect(examples.length).toBeGreaterThan(35);
    const files: Record<string, string> = {};
    examples.forEach(({ example, at }, i) => {
      files[`ex${i}-${at.replace(/\W/g, "_")}.ts`] = fileOf(example);
    });
    // The pages of prose too: every block there that is a whole file.
    for (const page of ["rules", "write-a-puzzle"]) {
      const md = readFileSync(join(API, `${page}.md`), "utf8");
      [...md.matchAll(/```ts[^\n]*\n([\s\S]*?)\n```/g)].forEach((m, i) => {
        if (m[1]!.includes("import ")) files[`md-${page.replace(/\W/g, "_")}-${i}.ts`] = m[1]!;
      });
    }
    expect(compile(files)).toEqual([]);
    // Every hook has an example, but for the three that need a ticking puzzle or tasks to show one.
    const bare = HOOKS.filter((h) => !h.examples?.length).map((h) => h.name);
    expect(bare).toEqual(["onTick", "onTaskNeeded"]);
  });
});
