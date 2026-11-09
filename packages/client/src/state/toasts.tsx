import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

/** Something a toast offers to do: answer an invitation, catch a ship, link an account. */
export interface ToastAction {
  label: string;
  run(): void;
  testId?: string;
}

export interface Toast {
  id: number;
  text: string;
  tone: "plain" | "good" | "warn";
  action?: ToastAction;
}

interface ToastContextValue {
  toasts: Toast[];
  toast(text: string, tone?: Toast["tone"], ms?: number, action?: ToastAction): void;
  dismiss(id: number): void;
}

const Ctx = createContext<ToastContextValue | null>(null);

export function useToasts(): ToastContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useToasts outside ToastProvider");
  return v;
}

/** Short lines that float over the scene and fade: who came aboard, touchdown, a raider's hail, a crewmate's call. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(0);
  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const toast = useCallback(
    (text: string, tone: Toast["tone"] = "plain", ms = 3600, action?: ToastAction) => {
      const id = ++next.current;
      setToasts((ts) => [...ts, { id, text, tone, ...(action ? { action } : {}) }].slice(-4));
      // A toast with something to do stays up longer, so there is time to do it.
      window.setTimeout(() => dismiss(id), action ? Math.max(ms, 8000) : ms);
    },
    [dismiss],
  );
  const value = useMemo(() => ({ toasts, toast, dismiss }), [toasts, toast, dismiss]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
