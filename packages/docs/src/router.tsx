import { createContext, useContext, useEffect, useLayoutEffect, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";

/** A tiny router, as the studio has: a static site of pages does not justify a dependency. It keeps the path and the anchor. */
interface Route {
  readonly path: string;
  readonly hash: string;
}
const RouteCtx = createContext<Route & { navigate(to: string, opts?: { replace?: boolean }): void }>({ path: "/", hash: "", navigate: () => {} });

const here = (): Route => ({ path: window.location.pathname, hash: window.location.hash });

export function Router({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(here);
  // Counts navigations made here, so the page scrolls for a link and never for a level picked on a guide.
  const [moves, setMoves] = useState(0);

  useEffect(() => {
    const sync = (): void => {
      setRoute(here());
      setMoves((n) => n + 1);
    };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const navigate = (to: string, opts?: { replace?: boolean }): void => {
    const url = new URL(to, window.location.href);
    if (url.pathname === window.location.pathname && url.hash === window.location.hash) return;
    if (opts?.replace) window.history.replaceState(null, "", url);
    else window.history.pushState(null, "", url);
    setRoute({ path: url.pathname, hash: url.hash });
    setMoves((n) => n + 1);
  };

  // After the new page is on screen: to its anchor, or to its top.
  useLayoutEffect(() => {
    const id = decodeURIComponent(route.hash.slice(1));
    const target = id ? document.getElementById(id) : null;
    if (!target) {
      if (moves > 0) window.scrollTo({ top: 0, behavior: "instant" });
      return;
    }
    const go = (): void => target.scrollIntoView({ behavior: "instant" });
    go();
    // A page opened at an anchor is laid out again once its typefaces arrive, so it is brought back to the heading.
    let live = true;
    void document.fonts?.ready.then(() => {
      if (live && target.isConnected) go();
    });
    return () => {
      live = false;
    };
  }, [route.path, route.hash, moves]);

  return <RouteCtx.Provider value={{ ...route, navigate }}>{children}</RouteCtx.Provider>;
}

export function useRoute() {
  return useContext(RouteCtx);
}

export function Link({ to, onClick, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const { navigate } = useRoute();
  const handle = (e: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(e);
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={handle} {...rest} />;
}
