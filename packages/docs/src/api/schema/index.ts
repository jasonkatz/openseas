import { t } from "../../content.js";
import { slugger } from "../../md/slug.js";
import { PUZZLE } from "./puzzle.js";
import { SKIN } from "./skin.js";
import { THEME } from "./theme.js";
import { ALIASES, isPage, type EnumValue, type Field, type Need, type ObjectPage, type RefTarget, type Root, type RootObject, type Type } from "./types.js";

export * from "./types.js";
export { PUZZLE, SKIN, THEME };

export const ROOTS: readonly RootObject[] = [PUZZLE, SKIN, THEME];
export const rootOf = (root: string): RootObject | undefined => ROOTS.find((r) => r.root === root);

/** The objects that belong to a top-level object, in the order its file is written. Each is a section of its page. */
export const pagesOf = (root: RootObject): ObjectPage[] => root.groups.flatMap((g) => g.fields.filter(isPage));

export const TYPES_PATH = "/reference/types";
export const rootPath = (root: Root): string => `/reference/${root}`;
/** The anchor of an object's section on its top-level object's page. Every field inside it starts with it. */
export const pageAnchor = (page: ObjectPage): string => page.key.toLowerCase();
export const pagePath = (page: ObjectPage): string => `${rootPath(page.root)}#${pageAnchor(page)}`;
/** Where one field of an object's section is. */
export const nodePath = (page: ObjectPage, node: Node): string => `${rootPath(page.root)}#${node.anchor}`;

/** Where the part a field names by id is declared. */
const REF_PATHS: Record<RefTarget, string> = {
  setting: "/reference/puzzle#settings",
  move: "/reference/puzzle#moves",
  control: "/reference/puzzle#controls",
  event: "/reference/puzzle#events",
  phase: "/reference/puzzle#round-phases",
  payout: "/reference/puzzle#payouts",
  layer: "/reference/puzzle#layers",
  piece: "/reference/puzzle#pieces",
  zone: "/reference/puzzle#zones",
  gauge: "/reference/puzzle#gauges",
  stat: "/reference/puzzle#stats",
  multiplier: "/reference/puzzle#multipliers",
  task: "/reference/puzzle#tasks",
  draw: "/reference/puzzle#deal-draws",
  check: "/reference/puzzle#deal-checks",
  "stand-in": "/reference/puzzle#opponents-standins",
  puzzle: "/reference/puzzle",
  theme: "/reference/theme",
  cue: "/reference/skin#cues",
  colour: "/reference/theme#palette",
  "event field": "/reference/puzzle#events-fields",
};
export const refPath = (to: RefTarget): string => REF_PATHS[to];
const refLabel = (to: RefTarget): string => (to === "cue" ? "cue name" : to === "event field" ? "field name" : t("docs.ref.id_of", { part: to }));

// ---- a type, laid out for reading

export interface Section {
  /**
   * What this group of fields is: an object's own (`child`), those of each entry of an array or a
   * map (`each`), of one form of several told apart by a field (`form`), of every such form
   * (`every`), or of one of the forms a value may take (`one`).
   */
  readonly kind: "child" | "each" | "form" | "every" | "one";
  /** What the entry or the form is called. */
  readonly name: string;
  readonly note?: string | undefined;
  /** The type of this form, where the section is one of several a value may take. */
  readonly view?: TypeView | undefined;
  readonly nodes: readonly Node[];
}

export interface TypeView {
  /** The type in a few words: `enum`, `array of phases`, `integer or setting id`. */
  readonly label: string;
  /** What narrows it: its bounds, its unit, the primitive under a named type. */
  readonly facts: readonly string[];
  /** Where a named type or the part an id names is defined. */
  readonly link?: { readonly text: string; readonly path: string } | undefined;
  readonly values?: readonly EnumValue[] | undefined;
  /** For an object whose keys are chosen: what a key is, and any keys that are fixed. */
  readonly keys?: { readonly key: string; readonly note: string; readonly fixed?: readonly EnumValue[] | undefined } | undefined;
  readonly note?: string | undefined;
  readonly sections: readonly Section[];
}

