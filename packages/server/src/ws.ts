import type { IncomingMessage } from "node:http";
import { randomInt } from "node:crypto";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import type { Content } from "@openseas/content";
import { parseClientMessage, type ServerMessage } from "@openseas/protocol";
import type { Auth } from "./auth.js";
import { CrewError, type CrewService } from "./crews.js";
import type { Db } from "./db/index.js";
import { InsufficientFundsError } from "./ledger.js";
import type { Logger } from "./log.js";
import { PirateError, awardTitles, findPirateByUser, pirateSheet, setLook, setTitle, summarizePirate, type PirateLooks } from "./pirates.js";
import type { Presence } from "./presence.js";
import { PRACTICE } from "./puzzles/binding.js";
import type { PuzzleService } from "./puzzles/service.js";
import { ShipError, type ShipService } from "./ships/service.js";
import { NoSuchClassError, buyShip } from "./shipyard.js";
import { SocialError, type SocialService } from "./social.js";

export interface WsDeps {
  db: Db;
  auth: Auth;
  content: Content;
  log: Logger;
  presence: Presence;
  puzzles: PuzzleService;
  ships: ShipService;
  social: SocialService;
  crews: CrewService;
  looks: PirateLooks;
}

interface Conn {
  pirateId: string;
  name: string;
  /** Token bucket for message rate limiting. */
  tokens: number;
  lastRefill: number;
}

const MAX_MESSAGE_BYTES = 4096;
const BUCKET_SIZE = 40;
const REFILL_PER_SECOND = 20;

