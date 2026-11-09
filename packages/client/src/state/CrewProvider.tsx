import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ClientMessage, CrewFlagWire, CrewInfo, CrewInvite, CrewNotice, CrewRank, CrewRow, ErrorCode, PirateProfile, ServerMessage } from "@openseas/protocol";
import { sfx, t, usePirate } from "@openseas/boards";
import { outpostName, tierName } from "../names.js";
import { useShip } from "./ShipProvider.jsx";
import { useToasts } from "./toasts.jsx";

export interface CrewLogLine {
  id: number;
  notice: CrewNotice;
  at: number;
}

export type CrewTab = "crew" | "chat" | "board";

export interface CrewContextValue {
  /** The pirate's crew as the server last described it, or null. */
  crew: CrewInfo | null;
  /** The pirate's own rank, or null outside a crew. */
  rank: CrewRank | null;
  invites: CrewInvite[];
  /** The board of crews, once asked for. */
  rows: CrewRow[] | null;
  /** What happened to the crew lately, newest last. */
  log: CrewLogLine[];
  /** The last crew request the server refused. */
  error: ErrorCode | null;
  /** The crew card over the scene: open, and on which tab. */
  panel: CrewTab | null;
  openPanel(tab?: CrewTab): void;
  closePanel(): void;
  /** A pirate's card, opened by tapping their name anywhere. */
  profile: PirateProfile | null;
  showProfile(by: { pirateId?: string; name?: string }): void;
  closeProfile(): void;
  refresh(): void;
  listCrews(): void;
  found(name: string, flag: CrewFlagWire): void;
  setFlag(flag: CrewFlagWire): void;
  invite(name: string): void;
  uninvite(pirateId: string): void;
  answer(crewId: string, accept: boolean): void;
  leave(): void;
  setRank(pirateId: string, rank: CrewRank): void;
  remove(pirateId: string): void;
  clearError(): void;
}

const Ctx = createContext<CrewContextValue | null>(null);

export function useCrew(): CrewContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCrew outside CrewProvider");
  return v;
}

const CREW_ERRORS = new Set<ErrorCode>([
  "not_in_crew",
  "already_in_crew",
  "crew_name_taken",
  "crew_name_bad",
  "crew_flag_bad",
  "crew_rank_low",
  "crew_full",
  "crew_invites_full",
  "no_such_pirate",
  "no_invite",
  "already_invited",
  "already_crewmate",
]);

/** What a crew notice says, for the toast and the crew's log. */
export function describeCrewNotice(n: CrewNotice): string {
  switch (n.type) {
    case "invited":
      return t("crew.notice_invited", { by: n.by, crew: n.crew.name });
    case "founded":
      return t("crew.notice_founded", { crew: n.crew.name });
    case "joined":
      return t("crew.notice_joined", { name: n.name });
    case "declined":
      return t("crew.notice_declined", { name: n.name });
    case "left":
      return t("crew.notice_left", { name: n.name });
    case "removed":
      return t("crew.notice_removed", { name: n.name, by: n.by });
    case "dismissed":
      return t("crew.notice_dismissed", { crew: n.crewName, by: n.by });
    case "rank":
      return t("crew.notice_rank", { name: n.name, rank: t(`crew.rank.${n.rank}`) });
    case "flag":
      return t("crew.notice_flag", { by: n.by });
    case "launched":
      return t(n.names.length > 1 ? "crew.notice_launched_many" : "crew.notice_launched", { names: n.names.join(", "), ship: n.shipName, outpost: outpostName(n.to) });
    case "victory":
      return t("crew.notice_victory", { names: n.names.join(", "), ship: n.shipName, raider: tierName(n.tierId), credits: n.plunder });
    default: {
      const never: never = n;
      return never;
    }
  }
}

/**
 * The pirate's crew (M6, ADR 0025), as the server pushes it. Notices float up as toasts with
 * something to do where there is one: answer an invitation, catch crewmates in flight.
 */
