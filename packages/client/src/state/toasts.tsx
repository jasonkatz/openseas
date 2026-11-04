import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

export interface Toast {
  id: number;
  text: string;
  tone: "plain" | "good" | "warn";
}

interface ToastContextValue {
  toasts: Toast[];
  toast(text: string, tone?: Toast["tone"], ms?: number): void;
}

const Ctx = createContext<ToastContextValue | null>(null);

export function useToasts(): ToastContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useToasts outside ToastProvider");
  return v;
}

/** Short lines that float over the scene and fade: who came aboard, land ho, a brigand's hail. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(0);
  const toast = useCallback((text: string, tone: Toast["tone"] = "plain", ms = 3600) => {
    const id = ++next.current;
    setToasts((ts) => [...ts, { id, text, tone }].slice(-4));
    window.setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), ms);
  }, []);
  const value = useMemo(() => ({ toasts, toast }), [toasts, toast]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
