import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Draft } from "@openseas/protocol";
import type { HarnessPuzzle } from "../puzzles.js";
import type { Scenario } from "../scenario/codec.js";
import { createDraft, discardDraft, listDrafts, saveDraft, type DraftSave } from "../service/client.js";
import { useMe } from "../service/me.js";
import { carriesDraft, draftNumbers, sameNumbers, withDraft, withoutDraft } from "./draft.js";

/**
 * Where a studio page's draft is kept (ADR 0045).
 *
 * - `off`: in the address and nowhere else, as before the service kept drafts. Signed out, no
 *   service, a service that cannot be reached, and every page that is not a studio page.
 * - `loading`: the service is being asked. The page plays the address meanwhile.
 * - `address`: the owner is signed in, and the page plays the numbers its address carries. Nothing
 *   is saved until the owner says which of the two to keep. `why` says how the page came to be so:
 *   it was opened on a link, a save was not taken, or the stored draft changed somewhere else.
 * - `stored`: the service keeps the draft and every change is saved to it. The address is bare.
 *   `draft` is null until the first change opens one.
 */
export type DraftStore =
  | { readonly state: "off" | "loading" }
  | { readonly state: "address"; readonly stored: Draft | null; readonly why: "link" | "unsaved" | "stale"; readonly busy: boolean; readonly keepable: boolean }
  | { readonly state: "stored"; readonly draft: Draft | null; readonly status: "saved" | "saving" | "held" };

type Internal = { state: "off" | "loading" } | { state: "address"; stored: Draft | null; why: "link" | "unsaved" | "stale" } | { state: "stored"; draft: Draft | null };

export interface StoredDraft {
  readonly store: DraftStore;
  /** True while the service keeps the draft, so the address must not carry it. Read at the moment of a change, not of a render. */
  bare(): boolean;
  /** On an address's numbers: make them the stored draft. False when the service would not. */
  keep(): Promise<boolean>;
  /** On an address's numbers: drop them for the stored draft. */
  open(): void;
  /** Discard the stored draft: the row goes, and the page is back on the shipped numbers. */
  discard(): Promise<boolean>;
}

/** How long the hand must rest before a change is saved. */
const SAVE_MS = 500;

/**
 * Keeps a studio page's draft in the service for the signed-in owner. `apply` sets the page's
 * scenario and writes the address: with the draft in it, or bare. Everything the service fails at
 * ends with the draft back in the address, so nothing tuned is lost with it.
 */
