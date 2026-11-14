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
import { ensureAgentUser } from "./chat/agentUser.js";
import { createChat, type Chat } from "./chat/chat.js";
import { createModelProxy, type ModelProxy } from "./chat/proxy.js";
import type { AgentRunner } from "./chat/runner.js";
import { createSdkRunner } from "./chat/sdkRunner.js";
import { createRepo, type Repo } from "./save/repo.js";
import { createSaver, type Saver } from "./save/saver.js";

export interface App {
  db: Db;
  /** Null when this service cannot Save. */
  saver: Saver | null;
  /** Null when this service has no chat. */
  chat: Chat | null;
  listen(port: number): Promise<number>;
  close(): Promise<void>;
}

/**
 * Save needs somewhere to keep a clone, a repository to clone, and the GitHub App that pushes and
 * opens pull requests (ADR 0046). Short of any of them the service still keeps drafts and links.
 * A test hands in its own forge and a repository on its own disk.
 */
function createSaverFor(env: Env, db: Db, log: Logger, forge: Forge | null | undefined): { saver: Saver; repo: Repo } | null {
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
  return { repo, saver: createSaver({ db, repo, forge: app, log, base: env.STUDIO_BASE_BRANCH, studioOrigin: env.STUDIO_ORIGINS[0] ?? env.STUDIO_PUBLIC_URL }) };
}

/**
 * The chat needs Save's clone, a key for the model, a cap on what it may spend, and, in
 * production, a unix user of its own for the agent (ADR 0047). Short of any of them the service
 * says it has no chat. A test hands in its own runner in place of the Claude Agent SDK.
 */
async function createChatFor(env: Env, db: Db, log: Logger, repo: Repo, runner: AgentRunner | undefined): Promise<{ chat: Chat; proxy: ModelProxy } | null> {
  const capUsd = env.STUDIO_SPEND_CAP_USD;
  if (capUsd === undefined || (!runner && !env.ANTHROPIC_API_KEY)) return null;
  const identity = runner ? null : ensureAgentUser(env.STUDIO_AGENT_USER, env.STUDIO_REPO_DIR!, log);
  if (!runner && !identity) {
    if (env.NODE_ENV === "production") {
      log.error("the chat is off: the service cannot run the agent as a user of its own (it must start as root, with useradd on the machine)");
      return null;
    }
    log.warn("the agent runs as the service's own user: there is no separation between them off production");
  }
  const proxy = await createModelProxy({ apiKey: env.ANTHROPIC_API_KEY ?? "none", log, ...(env.STUDIO_MODEL_UPSTREAM ? { upstream: env.STUDIO_MODEL_UPSTREAM } : {}) });
  const scriptKeys = { ...(env.OPENAI_API_KEY ? { OPENAI_API_KEY: env.OPENAI_API_KEY } : {}), ...(env.ELEVENLABS_API_KEY ? { ELEVENLABS_API_KEY: env.ELEVENLABS_API_KEY } : {}) };
  const chat = createChat({ db, repo, runner: runner ?? createSdkRunner({ identity, scriptKeys, log }), proxy, identity, capUsd, log });
  return { chat, proxy };
}

/** The service, migrated and ready to listen. A test hands in its own GitHub, and its own forge for Save. */
export async function createApp(env: Env, log: Logger, github?: GitHub | null, forge?: Forge | null, runner?: AgentRunner): Promise<App> {
  const { db, close: closeDb } = createDb(env.DATABASE_URL);
  await runMigrations(db);
  const gh = github !== undefined ? github : env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET ? createGitHub(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET) : null;
  const saving = createSaverFor(env, db, log, forge);
  const saver = saving?.saver ?? null;
  await saver?.start();
  const chatting = saving ? await createChatFor(env, db, log, saving.repo, runner) : null;
  const chat = chatting?.chat ?? null;
  await chat?.start();
  const handler = createHttpHandler({ env, db, github: gh, saver, chat, log });
  const server: Server = createServer((req, res) => void handler(req, res));
  return {
    db,
    saver,
    chat,
    listen: (port) =>
      new Promise((resolve) => {
        server.listen(port, () => resolve((server.address() as AddressInfo).port));
      }),
    close: async () => {
      await chat?.idle();
      await saver?.idle();
      await chatting?.proxy.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await closeDb();
    },
  };
}
