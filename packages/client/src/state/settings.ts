import { useCallback, useEffect, useState } from "react";
import { isMuted, setMuted } from "@openseas/boards";

const MARKS_KEY = "openseas.markTiles";

export function readMarksFlag(): boolean {
  try {
    return window.localStorage.getItem(MARKS_KEY) === "1";
  } catch {
    return false;
  }
}

/** The "mark pieces" accessibility setting, shared by every board (CLAUDE.md rule 6). Per device. */
export function useShowMarks(): [boolean, (on: boolean) => void] {
  const [showMarks, setShowMarks] = useState(readMarksFlag);
  useEffect(() => {
    try {
      window.localStorage.setItem(MARKS_KEY, showMarks ? "1" : "0");
    } catch {
      /* private mode */
    }
  }, [showMarks]);
  return [showMarks, setShowMarks];
}

export function useMuted(): [boolean, (muted: boolean) => void] {
  const [muted, setMutedState] = useState(isMuted);
  const set = useCallback((m: boolean) => {
    setMuted(m);
    setMutedState(isMuted());
  }, []);
  return [muted, set];
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const onChange = (): void => setMatches(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** Ticks every `ms` while `active`, for countdowns read off a server clock. */
export function useNow(active: boolean, ms = 500): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [active, ms]);
  return now;
}
