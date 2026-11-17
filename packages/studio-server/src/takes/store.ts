import { AwsClient } from "aws4fetch";

/**
 * Where the takes kept from before have their bytes (ADR 0051): a bucket, by a key. The service's
 * own is an S3-compatible bucket on Railway; a test hands in one that holds them in memory. The
 * service only reads it: nothing makes a take now (ADR 0062, ADR 0064).
 */
export interface TakeStore {
  /** The bytes under a key, or null when there are none. */
  get(key: string): Promise<Buffer | null>;
}

export interface BucketOptions {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  /** The bucket in the path, not the host. Railway's buckets are addressed by host. */
  pathStyle: boolean;
}

/** An S3-compatible bucket, asked over HTTPS with signed requests. */
export function createBucketStore(o: BucketOptions): TakeStore {
  // A bucket that is failing is asked three times in all, not the client's ten: a page waits on this.
  const client = new AwsClient({ accessKeyId: o.accessKeyId, secretAccessKey: o.secretAccessKey, service: "s3", region: o.region, retries: 2, initRetryMs: 100 });
  const base = new URL(o.endpoint);
  if (!o.pathStyle) base.hostname = `${o.bucket}.${base.hostname}`;
  const root = `${base.origin}${base.pathname.replace(/\/$/, "")}${o.pathStyle ? `/${o.bucket}` : ""}`;
  const at = (key: string): string => `${root}/${key.split("/").map(encodeURIComponent).join("/")}`;
  return {
    async get(key) {
      const res = await client.fetch(at(key));
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`the bucket would not give a take: ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    },
  };
}

/** A store a test fills by hand (`objects`), which forgets when the process ends. */
export function createMemoryStore(): TakeStore & { readonly objects: Map<string, { bytes: Buffer; contentType: string }> } {
  const objects = new Map<string, { bytes: Buffer; contentType: string }>();
  return { objects, get: async (key) => objects.get(key)?.bytes ?? null };
}
