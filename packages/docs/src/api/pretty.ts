/**
 * JSON written the way a person writes it: a short object or list stays on one line, and a long
 * one breaks, one entry a line. `JSON.stringify` knows only all on one line or everything broken.
 */
export function pretty(value: unknown, width = 72, indent = 0): string {
  const flat = oneLine(value);
  if (indent + flat.length <= width || value === null || typeof value !== "object") return flat;
  const pad = " ".repeat(indent + 2);
  const end = " ".repeat(indent);
  if (Array.isArray(value)) return `[\n${value.map((v) => pad + pretty(v, width, indent + 2)).join(",\n")}\n${end}]`;
  const entries = Object.entries(value as Record<string, unknown>).map(([k, v]) => `${pad}${JSON.stringify(k)}: ${pretty(v, width, indent + 2)}`);
  return `{\n${entries.join(",\n")}\n${end}}`;
}

function oneLine(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(oneLine).join(", ")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(([k, v]) => `${JSON.stringify(k)}: ${oneLine(v)}`);
    return entries.length === 0 ? "{}" : `{ ${entries.join(", ")} }`;
  }
  return JSON.stringify(value);
}
