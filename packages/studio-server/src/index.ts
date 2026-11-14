import { createApp } from "./app.js";
import { loadEnv } from "./env.js";
import { createLogger } from "./log.js";

const env = loadEnv();
const log = createLogger(env.LOG_LEVEL, env.NODE_ENV === "development");
const app = await createApp(env, log);
const port = await app.listen(env.PORT);
log.info(
  { port, origins: env.STUDIO_ORIGINS, owners: env.STUDIO_OWNERS.length, github: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET), devLogin: env.STUDIO_DEV_LOGIN !== null, save: app.saver !== null },
  "openseas studio service listening",
);
if (env.STUDIO_OWNERS.length === 0) log.warn("STUDIO_OWNERS is empty: nobody can sign in, so no link can be made or withdrawn");

if (!app.saver) log.warn("Save is off: it needs STUDIO_REPO_DIR, STUDIO_REPO, GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY (docs/DEPLOY.md, step 1b)");

const shutdown = async (signal: string): Promise<void> => {
  log.info({ signal }, "shutting down");
  await app.close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
