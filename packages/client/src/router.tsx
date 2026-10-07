import { createContext, useContext, useEffect, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";

/** A tiny pathname router. Two routes do not justify a dependency. */
const RouteCtx = createContext<{ path: string; navigate(to: string): void }>({ path: "/", navigate: () => {} });

export function Router({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = (): void => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = (to: string): void => {
    if (to === window.location.pathname) return;
    window.history.pushState(null, "", to);
    setPath(to);
  };
  return <RouteCtx.Provider value={{ path, navigate }}>{children}</RouteCtx.Provider>;
}

export function useRoute() {
  return useContext(RouteCtx);
}

export function Link({ to, onClick, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const { navigate } = useRoute();
  const handle = (e: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(e);
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.button !== 0) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={handle} {...rest} />;
}
