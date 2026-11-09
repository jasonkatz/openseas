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

const shutdown = async (signal: string): Promise<void> => {
  log.info({ signal }, "shutting down");
  await app.close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
