import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import type { Content } from "@openseas/content";
import { parseClientMessage, type ServerMessage } from "@openseas/protocol";
import type { Auth } from "./auth.js";
import type { Db } from "./db/index.js";
import type { Logger } from "./log.js";
import { findPirateByUser, summarizePirate } from "./pirates.js";
import type { PuzzleService } from "./puzzles/service.js";

export interface WsDeps {
  db: Db;
  auth: Auth;
  content: Content;
  log: Logger;
  puzzles: PuzzleService;
}

interface Conn {
  pirateId: string;
  activeSessionId: string | null;
  /** Token bucket for message rate limiting. */
  tokens: number;
  lastRefill: number;
}

const MAX_MESSAGE_BYTES = 4096;
const BUCKET_SIZE = 40;
const REFILL_PER_SECOND = 20;

export function createWsServer(deps: WsDeps) {
  const { db, auth, content, log, puzzles } = deps;
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

  const send = (ws: WebSocket, msg: ServerMessage): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
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
    const conn: Conn = { pirateId, activeSessionId: null, tokens: BUCKET_SIZE, lastRefill: Date.now() };
    const summary = await summarizePirate(db, content, pirateId, guest);
    if (!summary) {
      send(ws, { type: "error", code: "no_pirate" });
      ws.close();
      return;
    }
    send(ws, { type: "welcome", pirate: summary, serverNow: Date.now() });

    ws.on("message", (data) => {
      void handleMessage(ws, conn, data.toString()).catch((e) => {
        log.error({ err: e, pirateId }, "ws message failed");
        send(ws, { type: "error", code: "internal" });
      });
    });
    ws.on("close", () => {
      if (conn.activeSessionId) {
        const s = puzzles.sessions.get(conn.activeSessionId);
        // Leave the session for the sweeper: a reconnecting client cannot resume (its board is
        // discarded, per DESIGN.md 3.4), but moves already received still count at the deadline.
        if (s) log.debug({ sessionId: s.id }, "connection closed with active session");
      }
    });
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
        if (conn.activeSessionId) {
          const old = puzzles.sessions.get(conn.activeSessionId);
          if (old) await puzzles.abandon(old);
        }
        const started = puzzles.start(conn.pirateId, msg.puzzle);
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
        if (s && s.pirateId === conn.pirateId) await puzzles.abandon(s);
        conn.activeSessionId = null;
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