export interface Node {
  readonly field: Field;
  /** The field's path from the page's object: `tempo.kind`, `phases[].acts`. */
  readonly path: string;
  readonly anchor: string;
  readonly view: TypeView;
}

const range = (min: number | undefined, max: number | undefined, unit: string | undefined): string[] => {
  const u = unit ? ` ${unit}` : "";
  if (min !== undefined && max !== undefined) return [t("docs.ref.range", { min, max }) + u];
  if (min !== undefined) return [t("docs.ref.at_least", { min }) + u];
  if (max !== undefined) return [t("docs.ref.at_most", { max }) + u];
  return unit ? [unit] : [];
};

const count = (min: number | undefined, max: number | undefined): string[] => {
  if (min !== undefined && max !== undefined) return [min === max ? t("docs.ref.count_exact", { n: min }) : t("docs.ref.count_range", { min, max })];
  if (min !== undefined && min > 0) return [t("docs.ref.count_min", { min })];
  if (max !== undefined) return [t("docs.ref.count_max", { max })];
  return [];
};

const PLURAL: Record<string, string> = { string: "strings", integer: "integers", number: "numbers", boolean: "booleans", object: "objects", enum: "enums", entry: "entries" };
const plural = (noun: string): string => PLURAL[noun] ?? (noun.endsWith("s") ? noun : noun.endsWith("y") && !/[aeiou]y$/.test(noun) ? `${noun.slice(0, -1)}ies` : `${noun}s`);

/** The few words that name a type, without walking into its fields: safe on a type that holds itself. */
export function labelOf(type: Type): string {
  switch (type.kind) {
    case "string":
    case "integer":
    case "number":
    case "boolean":
      return type.kind;
    case "literal":
      return typeof type.value === "string" ? `"${type.value}"` : String(type.value);
    case "enum":
      return "enum";
    case "ref":
      return refLabel(type.to);
    case "alias":
      return type.name;
    case "array":
      return t("docs.ref.array_of", { of: type.noun ?? plural(nounOf(type.of)) });
    case "tuple":
      return t("docs.ref.array_of", { of: `${type.of.length} ${plural(labelOf(type.of[0]!.type))}` });
    case "map":
      return "object";
    case "object":
    case "variants":
      return "object";
    case "union": {
      const labels = [...new Set(type.of.map((a) => labelOf(a.type)))];
      return labels.length === 1 ? labels[0]! : t("docs.ref.or", { a: labels.slice(0, -1).join(", "), b: labels.at(-1)! });
    }
    case "lazy":
      return labelOf(type.get());
  }
}

/** What one entry of an array is called. */
function nounOf(type: Type): string {
  if (type.kind === "object") return type.noun ?? "object";
  if (type.kind === "variants") return type.noun;
  if (type.kind === "lazy") return nounOf(type.get());
  return labelOf(type);
}

interface Walk {
  readonly slug: (text: string) => string;
}

function nodesOf(fields: readonly Field[], base: string, walk: Walk): Node[] {
  return fields.map((field) => {
    const path = (base ? `${base}.${field.name}` : field.name).replace(/^(\[\])?\./, "");
    return { field, path, anchor: walk.slug(path.replace(/\[\]|<|>/g, "").replace(/\./g, "-")), view: viewOf(field.type, path, walk) };
  });
}

