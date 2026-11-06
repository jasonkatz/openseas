import { z } from "zod";

const Bool = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(16, "BETTER_AUTH_SECRET must be at least 16 characters"),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:8080"),
  CLIENT_ORIGINS: z
    .string()
    .default("http://localhost:5173,http://localhost:5174")
    .transform((s) => s.split(",").map((o) => o.trim()).filter(Boolean)),
  CROSS_SITE_COOKIES: Bool,
  ALPHA_INVITE_CODE: z.string().optional().transform((v) => (v && v.length > 0 ? v : null)),
  SENTRY_DSN: z.string().optional(),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"]).default("info"),
  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  // Previews copy production's OAuth keys, but the providers only redirect to production; this
  // switches social sign-in off there so no button is offered that cannot work.
  DISABLE_SOCIAL_SIGN_IN: Bool,
  // Set by Railway (RAILWAY_GIT_COMMIT_SHA) or by hand (GIT_COMMIT_SHA). Reported by /health so a
  // post-merge check can tell which commit is live. Empty locally.
  RAILWAY_GIT_COMMIT_SHA: z.string().optional(),
  GIT_COMMIT_SHA: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema> & { COMMIT_SHA: string | null };

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const r = EnvSchema.safeParse(source);
  if (!r.success) {
    throw new Error(`invalid environment:\n${z.prettifyError(r.error)}`);
  }
  return { ...r.data, COMMIT_SHA: r.data.GIT_COMMIT_SHA || r.data.RAILWAY_GIT_COMMIT_SHA || null };
}
