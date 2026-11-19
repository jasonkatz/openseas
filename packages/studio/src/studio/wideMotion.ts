import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

const MS = 320;
const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

interface Boxes {
  panel: DOMRect;
  stage: DOMRect;
  rest: DOMRect;
}

/**
 * Opens and shuts the wide panel as one motion (ADR 0068). The grid snaps to its new layout at
 * once; each region then starts drawn where it was and eases into its new place, so nothing jumps.
 * The board, with the bar under it, flies and scales between the middle and the top of the right
 * column; the chat slides between that column's top and its lower half; the panel's edge sweeps
 * open over the middle. Only transforms and a clip move, so the board keeps playing on the way.
 * Nothing moves for someone who asked for less motion.
 */
export function useWideMotion(wide: boolean, panel: RefObject<HTMLElement | null>, stage: RefObject<HTMLElement | null>, rest: RefObject<HTMLElement | null>): void {
  const last = useRef<Boxes | null>(null);
  const was = useRef(wide);

  const measure = (): Boxes | null => (panel.current && stage.current && rest.current ? { panel: panel.current.getBoundingClientRect(), stage: stage.current.getBoundingClientRect(), rest: rest.current.getBoundingClientRect() } : null);

  // The page's own resize moves every box without a render: keep the last boxes true to it.
  useEffect(() => {
    const onResize = (): void => {
      last.current = measure();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // The refs are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    const before = last.current;
    const now = measure();
    last.current = now;
    if (was.current === wide) return;
    was.current = wide;
    // A board sizes itself to its box on the window's resize alone (Pixi's resizeTo): tell it its box moved.
    window.requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    if (!before || !now || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const fly = (el: HTMLElement | null, from: DOMRect, to: DOMRect, scaled: boolean): void => {
      if (!el || to.width === 0 || to.height === 0) return;
      const s = scaled ? from.height / to.height : 1;
      const dx = from.left + from.width / 2 - (to.left + to.width / 2);
      const dy = scaled ? from.top + from.height / 2 - (to.top + to.height / 2) : from.top - to.top;
      el.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${s})`, transformOrigin: scaled ? "50% 50%" : "50% 0" }, { transform: "none", transformOrigin: scaled ? "50% 50%" : "50% 0" }], { duration: MS, easing: EASE });
    };
    // The board passes over the chat on its way: it stays on top until it lands.
    stage.current?.animate([{ zIndex: 5, position: "relative" }, { zIndex: 5, position: "relative" }], { duration: MS });
    fly(stage.current, before.stage, now.stage, true);
    fly(rest.current, before.rest, now.rest, false);
    // Opening, the panel's edge sweeps across the middle; shutting, the board landing there covers it.
    const grew = now.panel.width - before.panel.width;
    if (grew > 0) panel.current?.animate([{ clipPath: `inset(0 ${grew}px 0 0 round 13px)` }, { clipPath: "inset(0 0 0 0 round 13px)" }], { duration: MS, easing: EASE });
    // The refs are stable; the boxes are read, not depended on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });
}
