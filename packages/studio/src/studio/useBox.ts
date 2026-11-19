import { useLayoutEffect, useState, type RefObject } from "react";

/** An element's content box, kept current as it resizes: for drawings that size themselves to their room in a wide panel. */
export function useBox(ref: RefObject<Element | null>, on = true): { width: number; height: number } {
  const [box, setBox] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!on || !el) return;
    const read = (): void => {
      const r = el.getBoundingClientRect();
      setBox((b) => (Math.round(b.width) === Math.round(r.width) && Math.round(b.height) === Math.round(r.height) ? b : { width: r.width, height: r.height }));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, on]);
  return box;
}
