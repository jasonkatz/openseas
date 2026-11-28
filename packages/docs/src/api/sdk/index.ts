import engineRaw from "../../../content/api/sdk/engine.d.ts?raw";
import swapRaw from "../../../content/api/sdk/swap.puzzle.gen.ts?raw";
import { HOOKS_ROOT } from "./hooks.js";
import { FIELD_MAP, FUNCTIONS, ID_TYPES, SETTING_MAP, TYPE_DEFS, TYPE_GROUPS } from "./typedefs.js";
import type { Member, SdkRoot, SdkRootId, TypeDef } from "./types.js";
import { CONTEXT_ROOT, VIEW_ROOT } from "./view.js";

export * from "./types.js";
export { CONTEXT_ROOT, FIELD_MAP, FUNCTIONS, HOOKS_ROOT, ID_TYPES, SETTING_MAP, TYPE_DEFS, TYPE_GROUPS, VIEW_ROOT };

/** The declarations, whole: what the pages are held to, and what the last section of the types page shows. */
export const ENGINE_DTS: string = engineRaw;
/** A generated puzzle type, to show what one looks like. */
export const SWAP_GEN: string = swapRaw;

export const SDK_ROOTS: readonly SdkRoot[] = [HOOKS_ROOT, VIEW_ROOT, CONTEXT_ROOT];
export const sdkRootOf = (root: string): SdkRoot | undefined => SDK_ROOTS.find((r) => r.root === root);

export const SDK_TYPES_PATH = "/reference/sdk";
export const sdkRootPath = (root: SdkRootId): string => `/reference/${root}`;
/** The anchor of a hook or a member on its object's page. */
export const memberAnchor = (member: Member): string => member.name.toLowerCase();
export const memberPath = (root: SdkRootId, member: Member): string => `/reference/${root}#${memberAnchor(member)}`;

/** Every member of an object, in reading order. */
export const membersOf = (root: SdkRoot): Member[] => root.groups.flatMap((g) => g.members);
/** The members written out in full: each a section of its object's page, with its examples beside it. */
export const memberPagesOf = (root: SdkRoot): Member[] => membersOf(root).filter((m) => m.page);

/** The anchor of a member defined inside another's section: `e-arrive`, `draw-even`, `board-at`. */
export const innerAnchor = (owner: string, name: string): string => `${owner}-${name}`.toLowerCase();
export const typeAnchor = (name: string): string => name.toLowerCase();

/** One declaration out of the declarations file, by its name: the text from `export` to its end. */
export function declOf(name: string, source: string = ENGINE_DTS): string {
  const at = new RegExp(`^export (?:type|interface|function) ${name}\\b`, "m").exec(source);
  if (!at) return "";
  let depth = 0;
  for (let i = at.index; i < source.length; i++) {
    const c = source[i]!;
    if (c === "{" || c === "(" || c === "[") depth++;
    else if (c === "}" || c === ")" || c === "]") {
      depth--;
      if (depth === 0 && c === "}" && /^export interface/.test(source.slice(at.index, at.index + 20))) return source.slice(at.index, i + 1);
    } else if (c === ";" && depth === 0) return source.slice(at.index, i + 1);
  }
  return source.slice(at.index);
}

/** A type's definition as it is declared, without the `export`. */
export const definitionOf = (def: TypeDef): string => declOf(def.name).replace(/^export /, "");

/** Where each name the SDK's signatures use is defined: a type on the types page, or a section of an object's page. */
const NAMED: ReadonlyMap<string, string> = new Map<string, string>([
  ...TYPE_DEFS.map((d) => [d.name, `${SDK_TYPES_PATH}#${typeAnchor(d.name)}`] as const),
  ...ID_TYPES.map((v) => [v.value.replace(/<.*/, ""), `${SDK_TYPES_PATH}#ids`] as const),
  ["Rules", "/reference/hooks"],
  ["View", "/reference/view"],
  ["Ctx", "/reference/context"],
  ["Board", "/reference/view#board"],
  ["Draw", "/reference/context#draw"],
  ["Changes", "/reference/context#emit"],
]);
export const namedPath = (name: string): string | undefined => NAMED.get(name);

/** Words in a signature that are the language's own, or a type's own parameter, and so are defined nowhere. */
export const BUILTIN = new Set(["string", "number", "boolean", "null", "void", "unknown", "object", "readonly", "this", "extends", "keyof", "in", "as", "never", "Readonly", "Omit", "P", "S", "A", "R", "T", "E", "M", "K", "G", "Ph", "any"]);

/** A signature cut into runs, each plain text or a name with the place it is defined. */
export function linked(signature: string): { text: string; path?: string }[] {
  const out: { text: string; path?: string }[] = [];
  let last = 0;
  for (const m of signature.matchAll(/"[^"]*"|\b[A-Z][A-Za-z]*\b/g)) {
    if (m[0].startsWith('"')) continue;
    const path = NAMED.get(m[0]);
    if (!path) continue;
    if (m.index > last) out.push({ text: signature.slice(last, m.index) });
    out.push({ text: m[0], path });
    last = m.index + m[0].length;
  }
  if (last < signature.length) out.push({ text: signature.slice(last) });
  return out;
}
