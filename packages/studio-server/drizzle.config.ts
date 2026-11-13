import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/openseas_studio",
  },
  casing: "snake_case",
  // Everything this service owns, its migration journal included, is in the `studio` schema, so it
  // can share a database with the game's server (a test run does) without the two colliding.
  schemaFilter: ["studio"],
  migrations: { schema: "studio", table: "__migrations" },
});
