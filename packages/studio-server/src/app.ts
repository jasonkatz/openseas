import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createDb, type Db } from "./db/index.js";
import { runMigrations } from "./db/migrate.js";
import type { Env } from "./env.js";
import { createGitHub, type GitHub } from "./github.js";
import { createHttpHandler } from "./http.js";
import type { Logger } from "./log.js";
import { createGitHubApp, readPrivateKey, type Forge } from "./save/forge.js";
import { createRepo } from "./save/repo.js";
import { createSaver, type Saver } from "./save/saver.js";

export interface App {
  db: Db;
  /** Null when this service cannot Save. */
  saver: Saver | null;
  listen(port: number): Promise<number>;
  close(): Promise<void>;
}

/**
 * Save needs somewhere to keep a clone, a repository to clone, and the GitHub App that pushes and
 * opens pull requests (ADR 0046). Short of any of them the service still keeps drafts and links.
 * A test hands in its own forge and a repository on its own disk.
 */
function createSaverFor(env: Env, db: Db, log: Logger, forge: Forge | null | undefined): Saver | null {
  if (!env.STUDIO_REPO_DIR || !env.STUDIO_REPO) return null;
  const app = forge !== undefined ? forge : env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY ? createGitHubApp({ appId: env.GITHUB_APP_ID, privateKey: readPrivateKey(env.GITHUB_APP_PRIVATE_KEY), repo: env.STUDIO_REPO }) : null;
  if (!app) return null;
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
  } catch {
    log.error("Save is off: there is no git on this machine (railpack.studio.json installs it)");
    return null;
  }
  const url = env.STUDIO_REPO_URL ?? `https://github.com/${env.STUDIO_REPO}.git`;
  const repo = createRepo({ dir: env.STUDIO_REPO_DIR, url, base: env.STUDIO_BASE_BRANCH, author: { name: env.STUDIO_GIT_NAME, email: env.STUDIO_GIT_EMAIL }, token: () => (url.startsWith("https:") ? app.token() : Promise.resolve(null)), log });
  return createSaver({ db, repo, forge: app, log, base: env.STUDIO_BASE_BRANCH, studioOrigin: env.STUDIO_ORIGINS[0] ?? env.STUDIO_PUBLIC_URL });
}

/** The service, migrated and ready to listen. A test hands in its own GitHub, and its own forge for Save. */
export async function createApp(env: Env, log: Logger, github?: GitHub | null, forge?: Forge | null): Promise<App> {
  const { db, close: closeDb } = createDb(env.DATABASE_URL);
  await runMigrations(db);
  const gh = github !== undefined ? github : env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET ? createGitHub(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET) : null;
  const saver = createSaverFor(env, db, log, forge);
  await saver?.start();
  const handler = createHttpHandler({ env, db, github: gh, saver, log });
  const server: Server = createServer((req, res) => void handler(req, res));
  return {
    db,
    saver,
    listen: (port) =>
      new Promise((resolve) => {
        server.listen(port, () => resolve((server.address() as AddressInfo).port));
      }),
    close: async () => {
      await saver?.idle();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await closeDb();
    },
  };
}
