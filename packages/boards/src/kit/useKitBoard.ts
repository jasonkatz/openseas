import { useEffect, useRef, type RefObject } from "react";
import type { KitBoard } from "./board.js";

export interface KitBoardProps<S> {
  state: S;
  /** Bumps when the same state object must be drawn again (a reset). */
  version?: number;
  interactive: boolean;
  showMarks: boolean;
}

/**
 * Hosts a kit renderer in a React component (ADR 0036): makes it once, hands it every new state and
 * setting, forwards key presses, and tears it down. `make` is called once, on mount; read live props
 * inside the callbacks it wires through a ref.
 */
export function useKitBoard<S, R extends KitBoard<S>>(make: (host: HTMLElement) => R, props: KitBoardProps<S>): { host: RefObject<HTMLDivElement | null>; renderer: RefObject<R | null> } {
  const host = useRef<HTMLDivElement>(null);
  const renderer = useRef<R | null>(null);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const r = make(el);
    renderer.current = r;
    let alive = true;
    void r.init().then(() => {
      if (!alive) return;
      r.setState(latest.current.state);
      r.setInteractive(latest.current.interactive);
    });
    const onKey = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (r.isReady && r.keyboard(e.key)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      alive = false;
      window.removeEventListener("keydown", onKey);
      r.destroy();
      renderer.current = null;
    };
    // The renderer is made once; everything live reaches it through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const r = renderer.current;
    if (r?.isReady) r.setState(props.state);
  }, [props.state, props.version]);

  useEffect(() => {
    renderer.current?.setInteractive(props.interactive);
  }, [props.interactive]);

  useEffect(() => {
    renderer.current?.setShowMarks(props.showMarks);
  }, [props.showMarks]);

  return { host, renderer };
}
