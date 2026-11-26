import { useEffect, useState, type ReactNode } from "react";
import { t } from "./content.js";
import { Link, useRoute } from "./router.jsx";
import { Search } from "./Search.jsx";
import { AREAS, areaOf, areaPath, navOf, neighbours, type Area, type NavItem } from "./site.js";

/** The site's mark: a ring with a dot, a line drawing on the pieces' 24 unit square. */
function Mark() {
  return (
    <svg className="mark" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="2.2" className="mark-dot" />
    </svg>
  );
}

function SideItem({ item, path, onGo }: { item: NavItem; path: string; onGo(): void }) {
  const open = item.children && (item.path === path || item.children.some((c) => c.path === path));
  return (
    <li>
      <Link to={item.path} aria-current={item.path === path ? "page" : undefined} aria-expanded={item.children ? Boolean(open) : undefined} onClick={onGo}>
        {item.code ? <code>{item.title}</code> : item.title}
        {item.children && (
          <svg className="side-fold" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
        )}
      </Link>
      {open && (
        <ul className="side-sub">
          {item.children!.map((child) => (
            <SideItem key={child.path} item={child} path={path} onGo={onGo} />
          ))}
        </ul>
      )}
    </li>
  );
}

function SideNav({ area, path, onGo }: { area: Area; path: string; onGo(): void }) {
  return (
    <nav className="side-nav" aria-label={t(`docs.area.${area}`)} data-testid="side-nav">
      {navOf(area).map((group) => (
        <section key={group.title}>
          <h2>{group.title}</h2>
          <ul>
            {group.items.map((item) => (
              <SideItem key={item.path} item={item} path={path} onGo={onGo} />
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}

/** The frame every page sits in: the bar across the top, and an area's list of pages down the side. */
export function Shell({ children }: { children: ReactNode }) {
  const { path } = useRoute();
  const area = areaOf(path);
  const [menu, setMenu] = useState(false);
  const [searching, setSearching] = useState(false);

  useEffect(() => setMenu(false), [path]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setSearching(true);
      } else if (e.key === "Escape") setMenu(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const areas = (
    <ul className="areas">
      {AREAS.map((a) => (
        <li key={a}>
          <Link to={areaPath(a)} aria-current={a === area ? "true" : undefined} data-testid={`area-${a}`}>
            {t(`docs.area.${a}`)}
          </Link>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="shell">
      <a className="skip" href="#main">{t("docs.skip")}</a>
      <header className="bar">
        <div className="bar-in">
          <Link to="/" className="brand" data-testid="brand">
            <Mark />
            <span>{t("docs.brand")}</span>
          </Link>
          <nav className="bar-areas" aria-label={t("docs.areas")}>{areas}</nav>
          <button type="button" className="bar-search" onClick={() => setSearching(true)} data-testid="open-search">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l5 5" /></svg>
            <span>{t("docs.search")}</span>
            <kbd>/</kbd>
          </button>
          <button type="button" className="bar-menu" aria-expanded={menu} aria-controls="drawer" onClick={() => setMenu((m) => !m)} data-testid="open-menu">
            <svg viewBox="0 0 24 24" aria-hidden="true">{menu ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}</svg>
            <span className="sr">{t(menu ? "docs.menu_close" : "docs.menu")}</span>
          </button>
        </div>
      </header>

      <div className={`frame ${area ? "frame-side" : ""}`}>
        <aside id="drawer" className={`side ${menu ? "side-open" : ""}`}>
          <nav className="side-areas" aria-label={t("docs.areas")}>{areas}</nav>
          {area && <SideNav area={area} path={path} onGo={() => setMenu(false)} />}
        </aside>
        <main id="main" className="main">
          {children}
        </main>
      </div>

      <footer className="foot">
        <div className="foot-in">
          <span>{t("docs.foot")}</span>
          <nav aria-label={t("docs.areas")}>{areas}</nav>
        </div>
      </footer>

      <Search open={searching} onClose={() => setSearching(false)} />
    </div>
  );
}

/** The links to the page before and the page after, at the foot of a page. */
export function Pager({ area, path }: { area: Area; path: string }) {
  const { prev, next } = neighbours(area, path);
  if (!prev && !next) return null;
  return (
    <nav className="pager" aria-label={t("docs.pager")}>
      {prev ? (
        <Link to={prev.path} className="pager-link" data-testid="pager-prev">
          <span className="muted">{t("docs.previous")}</span>
          {prev.title}
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link to={next.path} className="pager-link pager-next" data-testid="pager-next">
          <span className="muted">{t("docs.next")}</span>
          {next.title}
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