export function useStoredDraft<S, M, C>(o: { enabled: boolean; puzzle: HarnessPuzzle<S, M, C>; scenario: Scenario; apply(next: Scenario, bare: boolean): void }): StoredDraft {
  const { enabled, puzzle, scenario, apply } = o;
  const me = useMe(enabled);
  const login = me !== "loading" && me !== null ? me.login : null;
  const [store, setStoreState] = useState<Internal>({ state: enabled ? "loading" : "off" });
  const [busy, setBusy] = useState(false);
  const latest = useRef({ scenario, store, apply });
  latest.current.scenario = scenario;
  latest.current.apply = apply;
  const setStore = useCallback((next: Internal) => {
    latest.current.store = next;
    setStoreState(next);
  }, []);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** The stored draft takes the page when the address carries nothing of its own, or the same thing. */
  const meet = useCallback(
    (stored: Draft | null, why: "link" | "stale") => {
      const s = latest.current.scenario;
      const mine = draftNumbers(puzzle, s);
      if (!carriesDraft(s) || (stored && mine && sameNumbers(mine, stored.numbers))) {
        setStore({ state: "stored", draft: stored });
        latest.current.apply(withDraft(s, stored?.numbers ?? null), true);
      } else {
        setStore({ state: "address", stored, why });
        latest.current.apply(s, false);
      }
    },
    [puzzle, setStore],
  );
  /** Back to the address: whatever the page holds is written there. */
  const fall = useCallback(
    (next: Internal) => {
      setStore(next);
      latest.current.apply(latest.current.scenario, false);
    },
    [setStore],
  );

  useEffect(() => {
    if (!enabled) return;
    if (me === "loading") return setStore({ state: "loading" });
    if (!login) {
      if (latest.current.store.state !== "off") fall({ state: "off" });
      return;
    }
    let current = true;
    setStore({ state: "loading" });
    void listDrafts(puzzle.id).then((list) => {
      if (!current) return;
      if (!list) return fall({ state: "off" });
      meet(list[0] ?? null, "link");
    });
    return () => {
      current = false;
    };
  }, [enabled, me, login, puzzle.id, meet, fall, setStore]);

  const mine = useMemo(
    () => draftNumbers(puzzle, scenario),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [puzzle, scenario.seed, scenario.overrides, scenario.roundSeconds, scenario.paceSeconds, scenario.thresholds],
  );
  // No row is made for a page nobody has touched: the first change opens the draft.
  const dirty = store.state === "stored" && mine !== null && (store.draft ? !sameNumbers(mine, store.draft.numbers) : carriesDraft(scenario));

  /** A save the service refused: it changed somewhere else, or the service is not answering. */
  const refused = useCallback(
    async (r: Extract<DraftSave, { ok: false }>, stored: Draft | null) => {
      if (r.reason === "failed") return fall({ state: "address", stored, why: "unsaved" });
      const list = await listDrafts(puzzle.id);
      if (alive.current) fall({ state: "address", stored: list ? (list[0] ?? null) : stored, why: "stale" });
    },
    [fall, puzzle.id],
  );

  const save = useCallback(async () => {
    const at = latest.current.store;
    const numbers = draftNumbers(puzzle, latest.current.scenario);
    if (at.state !== "stored" || !numbers) return;
    setBusy(true);
    const r = at.draft ? await saveDraft(at.draft.id, numbers, at.draft.revision) : await createDraft(puzzle.id, numbers);
    if (!alive.current) return;
    setBusy(false);
    // Signed out or discarded while the save was on its way: it has nothing to say to this page now.
    if (latest.current.store !== at) return;
    if (r.ok) setStore({ state: "stored", draft: r.draft });
    else await refused(r, at.draft);
  }, [puzzle, refused, setStore]);

  // Leaving the page with a change not yet sent: send it now. Declared before the timer's effect so
  // that its cleanup runs first and still finds the save waiting.
  const waiting = useRef<(() => void) | null>(null);
  useEffect(() => {
    const flush = (): void => waiting.current?.();
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);
  useEffect(() => {
    if (!dirty || busy) return;
    const run = (): void => {
      window.clearTimeout(id);
      waiting.current = null;
      void save();
    };
    const id = window.setTimeout(run, SAVE_MS);
    waiting.current = run;
    return () => {
      window.clearTimeout(id);
      if (waiting.current === run) waiting.current = null;
    };
  }, [dirty, busy, mine, save]);

  const keep = useCallback(async (): Promise<boolean> => {
    const at = latest.current.store;
    const numbers = draftNumbers(puzzle, latest.current.scenario);
    if (at.state !== "address" || !numbers) return false;
    setBusy(true);
    const r = at.stored ? await saveDraft(at.stored.id, numbers, at.stored.revision) : await createDraft(puzzle.id, numbers);
    if (!alive.current) return r.ok;
    setBusy(false);
    if (latest.current.store !== at) return r.ok;
    if (r.ok) {
      // Whatever was changed while the save was on its way is saved next, as any change is.
      setStore({ state: "stored", draft: r.draft });
      latest.current.apply(latest.current.scenario, true);
    } else await refused(r, at.stored);
    return r.ok;
  }, [puzzle, refused, setStore]);

  const open = useCallback(() => {
    const at = latest.current.store;
    if (at.state !== "address") return;
    setStore({ state: "stored", draft: at.stored });
    latest.current.apply(withDraft(latest.current.scenario, at.stored?.numbers ?? null), true);
  }, [setStore]);

  const discard = useCallback(async (): Promise<boolean> => {
    const at = latest.current.store;
    if (at.state !== "stored" || !at.draft) return false;
    setBusy(true);
    const ok = await discardDraft(at.draft.id);
    if (!alive.current) return ok;
    setBusy(false);
    if (ok && latest.current.store === at) {
      setStore({ state: "stored", draft: null });
      latest.current.apply(withoutDraft(latest.current.scenario), true);
    }
    return ok;
  }, [setStore]);

  const bare = useCallback(() => latest.current.store.state === "stored", []);
  const view = useMemo<DraftStore>(() => {
    if (store.state === "address") return { ...store, busy, keepable: mine !== null };
    if (store.state === "stored") return { ...store, status: mine === null ? "held" : busy || dirty ? "saving" : "saved" };
    return store;
  }, [store, busy, dirty, mine]);
  return { store: view, bare, keep, open, discard };
}
