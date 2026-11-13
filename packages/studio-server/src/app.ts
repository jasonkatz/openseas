import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createDb, type Db } from "./db/index.js";
import { runMigrations } from "./db/migrate.js";
import type { Env } from "./env.js";
import { createGitHub, type GitHub } from "./github.js";
import { createHttpHandler } from "./http.js";
import type { Logger } from "./log.js";

export interface App {
  db: Db;
  listen(port: number): Promise<number>;
  close(): Promise<void>;
}

/** The service, migrated and ready to listen. A test hands in its own GitHub. */
export async function createApp(env: Env, log: Logger, github?: GitHub | null): Promise<App> {
  const { db, close: closeDb } = createDb(env.DATABASE_URL);
  await runMigrations(db);
  const gh = github !== undefined ? github : env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET ? createGitHub(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET) : null;
  const handler = createHttpHandler({ env, db, github: gh, log });
  const server: Server = createServer((req, res) => void handler(req, res));
  return {
    db,
    listen: (port) =>
      new Promise((resolve) => {
        server.listen(port, () => resolve((server.address() as AddressInfo).port));
      }),
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await closeDb();
    },
  };
}
