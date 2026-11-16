import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode, type RefObject } from "react";

export interface MenuState {
  readonly open: boolean;
  setOpen(open: boolean): void;
  readonly ref: RefObject<HTMLDivElement | null>;
}

/** A menu's open state. It shuts on a press anywhere outside it and on Escape. */
export function useMenu(): MenuState {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return { open, setOpen, ref };
}

/**
 * A menu off the studio's top bar (ADR 0056): what opens it, and the sheet it opens. The sheet
 * stays in the page while shut, so what it holds (a name half typed, a note that a link was made)
 * is there when it opens again.
 */
export function Menu({ id, menu, align = "left", trigger, children }: { id: string; menu: MenuState; align?: "left" | "right"; trigger: ReactNode; children: ReactNode }) {
  return (
    <div className="menu" ref={menu.ref}>
      {trigger}
      <div className={`menu-pop is-${align}`} hidden={!menu.open} data-menu={id}>
        {children}
      </div>
    </div>
  );
}

export function MenuButton({ id, menu, children, ...rest }: { id: string; menu: MenuState; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" aria-haspopup="true" aria-expanded={menu.open} onClick={() => menu.setOpen(!menu.open)} data-testid={`menu-${id}`} {...rest}>
      {children}
    </button>
  );
}
