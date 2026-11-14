import * as Sentry from "@sentry/node";
import { createApp } from "./app.js";
import { loadEnv } from "./env.js";
import { createLogger } from "./log.js";

const env = loadEnv();
const log = createLogger(env.LOG_LEVEL, env.NODE_ENV === "development");
if (env.SENTRY_DSN) Sentry.init({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV });

const app = await createApp(env, log);
log.info({ outposts: app.content.world.outposts.length, contentVersion: app.content.world.version }, "content loaded, migrations applied");

const port = await app.listen(env.PORT);
log.info({ port, origins: env.CLIENT_ORIGINS, inviteGate: env.ALPHA_INVITE_CODE !== null }, "openseas server listening");

// Railway sends SIGTERM and kills the container after its draining time (RAILWAY_DEPLOYMENT_DRAINING_SECONDS,
// set above this deadline). Run under tini (railpack config), not pnpm,
// this process gets the signal itself; it exits 0 once closed, 1 if closing failed or outran the deadline (ADR 0048).
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
