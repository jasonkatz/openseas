import type { IncomingMessage } from "node:http";
import { randomInt } from "node:crypto";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import type { Content } from "@openseas/content";
import { parseClientMessage, type ServerMessage } from "@openseas/protocol";
import type { Auth } from "./auth.js";
import type { Db } from "./db/index.js";
import { InsufficientFundsError } from "./ledger.js";
import type { Logger } from "./log.js";
import { findPirateByUser, summarizePirate } from "./pirates.js";
import type { PuzzleService } from "./puzzles/service.js";
import type { RoomMember } from "./rooms.js";
import { ShipError, type ShipService } from "./ships/service.js";
import { NoSuchClassError, buyShip } from "./shipyard.js";
import { SocialError, type SocialService } from "./social.js";

export interface WsDeps {
  db: Db;
  auth: Auth;
  content: Content;
  log: Logger;
  puzzles: PuzzleService;
  ships: ShipService;
  social: SocialService;
}

interface Conn {
  pirateId: string;
  name: string;
  guest: boolean;
  /** This socket as a room member. One pirate, one seat; the newest socket holds it. */
  member: RoomMember<ServerMessage>;
  activeSessionId: string | null;
  /** Token bucket for message rate limiting. */
  tokens: number;
  lastRefill: number;
}

const MAX_MESSAGE_BYTES = 4096;
const BUCKET_SIZE = 40;
const REFILL_PER_SECOND = 20;

