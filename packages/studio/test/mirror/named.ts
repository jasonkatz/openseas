/**
 * The two engines number their pieces from different starts, so a piece's id is compared as who it is: the
 * same piece wherever both name one, through every move. Ids are renamed in the order they are first met.
 */
export function named(names: Map<number, number>) {
  const name = (id: number): number => names.get(id) ?? (names.set(id, names.size), names.size - 1);
  const walk = (v: unknown, key?: string): unknown => {
    if (key === "nextId") return 0;
    if (key === "id") return name(v as number);
    if (Array.isArray(v)) return v.map((x) => (key === "ids" ? name(x as number) : walk(x)));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    return v;
  };
  return walk;
}
