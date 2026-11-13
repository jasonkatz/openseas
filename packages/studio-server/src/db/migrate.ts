import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb, type Db } from "./index.js";

/** The journal sits in the `studio` schema with the tables it tracks (see drizzle.config.ts). */
export async function runMigrations(db: Db): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  await migrate(db, { migrationsFolder: join(here, "../../drizzle"), migrationsSchema: "studio", migrationsTable: "__migrations" });
}

// `pnpm db:migrate`
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const { db, close } = createDb(url);
  await runMigrations(db);
  await close();
  console.log("migrations applied");
}
