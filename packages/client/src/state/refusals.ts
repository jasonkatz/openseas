import type { ClientMessageType, ErrorCode, ErrorMessage } from "@openseas/protocol";

/** What in the game sends requests to the server and shows the server's refusals of them. */
export type Requester = "ship" | "duty" | "crew" | "sheet";

/**
 * Who sends each request, and so whose a refusal of it is (ADR 0043). Null where nobody shows a
 * refusal: the request is the scene's own and asks again, or the board's session settles it.
 * Every client message is listed, so a new one is given a requester when it is added.
 */
const SENT_BY: { readonly [T in ClientMessageType]: Requester | null | ((code: ErrorCode) => Requester) } = {
  ping: null,
  // A round's own messages: its board's session settles them.
  "puzzle.start": null,
  "puzzle.move": null,
  "puzzle.finish": null,
  "puzzle.abandon": null,
  "ship.board": "ship",
  "ship.leave": "ship",
  "ship.station": "ship",
  "ship.launch": "ship",
  "ship.evade": "ship",
  "ship.engage": "ship",
  "ship.helm": "ship",
  "ship.assign": "ship",
  "ship.lock": "ship",
  // The station asks for its board by itself and asks again after a refusal, which it never shows.
  "duty.start": "duty",
  "board.list": "ship",
  "shipyard.buy": "ship",
  // A line of chat is refused on the card that holds its channel: the crew's on the crew card, the ship's and the outpost's on the ship's.
  "chat.send": (code) => (code === "not_in_crew" ? "crew" : "ship"),
  // The scene asks these by itself: who is about, where the pirate walks, and the melee's board, again until it comes.
  "outpost.who": null,
  "walk.to": null,
  "melee.join": null,
  "crew.info": "crew",
  "crew.list": "crew",
  "crew.found": "crew",
  "crew.flag": "crew",
  "crew.invite": "crew",
  "crew.uninvite": "crew",
  "crew.answer": "crew",
  "crew.leave": "crew",
  "crew.rank": "crew",
  "crew.remove": "crew",
  "pirate.profile": "crew",
  "pirate.sheet": "sheet",
  "pirate.look": "sheet",
  "pirate.title": "sheet",
};

export interface RefusalContext {
  /** The crew card is open. Read only for a refusal from an older server, which names no request. */
  crewPanelOpen?: boolean;
}

/**
 * Whether a refusal from the server is this requester's to show: it refuses a request the requester
 * sent. At most one requester takes a refusal that names its request; a refusal that names none
 * (from a server older than ADR 0043) is routed by its code.
 */
export function isRefusalFor(m: ErrorMessage, requester: Requester, ctx: RefusalContext = {}): boolean {
  if (m.for === undefined) return byCode(m.code, ctx.crewPanelOpen ?? false).includes(requester);
  const by = SENT_BY[m.for];
  return (typeof by === "function" ? by(m.code) : by) === requester;
}

/**
 * How a refusal was routed before the server named the request (ADR 0043): by sets of codes that
 * overlap, so one refusal can reach two requesters. It serves a server older than the field, and is
 * deleted once no such server can be deployed.
 */
function byCode(code: ErrorCode, crewPanelOpen: boolean): Requester[] {
  const ship: readonly ErrorCode[] = [
    "no_ship",
    "ship_elsewhere",
    "ship_full",
    "ship_locked",
    "already_aboard",
    "not_aboard",
    "not_captain",
    "not_owner",
    "not_docked",
    "not_in_flight",
    "bad_lane",
    "station_taken",
    "no_station",
    "not_hailed",
    "no_such_class",
    "short_of_credits",
    "aboard_a_ship",
    "in_battle",
    "not_in_battle",
    "is_bot",
    "not_bot",
    "not_bot_station",
  ];
  const duty: readonly ErrorCode[] = ["not_in_flight", "no_station", "not_aboard", "in_battle"];
  const crew: readonly ErrorCode[] = [
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
  ];
  const sheet: readonly ErrorCode[] = ["look_bad", "title_locked"];
  const to: Requester[] = [];
  if (ship.includes(code)) to.push("ship");
  if (duty.includes(code)) to.push("duty");
  // A crew is founded from the crew card, for a fee.
  if (crew.includes(code) || (code === "short_of_credits" && crewPanelOpen)) to.push("crew");
  if (sheet.includes(code)) to.push("sheet");
  return to;
}