export function createWsServer(deps: WsDeps) {
  const { db, auth, content, log, presence, puzzles, ships, social, crews, looks } = deps;
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  /** Whether each pirate online signed in as a guest, as their newest socket did. */
  const guests = new Map<string, boolean>();

  const send = (ws: WebSocket, msg: ServerMessage): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  /** Re-send a pirate's summary after something about them changed on the server's side. */
  const resend = async (pirateId: string): Promise<void> => {
    if (!presence.online(pirateId)) return;
    const summary = await summarizePirate(db, content, pirateId, guests.get(pirateId) ?? false);
    if (summary) presence.send(pirateId, { type: "pirate.updated", pirate: summary });
  };
  /** Tell a pirate about titles their record just earned (ADR 0033). */
  const announce = (pirateId: string, fresh: readonly string[]): void => {
    if (fresh.length) presence.send(pirateId, { type: "pirate.titles", earned: [...fresh] });
  };
  /** Their record may have grown: write down any title it now earns and say so. */
  const checkTitles = async (pirateId: string): Promise<void> => {
    const awarded = await awardTitles(db, content, pirateId);
    if (awarded) announce(pirateId, awarded.fresh);
  };
  /** Something about the pirate changed on the server's side: their summary, and any title it earned. */
  const changed = (pirateId: string): void => {
    void resend(pirateId).catch((e) => log.warn({ err: e, pirateId }, "summary resend failed"));
    void checkTitles(pirateId).catch((e) => log.warn({ err: e, pirateId }, "title check failed"));
  };
  ships.onSummaryChanged = (ids) => {
    for (const id of ids) changed(id);
  };
  crews.onSummaryChanged = (ids) => {
    social.refreshPresence(ids);
    for (const id of ids) void resend(id).catch((e) => log.warn({ err: e, pirateId: id }, "summary resend failed"));
  };
  const onOutpostHook = ships.onDisembark;
  ships.onDisembark = (pirateId, outpostId) => {
    onOutpostHook?.(pirateId, outpostId);
    void resend(pirateId).catch((e) => log.warn({ err: e, pirateId }, "summary resend failed"));
  };

  const handleUpgrade = async (req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> => {
    try {
      const headers = new Headers();
      if (req.headers.cookie) headers.set("cookie", req.headers.cookie);
      if (req.headers.origin) headers.set("origin", req.headers.origin);
      const session = await auth.api.getSession({ headers });
      const pirate = session ? await findPirateByUser(db, session.user.id) : null;
      if (!session || !pirate) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
        void onConnection(ws, pirate.id, Boolean(session.user.isAnonymous));
      });
    } catch (e) {
      log.error({ err: e }, "ws upgrade failed");
      socket.destroy();
    }
  };

  const onConnection = async (ws: WebSocket, pirateId: string, guest: boolean): Promise<void> => {
    const summary = await summarizePirate(db, content, pirateId, guest);
    if (!summary) {
      send(ws, { type: "error", code: "no_pirate" });
      ws.close();
      return;
    }
    const conn: Conn = { pirateId, name: summary.name, tokens: BUCKET_SIZE, lastRefill: Date.now() };
    // This socket takes the pirate's seat: whatever is addressed to the pirate comes here now.
    const detach = presence.attach(pirateId, { send: (m) => send(ws, m) });
    guests.set(pirateId, guest);
    // Listeners go on before anything asynchronous, so no early message is lost.
    ws.on("message", (data) => {
      void handleMessage(ws, conn, data.toString()).catch((e) => {
        if (e instanceof ShipError || e instanceof SocialError || e instanceof CrewError || e instanceof PirateError) {
          send(ws, { type: "error", code: e.code });
          return;
        }
        log.error({ err: e, pirateId }, "ws message failed");
        send(ws, { type: "error", code: "internal" });
      });
    });
    ws.on("close", () => {
      // A newer socket holds the seat: the pirate is still here, and nothing changes.
      if (!detach()) return;
      guests.delete(pirateId);
      const open = puzzles.sessions.openFor(pirateId);
      // Leave a practice session for the sweeper: a reconnecting client cannot resume (its board
      // is discarded, per DESIGN.md 3.4), but moves already received still count at the deadline,
      // unless the pirate starts another round first, which quits it. A duty board is discarded at
      // once by the ship service below; the ship holds the battle and a melee board for their return.
      if (open) log.debug({ sessionId: open.id }, "connection closed with an open round");
      social.disconnected(pirateId);
      void ships.disconnect(pirateId).catch((e) => log.error({ err: e, pirateId }, "ship disconnect failed"));
    });

    looks.remember(pirateId, summary.look);
    send(ws, { type: "welcome", pirate: summary, serverNow: Date.now() });
    ships.reconnect(pirateId);
    await social.connected(pirateId, summary.name);
    crews.connected(pirateId, summary.name);
    // A record that grew while titles did not exist yet, or while away, is caught up on arrival.
    void checkTitles(pirateId).catch((e) => log.warn({ err: e, pirateId }, "title check failed"));
  };

  const allow = (conn: Conn): boolean => {
    const now = Date.now();
    conn.tokens = Math.min(BUCKET_SIZE, conn.tokens + ((now - conn.lastRefill) / 1000) * REFILL_PER_SECOND);
    conn.lastRefill = now;
    if (conn.tokens < 1) return false;
    conn.tokens -= 1;
    return true;
  };

  const handleMessage = async (ws: WebSocket, conn: Conn, raw: string): Promise<void> => {
    // A dropped message is logged: a dropped puzzle move breaks the client's numbering (ADR 0024).
    if (!allow(conn)) {
      log.warn({ pirateId: conn.pirateId, type: messageType(raw) }, "message rate limited");
      send(ws, { type: "error", code: "rate_limited" });
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      log.warn({ pirateId: conn.pirateId, bytes: raw.length }, "message not json");
      send(ws, { type: "error", code: "bad_message" });
      return;
    }
    const msg = parseClientMessage(parsed);
    if (!msg) {
      log.warn({ pirateId: conn.pirateId, type: messageType(raw), sample: raw.slice(0, 300) }, "message failed the protocol");
      send(ws, { type: "error", code: "bad_message" });
      return;
    }
    switch (msg.type) {
      case "ping":
        send(ws, { type: "pong", t: msg.t, serverNow: Date.now() });
        return;
      case "puzzle.start":
        send(ws, await puzzles.start(conn.pirateId, msg.puzzle, { binding: PRACTICE }));
        return;
      case "duty.start":
        send(ws, await ships.dutyStart(conn.pirateId));
        return;
      case "puzzle.move": {
        const s = puzzles.sessions.get(msg.sessionId);
        if (!s || s.pirateId !== conn.pirateId) {
          send(ws, { type: "error", code: "unknown_session" });
          return;
        }
        await puzzles.move(s, msg.seq, msg.move, msg.hash);
        return;
      }
      case "puzzle.finish": {
        const s = puzzles.sessions.get(msg.sessionId);
        if (!s || s.pirateId !== conn.pirateId) {
          send(ws, { type: "error", code: "unknown_session" });
          return;
        }
        // The old board's claim after a hand-back: the rebuilt board finishes for itself.
        if (puzzles.sessions.staleFinish(s, msg.hash)) return;
        const result = await puzzles.finish(s, msg.hash, msg.metrics ?? null);
        // A board that moved standing may have earned a standing title.
        if (result.type === "puzzle.result" && result.rating) await checkTitles(conn.pirateId);
        return;
      }
      case "puzzle.abandon": {
        const s = puzzles.sessions.get(msg.sessionId);
        if (s && s.pirateId === conn.pirateId) await puzzles.quit(s);
        return;
      }
      case "ship.board":
        await ships.board(conn.pirateId, conn.name, msg.shipId);
        return;
      case "ship.leave":
        await ships.leave(conn.pirateId);
        return;
      case "ship.station":
        await ships.station(conn.pirateId, msg.station);
        return;
      case "ship.launch":
        await ships.launch(conn.pirateId, msg.laneId);
        return;
      case "ship.evade":
        await ships.evade(conn.pirateId);
        return;
      case "ship.engage":
        send(ws, await ships.engage(conn.pirateId));
        ships.supplyNow(conn.pirateId);
        return;
      case "ship.helm":
        await ships.helm(conn.pirateId, msg.pirateId);
        return;
      case "ship.assign":
        await ships.assign(conn.pirateId, msg.pirateId, msg.station);
        return;
      case "ship.lock":
        await ships.lock(conn.pirateId, msg.inviteOnly);
        return;
      case "board.list":
        send(ws, await ships.noticeBoard(conn.pirateId));
        return;
      case "shipyard.buy": {
        if (ships.roomOf(conn.pirateId)) throw new SocialError("aboard_a_ship");
        const outpostId = await ships.pirateOutpost(conn.pirateId);
        try {
          const bought = await buyShip(db, content, conn.pirateId, msg.classId, outpostId, randomInt);
          log.info({ pirateId: conn.pirateId, shipId: bought.shipId, classId: msg.classId }, "ship bought");
        } catch (e) {
          if (e instanceof InsufficientFundsError) {
            send(ws, { type: "error", code: "short_of_credits" });
            return;
          }
          if (e instanceof NoSuchClassError) {
            send(ws, { type: "error", code: "no_such_class" });
            return;
          }
          throw e;
        }
        await resend(conn.pirateId);
        return;
      }
      case "chat.send":
        social.chat(conn.pirateId, msg.channel, msg.text);
        return;
      case "walk.to":
        social.walk(conn.pirateId, { x: msg.x, z: msg.z });
        return;
      case "outpost.who": {
        const outpostId = social.outpostOf(conn.pirateId) ?? (await ships.pirateOutpost(conn.pirateId));
        send(ws, social.presence(outpostId));
        return;
      }
      case "melee.join":
        await ships.meleeJoin(conn.pirateId);
        return;
      case "crew.info":
        send(ws, crews.stateFor(conn.pirateId));
        return;
      case "crew.list":
        send(ws, crews.list());
        return;
      case "crew.found":
        await crews.found(conn.pirateId, msg.name, msg.flag);
        return;
      case "crew.flag":
        await crews.setFlag(conn.pirateId, msg.flag);
        return;
      case "crew.invite":
        await crews.invite(conn.pirateId, msg.name);
        return;
      case "crew.uninvite":
        await crews.uninvite(conn.pirateId, msg.pirateId);
        return;
      case "crew.answer":
        await crews.answer(conn.pirateId, msg.crewId, msg.accept);
        return;
      case "crew.leave":
        await crews.leave(conn.pirateId);
        return;
      case "crew.rank":
        await crews.setRank(conn.pirateId, msg.pirateId, msg.rank);
        return;
      case "crew.remove":
        await crews.remove(conn.pirateId, msg.pirateId);
        return;
      case "pirate.profile":
        send(ws, await crews.profile(conn.pirateId, { pirateId: msg.pirateId, name: msg.name }));
        return;
      case "pirate.sheet": {
        const r = await pirateSheet(db, content, conn.pirateId);
        if (!r) throw new PirateError("no_pirate");
        send(ws, { type: "pirate.sheet", sheet: r.sheet });
        announce(conn.pirateId, r.fresh);
        return;
      }
      case "pirate.look": {
        looks.remember(conn.pirateId, await setLook(db, content, conn.pirateId, msg.look));
        ships.refreshLooks([conn.pirateId]);
        social.refreshPresence([conn.pirateId]);
        await resend(conn.pirateId);
        return;
      }
      case "pirate.title": {
        const fresh = await setTitle(db, content, conn.pirateId, msg.title);
        await resend(conn.pirateId);
        announce(conn.pirateId, fresh);
        return;
      }
      default: {
        const never: never = msg;
        void never;
      }
    }
  };

  return { wss, handleUpgrade };
}

/** The `type` of a raw client message, for a log line; never trusted for anything else. */
function messageType(raw: string): string | null {
  const m = /"type"\s*:\s*"([^"]{1,40})"/.exec(raw);
  return m ? m[1]! : null;
}
