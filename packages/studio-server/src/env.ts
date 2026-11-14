import { z } from "zod";

const Bool = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

const List = (fallback: string) =>
  z
    .string()
    .default(fallback)
    .transform((s) => s.split(",").map((o) => o.trim()).filter(Boolean));

const Optional = z.string().optional().transform((v) => (v && v.length > 0 ? v : null));

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8090),
  /** A database of the service's own on the game's Postgres (ADR 0042 decision 4). */
  DATABASE_URL: z.string().min(1),
  /** Signs the session cookie. */
  STUDIO_SECRET: z.string().min(16, "STUDIO_SECRET must be at least 16 characters"),
  /** This service as the browser reaches it: GitHub is told to come back here. */
  STUDIO_PUBLIC_URL: z.string().url().default("http://localhost:8090"),
  /** The studio site's origins: the only pages that may sign in, make a link or withdraw one. Anyone may read a link. */
  STUDIO_ORIGINS: List("http://localhost:5174,http://localhost:4174"),
  /** GitHub logins that may sign in. Nobody else can, whatever GitHub says about them. */
  STUDIO_OWNERS: List("").transform((l) => l.map((s) => s.toLowerCase())),
  GITHUB_CLIENT_ID: Optional,
  GITHUB_CLIENT_SECRET: Optional,
  /** Set when the studio site and this service are on different sites, so the cookie must be SameSite=None. */
  CROSS_SITE_COOKIES: Bool,
  /** Off production only: `/auth/dev` signs this login in with no GitHub, for local work and the smoke. */
  STUDIO_DEV_LOGIN: Optional,
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"]).default("info"),
  RAILWAY_GIT_COMMIT_SHA: z.string().optional(),
  GIT_COMMIT_SHA: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema> & { COMMIT_SHA: string | null };

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const r = EnvSchema.safeParse(source);
  if (!r.success) throw new Error(`invalid environment:\n${z.prettifyError(r.error)}`);
  const env = r.data;
  if (env.NODE_ENV === "production" && env.STUDIO_DEV_LOGIN) throw new Error("invalid environment:\nSTUDIO_DEV_LOGIN must not be set in production");
  // The dev login is an owner by being configured: there is no GitHub to vouch for it.
  const dev = env.STUDIO_DEV_LOGIN?.toLowerCase();
  const owners = dev && !env.STUDIO_OWNERS.includes(dev) ? [...env.STUDIO_OWNERS, dev] : env.STUDIO_OWNERS;
  return { ...env, STUDIO_OWNERS: owners, COMMIT_SHA: env.GIT_COMMIT_SHA || env.RAILWAY_GIT_COMMIT_SHA || null };
}
