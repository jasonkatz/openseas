import { useEffect, useRef, type RefObject } from "react";

/**
 * What a board's renderer offers the React host (ADR 0040). `KitBoard` meets it, and so does each
 * core board's hand-built renderer until it moves onto the kit.
 */
export interface BoardRenderer<S> {
  /** True once the canvas exists, until `destroy`. The host hands the renderer nothing before then. */
  readonly isReady: boolean;
  /** Load what the board needs and make the canvas. Resolves having made nothing when `destroy` came first. */
  init(): Promise<void>;
  /** A new engine state to show. */
  setState(state: S): void;
  setInteractive(on: boolean): void;
  setShowMarks(on: boolean): void;
  /** Idle hints, on a board that has them. */
  setHints?(on: boolean): void;
  /** A key went down. Returns true when the board used it, so the page does not scroll. */
  keyboard(key: string): boolean;
  /** A key came up, on a board that acts while a key is held (a soft drop). Returns true when the board used it. */
  keyUp?(key: string): boolean;
  /** Free the canvas and everything the renderer made. Safe at any time, before `init` resolves too. */
  destroy(): void;
}

/** What the host reads from a board's props. Each board's own props extend these. */
export interface BoardHostProps<S> {
  state: S;
  /** Bumps when the same state object must be drawn again (a reset). */
  version?: number;
  interactive: boolean;
  showMarks: boolean;
  /** Idle hints, on a board whose renderer has them. Off unless said. */
  hints?: boolean;
}

/**
 * Hosts a board's renderer in a React component, the same way for every board (ADR 0040). It makes
 * the renderer once, on mount, and tears it down on unmount. Nothing reaches the renderer before it
 * is ready; then it is handed the latest state and settings, and after that each one as it changes.
 * Key presses reach it unless the player is typing in a field or holding Ctrl, Meta or Alt (the
 * browser's shortcuts); key releases reach a renderer that has `keyUp`.
 *
 * `make` is called once, with the host element and a ref to the latest props: wire callbacks through
 * `latest.current` so they always call the page's current handlers.
 */
export function useBoardHost<P extends BoardHostProps<unknown>, R extends BoardRenderer<P["state"]>>(
  make: (host: HTMLElement, latest: { readonly current: P }) => R,
  props: P,
): { host: RefObject<HTMLDivElement | null>; renderer: RefObject<R | null> } {
  const host = useRef<HTMLDivElement>(null);
  const renderer = useRef<R | null>(null);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const r = make(el, latest);
    renderer.current = r;
    let alive = true;
    void r.init().then(() => {
      if (!alive) return;
      const p = latest.current;
      r.setState(p.state);
      r.setInteractive(p.interactive);
      r.setShowMarks(p.showMarks);
      r.setHints?.(p.hints ?? false);
    });
    const onKeyDown = (e: KeyboardEvent): void => {
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (r.isReady && r.keyboard(e.key)) e.preventDefault();
    };
    // A release is the board's with a modifier held too, so a key it acts on while held always lets go.
    const onKeyUp = (e: KeyboardEvent): void => {
      if (typing(e.target)) return;
      if (r.isReady && r.keyUp?.(e.key)) e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    if (r.keyUp) window.addEventListener("keyup", onKeyUp);
    return () => {
      alive = false;
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
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
    const r = renderer.current;
    if (r?.isReady) r.setInteractive(props.interactive);
  }, [props.interactive]);

  useEffect(() => {
    const r = renderer.current;
    if (r?.isReady) r.setShowMarks(props.showMarks);
  }, [props.showMarks]);

  useEffect(() => {
    const r = renderer.current;
    if (r?.isReady) r.setHints?.(props.hints ?? false);
  }, [props.hints]);

  return { host, renderer };
}

/** True when a key went to a field the player types in, not to the board. */
function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}