export function createWsServer(deps: WsDeps) {
  const { db, auth, content, log, puzzles, ships, social } = deps;
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  /** The newest connection per pirate, for messages addressed to a pirate rather than a room. */
  const conns = new Map<string, Conn>();

  const send = (ws: WebSocket, msg: ServerMessage): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  /** Re-send a pirate's summary after something about them changed on the server's side. */
  const resend = async (pirateId: string): Promise<void> => {
    const conn = conns.get(pirateId);
    if (!conn) return;
    const summary = await summarizePirate(db, content, pirateId, conn.guest);
    if (summary) conn.member.send({ type: "pirate.updated", pirate: summary });
  };
  ships.onSummaryChanged = (ids) => {
    for (const id of ids) void resend(id).catch((e) => log.warn({ err: e, pirateId: id }, "summary resend failed"));
  };
  const ashoreHook = ships.onAshore;
  ships.onAshore = (pirateId, islandId) => {
    ashoreHook?.(pirateId, islandId);
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
    const member: RoomMember<ServerMessage> = { id: pirateId, send: (m) => send(ws, m) };
    const conn: Conn = { pirateId, name: summary.name, guest, member, activeSessionId: null, tokens: BUCKET_SIZE, lastRefill: Date.now() };
    conns.set(pirateId, conn);
    // Listeners go on before anything asynchronous, so no early message is lost.
    ws.on("message", (data) => {
      void handleMessage(ws, conn, data.toString()).catch((e) => {
        if (e instanceof ShipError || e instanceof SocialError) {
          send(ws, { type: "error", code: e.code });
          return;
        }
        log.error({ err: e, pirateId }, "ws message failed");
        send(ws, { type: "error", code: "internal" });
      });
    });
    ws.on("close", () => {
      if (conns.get(pirateId) === conn) conns.delete(pirateId);
      if (conn.activeSessionId) {
        const s = puzzles.sessions.get(conn.activeSessionId);
        // Leave a practice session for the sweeper: a reconnecting client cannot resume (its board
        // is discarded, per DESIGN.md 3.4), but moves already received still count at the deadline.
        // A duty board is discarded at once by the ship service below.
        if (s) log.debug({ sessionId: s.id }, "connection closed with active session");
      }
      social.disconnected(pirateId, member);
      void ships.disconnect(pirateId, member).catch((e) => log.error({ err: e, pirateId }, "ship disconnect failed"));
    });

    send(ws, { type: "welcome", pirate: summary, serverNow: Date.now() });
    ships.reconnect(pirateId, member);
    await social.connected(pirateId, summary.name, member);
  };

  const allow = (conn: Conn): boolean => {
    const now = Date.now();
    conn.tokens = Math.min(BUCKET_SIZE, conn.tokens + ((now - conn.lastRefill) / 1000) * REFILL_PER_SECOND);
    conn.lastRefill = now;
    if (conn.tokens < 1) return false;
    conn.tokens -= 1;
    return true;
  };

  /** Close whatever round this connection is in the middle of before it starts another. */
  const dropActive = async (conn: Conn): Promise<void> => {
    if (!conn.activeSessionId) return;
    const old = puzzles.sessions.get(conn.activeSessionId);
    conn.activeSessionId = null;
    if (!old) return;
    if (old.duty) {
      const result = await puzzles.cutShort(old);
      if (result) conn.member.send(result);
    } else await puzzles.abandon(old);
  };

  const handleMessage = async (ws: WebSocket, conn: Conn, raw: string): Promise<void> => {
    if (!allow(conn)) {
      send(ws, { type: "error", code: "rate_limited" });
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      send(ws, { type: "error", code: "bad_message" });
      return;
    }
    const msg = parseClientMessage(parsed);
    if (!msg) {
      send(ws, { type: "error", code: "bad_message" });
      return;
    }
    switch (msg.type) {
      case "ping":
        send(ws, { type: "pong", t: msg.t, serverNow: Date.now() });
        return;
      case "puzzle.start": {
        await dropActive(conn);
        const started = puzzles.start(conn.pirateId, msg.puzzle);
        conn.activeSessionId = started.sessionId;
        send(ws, started);
        return;
      }
      case "duty.start": {
        await dropActive(conn);
        const started = await ships.dutyStart(conn.pirateId);
        conn.activeSessionId = started.sessionId;
        send(ws, started);
        return;
      }
      case "puzzle.move": {
        const s = puzzles.sessions.get(msg.sessionId);
        if (!s || s.pirateId !== conn.pirateId) {
          send(ws, { type: "error", code: "unknown_session" });
          return;
        }
        const reply = await puzzles.move(s, msg.seq, msg.move, msg.hash);
        if (reply) {
          conn.activeSessionId = null;
          send(ws, reply);
        }
        return;
      }
      case "puzzle.finish": {
        const s = puzzles.sessions.get(msg.sessionId);
        if (!s || s.pirateId !== conn.pirateId) {
          send(ws, { type: "error", code: "unknown_session" });
          return;
        }
        conn.activeSessionId = null;
        send(ws, await puzzles.finish(s, msg.hash, msg.metrics ?? null));
        return;
      }
      case "puzzle.abandon": {
        const s = puzzles.sessions.get(msg.sessionId);
        if (s && s.pirateId === conn.pirateId) {
          if (s.duty) {
            const result = await puzzles.cutShort(s);
            if (result) send(ws, result);
          } else await puzzles.abandon(s);
        }
        conn.activeSessionId = null;
        return;
      }
      case "ship.board":
        await ships.board(conn.pirateId, conn.name, msg.shipId, conn.member);
        return;
      case "ship.leave":
        await ships.leave(conn.pirateId);
        return;
      case "ship.station":
        await ships.station(conn.pirateId, msg.station);
        return;
      case "ship.sail":
        await ships.sail(conn.pirateId, msg.routeId);
        return;
      case "ship.evade":
        await ships.evade(conn.pirateId);
        return;
      case "ship.engage": {
        await dropActive(conn);
        const started = await ships.engage(conn.pirateId);
        conn.activeSessionId = started.sessionId;
        send(ws, started);
        ships.supplyNow(conn.pirateId);
        return;
      }
      case "ship.wheel":
        await ships.wheel(conn.pirateId, msg.pirateId);
        return;
      case "ship.lock":
        await ships.lock(conn.pirateId, msg.inviteOnly);
        return;
      case "board.list":
        send(ws, await ships.noticeBoard(conn.pirateId));
        return;
      case "shipyard.buy": {
        if (ships.roomOf(conn.pirateId)) throw new SocialError("aboard_a_ship");
        const islandId = await ships.pirateIsland(conn.pirateId);
        try {
          const bought = await buyShip(db, content, conn.pirateId, msg.classId, islandId, randomInt);
          log.info({ pirateId: conn.pirateId, shipId: bought.shipId, classId: msg.classId }, "ship bought");
        } catch (e) {
          if (e instanceof InsufficientFundsError) {
            send(ws, { type: "error", code: "short_of_coins" });
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
      case "island.who": {
        const islandId = social.islandOf(conn.pirateId) ?? (await ships.pirateIsland(conn.pirateId));
        send(ws, social.presence(islandId));
        return;
      }
      case "melee.join": {
        await dropActive(conn);
        const started = await ships.meleeJoin(conn.pirateId);
        conn.activeSessionId = started.sessionId;
        send(ws, started);
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
