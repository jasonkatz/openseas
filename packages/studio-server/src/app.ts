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
import { createPlacer } from "./save/picks.js";
import { createRepo, type Repo } from "./save/repo.js";
import { createSaver, type Saver } from "./save/saver.js";
import { createBucketStore, type TakeStore } from "./takes/store.js";
import { createTakes, type Takes } from "./takes/takes.js";

export interface App {
  db: Db;
  /** Null when this service cannot Save. */
  saver: Saver | null;
  /** Null when this service has no chat. */
  chat: Chat | null;
  /** Null when this service has no bucket to keep takes in. */
  takes: Takes | null;
  listen(port: number): Promise<number>;
  close(): Promise<void>;
}

/**
 * Save needs somewhere to keep a clone, a repository to clone, and the GitHub App that pushes and
 * opens pull requests (ADR 0046). Short of any of them the service still keeps drafts and links.
 * A test hands in its own forge and a repository on its own disk.
 */
function createSaverFor(env: Env, db: Db, log: Logger, forge: Forge | null | undefined, takes: Takes | null): { saver: Saver; repo: Repo } | null {
  if (!env.STUDIO_REPO_DIR || !env.STUDIO_REPO) return null;
  let app: Forge | null = forge ?? null;
  if (forge === undefined && env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY) {
    try {
      app = createGitHubApp({ appId: env.GITHUB_APP_ID, privateKey: readPrivateKey(env.GITHUB_APP_PRIVATE_KEY), repo: env.STUDIO_REPO });
    } catch (err) {
      log.error({ err }, "Save is off: the GitHub App's private key cannot be read");
      return null;
    }
  }
  if (!app) return null;
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
  } catch {
    log.error("Save is off: there is no git on this machine (railpack.studio.json installs it)");
    return null;
  }
  const url = env.STUDIO_REPO_URL ?? `https://github.com/${env.STUDIO_REPO}.git`;
  const repo = createRepo({ dir: env.STUDIO_REPO_DIR, url, base: env.STUDIO_BASE_BRANCH, author: { name: env.STUDIO_GIT_NAME, email: env.STUDIO_GIT_EMAIL }, token: () => (url.startsWith("https:") ? app.token() : Promise.resolve(null)), log });
  // Picks are placed as their takes' bytes (ADR 0053): nothing is decoded.
  const placer = createPlacer({ repo, takes, log });
  return { repo, saver: createSaver({ db, repo, forge: app, log, base: env.STUDIO_BASE_BRANCH, studioOrigin: env.STUDIO_ORIGINS[0] ?? env.STUDIO_PUBLIC_URL, serviceOrigin: env.STUDIO_PUBLIC_URL, placer }) };
}

/**
 * The chat needs Save's clone, a key for the model, a cap on what it may spend, and, in
 * production, a unix user of its own for the agent (ADR 0047). Short of any of them the service
 * says it has no chat. A test hands in its own runner in place of the Claude Agent SDK.
 */
async function createChatFor(env: Env, db: Db, log: Logger, repo: Repo, runner: AgentRunner | undefined, takes: Takes | null): Promise<{ chat: Chat; proxy: ModelProxy } | null> {
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
  // The generation scripts' keys stay in this process too: the scripts reach their APIs through the proxy, which meters them (ADR 0059).
  const proxy = await createModelProxy({
    apiKey: env.ANTHROPIC_API_KEY ?? "none",
    log,
    ...(env.STUDIO_MODEL_UPSTREAM ? { upstream: env.STUDIO_MODEL_UPSTREAM } : {}),
    ...(env.OPENAI_API_KEY ? { openai: { key: env.OPENAI_API_KEY } } : {}),
    ...(env.ELEVENLABS_API_KEY ? { elevenlabs: { key: env.ELEVENLABS_API_KEY, ...(env.ELEVENLABS_USD_PER_CREDIT ? { usdPerCredit: env.ELEVENLABS_USD_PER_CREDIT } : {}) } } : {}),
  });
  const scripts = { openai: Boolean(env.OPENAI_API_KEY), elevenlabs: Boolean(env.ELEVENLABS_API_KEY) };
  const chat = createChat({ db, repo, runner: runner ?? createSdkRunner({ identity, scripts, log }), proxy, identity, capUsd, takes, log });
  return { chat, proxy };
}

/**
 * Takes need a bucket: its endpoint, its name and its two keys (ADR 0051). Short of any the
 * service keeps none, and the chat's takes stay in the draft's worktree. A test hands in a store
 * of its own.
 */
function createStoreFor(env: Env): TakeStore | null {
  const { STUDIO_BUCKET_ENDPOINT: endpoint, STUDIO_BUCKET_NAME: bucket, STUDIO_BUCKET_ACCESS_KEY_ID: accessKeyId, STUDIO_BUCKET_SECRET_ACCESS_KEY: secretAccessKey } = env;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return createBucketStore({ endpoint, bucket, accessKeyId, secretAccessKey, region: env.STUDIO_BUCKET_REGION, pathStyle: env.STUDIO_BUCKET_PATH_STYLE });
}

/** The service, migrated and ready to listen. A test hands in its own GitHub, its own forge for Save, its own agent, and its own store for takes. */
export async function createApp(env: Env, log: Logger, github?: GitHub | null, forge?: Forge | null, runner?: AgentRunner, store?: TakeStore | null): Promise<App> {
  const { db, close: closeDb } = createDb(env.DATABASE_URL);
  await runMigrations(db);
  const gh = github !== undefined ? github : env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET ? createGitHub(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET) : null;
  const bucket = store !== undefined ? store : createStoreFor(env);
  const takes = bucket ? createTakes({ db, store: bucket, log }) : null;
  const saving = createSaverFor(env, db, log, forge, takes);
  const saver = saving?.saver ?? null;
  await saver?.start();
  const chatting = saving ? await createChatFor(env, db, log, saving.repo, runner, takes) : null;
  const chat = chatting?.chat ?? null;
  await chat?.start();
  const handler = createHttpHandler({ env, db, github: gh, saver, chat, takes, log });
  const server: Server = createServer((req, res) => void handler(req, res));
  return {
    db,
    saver,
    chat,
    takes,
    listen: (port) =>
      new Promise((resolve) => {
        server.listen(port, () => resolve((server.address() as AddressInfo).port));
      }),
    // Stop taking requests, stop each chat turn where it stands (its edits are still committed),
    // let a Save already pushing finish, then close what is left. The deadline is index.ts's.
    close: async () => {
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeIdleConnections();
      chat?.stopAll();
      await chat?.idle();
      await saver?.idle();
      await chatting?.proxy.close();
      server.closeAllConnections();
      await closed;
      await closeDb();
    },
  };
}
