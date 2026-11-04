import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { loadContent, type Content } from "@openseas/content";
import { createAuth } from "./auth.js";
import { createDb, type Db } from "./db/index.js";
import { runMigrations } from "./db/migrate.js";
import type { Env } from "./env.js";
import { createHttpHandler } from "./http.js";
import type { Logger } from "./log.js";
import { PuzzleService } from "./puzzles/service.js";
import { ShipService } from "./ships/service.js";
import { SocialService } from "./social.js";
import { createWsServer } from "./ws.js";

export interface App {
  server: Server;
  db: Db;
  content: Content;
  puzzles: PuzzleService;
  ships: ShipService;
  social: SocialService;
  listen(port: number): Promise<number>;
  close(): Promise<void>;
}

/** Wire every dependency. `index.ts` calls this with real env; tests call it with a test database. */
export async function createApp(env: Env, log: Logger, opts: { now?: () => number } = {}): Promise<App> {
  // Fail loudly on bad content before touching the network (ADR 0009).
  const content = loadContent();
  const { db, close: closeDb } = createDb(env.DATABASE_URL);
  await runMigrations(db);

  const auth = createAuth(env, db, log);
  const puzzles = new PuzzleService(db, content, log, opts.now);
  const ships = new ShipService(db, content, log, puzzles, {
    ...(opts.now ? { now: opts.now } : {}),
    randomSeed: () => randomBytes(16).toString("hex"),
    randomId: () => randomUUID(),
  });
  const social = new SocialService(ships, opts.now);
  const http = createHttpHandler({ env, db, auth, content, log });
  const ws = createWsServer({ db, auth, content, log, puzzles, ships, social });

  const server = createServer((req, res) => void http(req, res));
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }
    void ws.handleUpgrade(req, socket, head);
  });

  let sweeper: NodeJS.Timeout | null = null;
  let ticker: NodeJS.Timeout | null = null;

  return {
    server,
    db,
    content,
    puzzles,
    ships,
    social,
    listen: (port) =>
      new Promise((resolve) => {
        server.listen(port, () => {
          sweeper = setInterval(() => void puzzles.sweep(), 5_000);
          ticker = setInterval(() => void ships.tick(), 1_000);
          resolve((server.address() as AddressInfo).port);
        });
      }),
    close: async () => {
      if (sweeper) clearInterval(sweeper);
      if (ticker) clearInterval(ticker);
      for (const client of ws.wss.clients) client.close(1001, "server shutting down");
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await puzzles.sweep();
      await closeDb();
    },
  };
}