/** A type as a reader meets it: its label, what narrows it, its values, and the fields inside it. */
export function viewOf(type: Type, path: string, walk: Walk): TypeView {
  const plain = (facts: string[] = []): TypeView => ({ label: labelOf(type), facts, sections: [] });
  switch (type.kind) {
    case "string":
      return plain(type.format ? [type.format] : []);
    case "integer":
    case "number":
      return plain(range(type.min, type.max, type.unit));
    case "boolean":
    case "literal":
      return plain();
    case "enum":
      return { ...plain(type.values.every((v) => typeof v.value === "number") ? ["integer"] : ["string"]), values: type.values };
    case "ref":
      return { ...plain(["string"]), link: { text: labelOf(type), path: refPath(type.to) } };
    case "alias": {
      const def = ALIASES.find((a) => a.name === type.name);
      return { ...plain(def ? [def.primitive] : []), link: { text: type.name, path: `${TYPES_PATH}#${type.name.replace(/\s+/g, "-")}` } };
    }
    case "array": {
      const inner = viewOf(type.of, `${path}[]`, walk);
      const noun = nounOf(type.of);
      return {
        label: labelOf(type),
        facts: [...count(type.min, type.max), ...(inner.sections.length === 0 && !inner.values ? inner.facts : [])],
        link: inner.link,
        values: inner.values,
        keys: inner.keys,
        note: inner.note,
        sections: inner.sections.map((s) => (s.kind === "child" ? { ...s, kind: "each" as const, name: noun } : s)),
      };
    }
    case "tuple":
      return {
        label: labelOf(type),
        facts: [`[${type.of.map((t) => t.name).join(", ")}]`],
        sections: [],
      };
    case "map": {
      const inner = viewOf(type.of, `${path}.${type.key}`, walk);
      return {
        label: "object",
        facts: [t("docs.ref.keyed", { key: type.key.replace(/[<>]/g, "") })],
        keys: { key: type.key, note: type.keyNote, fixed: type.keys },
        sections: [{ kind: "each", name: type.key, view: inner, nodes: [] }],
      };
    }
    case "object":
      return { ...plain(), sections: [{ kind: "child", name: "", nodes: nodesOf(type.fields, path, walk) }] };
    case "variants":
      return {
        ...plain([t("docs.ref.forms", { n: type.variants.length, on: type.on })]),
        sections: [
          ...type.variants.map((v) => ({
            kind: "form" as const,
            name: `${type.on}: "${v.value}"`,
            note: v.description,
            nodes: nodesOf(v.fields, path, walk),
          })),
          { kind: "every" as const, name: type.noun, note: `These sit beside \`${type.on}\`, whichever form the ${type.noun} takes.`, nodes: nodesOf(type.common, path, walk) },
        ],
      };
    case "union":
      return {
        ...plain(),
        sections: type.of.map((alt) => ({ kind: "one" as const, name: alt.label, note: alt.description, view: viewOf(alt.type, path, walk), nodes: [] })),
      };
    case "lazy":
      return { ...plain(), note: type.note, sections: [] };
  }
}

export interface PageView {
  readonly view: TypeView;
  /** Every field on the page, however deep, in reading order: what the search finds. */
  readonly all: readonly Node[];
}

function collect(view: TypeView, out: Node[]): void {
  for (const section of view.sections) {
    if (section.view) collect(section.view, out);
    for (const node of section.nodes) {
      out.push(node);
      collect(node.view, out);
    }
  }
}

const cache = new Map<ObjectPage, PageView>();

export function pageView(page: ObjectPage): PageView {
  let hit = cache.get(page);
  if (!hit) {
    const next = slugger();
    const view = viewOf(page.type, "", { slug: (text) => `${pageAnchor(page)}-${next(text)}` });
    const all: Node[] = [];
    collect(view, all);
    hit = { view, all };
    cache.set(page, hit);
  }
  return hit;
}

export const needLabel = (need: Need): "required" | "optional" | "conditional" => (typeof need === "string" ? need : "conditional");

/** A top-level object's own fields: those that are a single value, with no section of their own. */
export function rootNodes(root: RootObject): Map<Field, Node> {
  const next = slugger();
  const out = new Map<Field, Node>();
  for (const g of root.groups) for (const f of g.fields) if (!isPage(f)) out.set(f, nodesOf([f], "", { slug: next })[0]!);
  return out;
}