export function CrewProvider({ children }: { children: ReactNode }) {
  const { socket, pirate } = usePirate();
  const { boardShip } = useShip();
  const { toast } = useToasts();
  const [crew, setCrew] = useState<CrewInfo | null>(null);
  const [invites, setInvites] = useState<CrewInvite[]>([]);
  const [rows, setRows] = useState<CrewRow[] | null>(null);
  const [log, setLog] = useState<CrewLogLine[]>([]);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [panel, setPanel] = useState<CrewTab | null>(null);
  const [profile, setProfile] = useState<PirateProfile | null>(null);
  const wantProfile = useRef(false);
  const lineId = useRef(0);
  /** The crew last shown, to greet the pirate when they land in a new one. */
  const shownCrew = useRef<string | null | undefined>(undefined);
  const me = pirate?.id ?? "";
  const meRef = useRef(me);
  meRef.current = me;

  const send = useCallback(
    (msg: ClientMessage) => {
      setError(null);
      socket.send(msg);
    },
    [socket],
  );

  // Toast actions reach the latest callbacks through refs, so the socket handler is set up once.
  const actions = useRef({ openPanel: (_tab: CrewTab) => {}, board: (_id: string) => {} });
  actions.current.board = boardShip;
  actions.current.openPanel = (tab) => setPanel(tab);

  useEffect(
    () =>
      socket.onMessage((m: ServerMessage) => {
        switch (m.type) {
          case "crew.state": {
            const before = shownCrew.current;
            shownCrew.current = m.crew?.id ?? null;
            // Joining a crew (not founding one: that has its own notice) is worth a cheer.
            const rankNow = m.crew?.members.find((x) => x.pirateId === meRef.current)?.rank;
            if (before !== undefined && m.crew && before !== m.crew.id && rankNow !== "commodore") {
              sfx.streak(5);
              toast(t("crew.toast_welcome", { crew: m.crew.name }), "good", 6000);
            }
            setCrew(m.crew);
            setInvites(m.invites);
            if (!m.crew) setLog([]);
            break;
          }
          case "crew.list":
            setRows(m.crews);
            break;
          case "crew.notice": {
            const n = m.notice;
            setLog((l) => [...l, { id: ++lineId.current, notice: n, at: m.at }].slice(-12));
            const text = describeCrewNotice(n);
            if (n.type === "invited") {
              sfx.streak(3);
              toast(text, "good", 10000, { label: t("crew.toast_view"), run: () => actions.current.openPanel("crew"), testId: "toast-crew-view" });
            } else if (n.type === "launched") {
              toast(text, "plain", 9000, n.joinable ? { label: t("crew.toast_join"), run: () => actions.current.board(n.shipId), testId: "toast-crew-join" } : undefined);
            } else if (n.type === "victory" || n.type === "founded") {
              sfx.streak(5);
              toast(text, "good", 7000);
            } else if (n.type === "dismissed") {
              toast(text, "warn", 7000);
            } else toast(text, n.type === "joined" ? "good" : "plain");
            break;
          }
          case "pirate.profile":
            if (wantProfile.current) setProfile(m.profile);
            break;
          case "error":
            if (CREW_ERRORS.has(m.code) || (m.code === "short_of_credits" && panel !== null)) setError(m.code);
            break;
          default:
            break;
        }
      }),
    [socket, toast, panel],
  );

  // Joining a ship from a toast or the crew card goes aboard; the card gets out of the way.
  useEffect(
    () =>
      socket.onMessage((m: ServerMessage) => {
        if (m.type === "ship.state" && m.events.some((e) => e.type === "boarded" && e.pirateId === me)) setPanel(null);
      }),
    [socket, me],
  );

  const rank = useMemo<CrewRank | null>(() => crew?.members.find((x) => x.pirateId === me)?.rank ?? null, [crew, me]);

  const value = useMemo<CrewContextValue>(
    () => ({
      crew,
      rank,
      invites,
      rows,
      log,
      error,
      panel,
      openPanel: (tab = "crew") => {
        setPanel(tab);
        send({ type: "crew.info" });
      },
      closePanel: () => setPanel(null),
      profile,
      showProfile: (by) => {
        wantProfile.current = true;
        setProfile(null);
        send({ type: "pirate.profile", ...(by.pirateId ? { pirateId: by.pirateId } : {}), ...(by.name ? { name: by.name } : {}) });
      },
      closeProfile: () => {
        wantProfile.current = false;
        setProfile(null);
      },
      refresh: () => send({ type: "crew.info" }),
      listCrews: () => send({ type: "crew.list" }),
      found: (name, flag) => send({ type: "crew.found", name, flag }),
      setFlag: (flag) => send({ type: "crew.flag", flag }),
      invite: (name) => send({ type: "crew.invite", name }),
      uninvite: (pirateId) => send({ type: "crew.uninvite", pirateId }),
      answer: (crewId, accept) => send({ type: "crew.answer", crewId, accept }),
      leave: () => send({ type: "crew.leave" }),
      setRank: (pirateId, r) => send({ type: "crew.rank", pirateId, rank: r }),
      remove: (pirateId) => send({ type: "crew.remove", pirateId }),
      clearError: () => setError(null),
    }),
    [crew, rank, invites, rows, log, error, panel, profile, send],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
