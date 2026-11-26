import { ALIASES, type Field, type Type } from "./types.js";

/**
 * Holds a written value to a type of the reference: every required field present, no field the
 * type does not have, every enum value one of its values, every number within its bounds. It is
 * how the tests know that each example, and each whole file kept beside the guide, is what the
 * reference says it is.
 */
export function check(value: unknown, type: Type, path = "$"): string[] {
  const out: string[] = [];
  visit(value, type, path, out);
  return out;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const show = (v: unknown): string => JSON.stringify(v)?.slice(0, 40) ?? String(v);

function fields(value: Record<string, unknown>, all: readonly Field[], path: string, out: string[], extra: readonly string[] = []): void {
  for (const f of all) {
    if (!(f.name in value)) {
      if (f.need === "required") out.push(`${path}: ${f.name} is missing`);
      continue;
    }
    visit(value[f.name], f.type, `${path}.${f.name}`, out);
  }
  const known = new Set([...all.map((f) => f.name), ...extra]);
  for (const key of Object.keys(value)) if (!known.has(key)) out.push(`${path}: ${key} is not a field`);
}

function visit(value: unknown, type: Type, path: string, out: string[]): void {
  const bad = (want: string): void => void out.push(`${path}: ${show(value)} is not ${want}`);
  switch (type.kind) {
    case "string":
      if (typeof value !== "string") bad("a string");
      else if (type.pattern && !new RegExp(type.pattern).test(value)) bad(`a string like ${type.pattern}`);
      return;
    case "integer":
    case "number":
      if (typeof value !== "number" || (type.kind === "integer" && !Number.isInteger(value))) bad(type.kind === "integer" ? "a whole number" : "a number");
      else if ((type.min !== undefined && value < type.min) || (type.max !== undefined && value > type.max)) bad(`within ${type.min ?? "-"} and ${type.max ?? "-"}`);
      return;
    case "boolean":
      if (typeof value !== "boolean") bad("true or false");
      return;
    case "literal":
      if (value !== type.value) bad(show(type.value));
      return;
    case "enum":
      if (!type.values.some((v) => v.value === value)) bad(`one of ${type.values.map((v) => v.value).join(", ")}`);
      return;
    case "ref":
      if (typeof value !== "string" || value === "") bad(`the id of a ${type.to}`);
      return;
    case "alias": {
      const def = ALIASES.find((a) => a.name === type.name);
      if (!def) return void out.push(`${path}: no type named ${type.name}`);
      if (type.name === "amount") {
        if (!(typeof value === "string" || (typeof value === "number" && Number.isInteger(value)))) bad("a whole number or a setting's id");
      } else if (type.name === "map") {
        if (!Array.isArray(value)) bad("a map");
      } else if (typeof value !== "string") bad(`a ${type.name}`);
      else if (def.pattern && !def.pattern.test(value)) bad(`a ${type.name}`);
      return;
    }
    case "array":
      if (!Array.isArray(value)) return bad("an array");
      if ((type.min !== undefined && value.length < type.min) || (type.max !== undefined && value.length > type.max)) out.push(`${path}: has ${value.length} entries`);
      value.forEach((v, i) => visit(v, type.of, `${path}[${i}]`, out));
      return;
    case "tuple":
      if (!Array.isArray(value) || value.length !== type.of.length) return bad(`an array of ${type.of.length}`);
      type.of.forEach((t, i) => visit(value[i], t.type, `${path}[${i}]`, out));
      return;
    case "map":
      if (!isObject(value)) return bad("an object");
      for (const [key, v] of Object.entries(value)) visit(v, type.of, `${path}.${key}`, out);
      return;
    case "object":
      if (!isObject(value)) return bad("an object");
      fields(value, type.fields, path, out);
      return;
    case "variants": {
      if (!isObject(value)) return bad("an object");
      const variant = type.variants.find((v) => v.value === value[type.on]);
      if (!variant) return void out.push(`${path}: ${type.on} is ${show(value[type.on])}, not one of ${type.variants.map((v) => v.value).join(", ")}`);
      fields(value, [...variant.fields, ...type.common], path, out, [type.on]);
      return;
    }
    case "union": {
      const tries = type.of.map((alt) => check(value, alt.type, path));
      if (!tries.some((errors) => errors.length === 0)) out.push(`${path}: ${show(value)} fits none of ${type.of.map((a) => a.label).join(", ")} (${tries.map((t) => t[0]).join("; ")})`);
      return;
    }
    case "lazy":
      visit(value, type.get(), path, out);
      return;
  }
}
