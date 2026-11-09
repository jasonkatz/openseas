import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ErrorCode, PirateLookWire, PirateSheet, ServerMessage } from "@openseas/protocol";
import { sfx, t, usePirate } from "@openseas/boards";
import { titleName } from "../pirate/look.js";
import { useToasts } from "./toasts.jsx";

export type SheetTab = "pirate" | "record" | "titles";

export interface SheetContextValue {
  /** The pirate's own sheet over the scene: open, and on which tab. */
  tab: SheetTab | null;
  openSheet(tab?: SheetTab): void;
  closeSheet(): void;
  /** The record and every title's progress, as the server last sent them; null until asked. */
  sheet: PirateSheet | null;
  setLook(look: PirateLookWire): void;
  setTitle(titleId: string | null): void;
  /** The last request about the sheet the server refused. */
  error: ErrorCode | null;
}

const Ctx = createContext<SheetContextValue | null>(null);

export function useSheet(): SheetContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSheet outside SheetProvider");
  return v;
}

const SHEET_ERRORS = new Set<ErrorCode>(["look_bad", "title_locked"]);

/**
 * The pirate's own sheet (DESIGN.md 3.6, ADR 0033): who they are on deck and what their record has
 * earned. The look and the title come back on the pirate's summary; the record and the titles'
 * progress are asked for when the sheet opens. A title earned anywhere floats up as a toast.
 */
export function SheetProvider({ children }: { children: ReactNode }) {
  const { socket } = usePirate();
  const { toast } = useToasts();
  const [tab, setTab] = useState<SheetTab | null>(null);
  const [sheet, setSheet] = useState<PirateSheet | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const openRef = useRef(false);
  openRef.current = tab !== null;

  const openSheet = useCallback(
    (next: SheetTab = "pirate") => {
      setError(null);
      setTab(next);
      socket.send({ type: "pirate.sheet" });
    },
    [socket],
  );
  const closeSheet = useCallback(() => setTab(null), []);
  // Toast buttons reach the latest opener through a ref, so the socket handler is set up once.
  const opener = useRef(openSheet);
  opener.current = openSheet;

  useEffect(
    () =>
      socket.onMessage((m: ServerMessage) => {
        switch (m.type) {
          case "pirate.sheet":
            setSheet(m.sheet);
            return;
          case "pirate.titles": {
            sfx.streak(6);
            const names = m.earned.map((id) => titleName(id) ?? id);
            toast(names.length === 1 ? t("toast.title_earned", { title: names[0]! }) : t("toast.titles_earned", { count: names.length, titles: names.join(", ") }), "good", 7000, {
              label: t("toast.title_look"),
              run: () => opener.current("titles"),
              testId: "toast-title",
            });
            if (openRef.current) socket.send({ type: "pirate.sheet" });
            return;
          }
          case "error":
            if (SHEET_ERRORS.has(m.code)) setError(m.code);
            return;
          default:
        }
      }),
    [socket, toast],
  );

  const setLook = useCallback(
    (look: PirateLookWire) => {
      setError(null);
      socket.send({ type: "pirate.look", look });
    },
    [socket],
  );
  const setTitle = useCallback(
    (title: string | null) => {
      setError(null);
      socket.send({ type: "pirate.title", title });
    },
    [socket],
  );

  const value = useMemo(() => ({ tab, openSheet, closeSheet, sheet, setLook, setTitle, error }), [tab, openSheet, closeSheet, sheet, setLook, setTitle, error]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
