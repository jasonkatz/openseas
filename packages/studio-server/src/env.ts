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
  /**
   * Save (ADR 0046). All four of the directory, the repository and the App's id and key must be
   * set for the service to offer it; with any missing it keeps drafts and links and says it cannot Save.
   */
  /** A directory on a volume: the clone and a worktree a draft live here and outlast a deploy. */
  STUDIO_REPO_DIR: Optional,
  /** The repository drafts are saved to, as `owner/name`. */
  STUDIO_REPO: Optional.refine((v) => v === null || /^[\w.-]+\/[\w.-]+$/.test(v), "STUDIO_REPO must be owner/name"),
  /** Where to clone from, when that is not `https://github.com/<STUDIO_REPO>.git`. */
  STUDIO_REPO_URL: Optional,
  /** The branch a draft is cut from and its pull request is opened against. */
  STUDIO_BASE_BRANCH: z.string().min(1).default("main"),
  /** The studio's GitHub App: installed on that repository alone, with contents and pull requests to write. */
  GITHUB_APP_ID: Optional,
  /** Its private key: the PEM, the PEM with `\n` for line ends, or the whole of it in base64. */
  GITHUB_APP_PRIVATE_KEY: Optional,
  /** Who a commit made by Save is by. The App's own bot address makes GitHub show its avatar. */
  STUDIO_GIT_NAME: z.string().min(1).default("openseas studio"),
  STUDIO_GIT_EMAIL: z.string().min(3).default("studio@openseas.online"),
  /**
   * The chat (ADR 0047). It needs Save's variables, the model key and the cap; with any missing
   * the service keeps drafts and Save and says it has no chat.
   */
  /** The key the chat's turns are paid with. It stays in this process: the agent reaches a model only through the service's own proxy. */
  ANTHROPIC_API_KEY: Optional,
  /** Where the model's API is, when that is not Anthropic's own address. */
  STUDIO_MODEL_UPSTREAM: Optional,
  /** US dollars: all the chat may spend, every draft together. A turn that reaches it is stopped where it stands. Raise it to carry on. */
  STUDIO_SPEND_CAP_USD: z.coerce.number().positive().optional(),
  /** The unix user the agent's processes run as. Made at startup if it is not there, which takes root. */
  STUDIO_AGENT_USER: z.string().regex(/^[a-z_][a-z0-9_-]*$/).default("studio-agent"),
  /** The two keys the generation scripts read (ADR 0040): the only credentials in the agent's shell. */
  OPENAI_API_KEY: Optional,
  ELEVENLABS_API_KEY: Optional,
  /**
   * Takes (ADR 0051): an S3-compatible bucket, on Railway. All four of the endpoint, the bucket's
   * name and its two keys must be set for the service to keep takes; with any missing the chat
   * still makes them in the draft's worktree and the panels list none. The keys stay in this
   * process: nothing of the bucket is in the agent's shell.
   */
  STUDIO_BUCKET_ENDPOINT: Optional,
  STUDIO_BUCKET_NAME: Optional,
  STUDIO_BUCKET_ACCESS_KEY_ID: Optional,
  STUDIO_BUCKET_SECRET_ACCESS_KEY: Optional,
  STUDIO_BUCKET_REGION: z.string().min(1).default("auto"),
  /** The bucket's name in the path, not the host: for a store that is not Railway's (a local one). */
  STUDIO_BUCKET_PATH_STYLE: Bool,
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
