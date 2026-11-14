import { useEffect, useSyncExternalStore } from "react";
import type { StudioMe } from "@openseas/protocol";
import { SERVICE_URL, fetchMe, signOut as sendSignOut } from "./client.js";

/** Who the service takes this browser for: not asked yet, the answer, or null when it cannot be reached. */
export type Me = StudioMe | null | "loading";

/**
 * One answer for the whole site, asked once a page load: the home grid, a puzzle's frame and its
 * tester links all read it, and signing out tells them all. Nothing asks until something on
 * screen needs to know, so `/play` pages never do.
 */
let me: Me = "loading";
let asked = false;
const listeners = new Set<() => void>();
const set = (next: Me): void => {
  me = next;
  for (const l of listeners) l();
};
const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** `wanted` false leaves the service unasked and answers as if it were not there. */
export function useMe(wanted = true): Me {
  const on = wanted && SERVICE_URL !== "";
  useEffect(() => {
    if (!on || asked) return;
    asked = true;
    void fetchMe().then(set);
  }, [on]);
  const value = useSyncExternalStore(subscribe, () => me);
  return on ? value : null;
}

export async function signOut(): Promise<void> {
  await sendSignOut();
  if (me !== "loading" && me !== null) set({ ...me, login: null });
}
