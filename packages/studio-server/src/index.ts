import { createApp } from "./app.js";
import { loadEnv } from "./env.js";
import { createLogger } from "./log.js";

const env = loadEnv();
const log = createLogger(env.LOG_LEVEL, env.NODE_ENV === "development");
const app = await createApp(env, log);
const port = await app.listen(env.PORT);
log.info(
  { port, origins: env.STUDIO_ORIGINS, owners: env.STUDIO_OWNERS.length, github: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET), devLogin: env.STUDIO_DEV_LOGIN !== null, save: app.saver !== null, chat: app.chat !== null },
  "openseas studio service listening",
);
if (env.STUDIO_OWNERS.length === 0) log.warn("STUDIO_OWNERS is empty: nobody can sign in, so no link can be made or withdrawn");

if (!app.saver) log.warn("Save is off: it needs STUDIO_REPO_DIR, STUDIO_REPO, GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY (docs/DEPLOY.md, step 1b)");

if (app.saver && !app.chat) log.warn("the chat is off: it needs ANTHROPIC_API_KEY and STUDIO_SPEND_CAP_USD, and a service that starts as root (docs/DEPLOY.md, step 1b)");

// Railway sends SIGTERM and kills the container after its draining time (RAILWAY_DEPLOYMENT_DRAINING_SECONDS,
// set above this deadline). Run under tini as the container's first process (railpack config), this
// process gets the signal itself; it exits 0 once closed, 1 if closing failed or outran the deadline (ADR 0048).
const SHUTDOWN_DEADLINE_MS = 25_000;
let stopping = false;
const shutdown = async (signal: string): Promise<void> => {
  if (stopping) return;
  stopping = true;
  log.info({ signal }, "shutting down");
  setTimeout(() => {
    log.error({ deadlineMs: SHUTDOWN_DEADLINE_MS }, "shutdown outran its deadline; exiting");
    process.exit(1);
  }, SHUTDOWN_DEADLINE_MS).unref();
  try {
    await app.close();
  } catch (err) {
    log.error({ err }, "shutdown failed");
    process.exit(1);
  }
  log.info("shut down");
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
