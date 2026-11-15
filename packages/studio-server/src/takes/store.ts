import { AwsClient } from "aws4fetch";

/**
 * Where a take's bytes are kept (ADR 0051): a bucket, by a key. The service's own is an
 * S3-compatible bucket on Railway; a test hands in one that keeps them in memory.
 */
export interface TakeStore {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
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
  // A bucket that is failing is asked three times in all, not the client's ten: a turn's end and a page wait on this.
  const client = new AwsClient({ accessKeyId: o.accessKeyId, secretAccessKey: o.secretAccessKey, service: "s3", region: o.region, retries: 2, initRetryMs: 100 });
  const base = new URL(o.endpoint);
  if (!o.pathStyle) base.hostname = `${o.bucket}.${base.hostname}`;
  const root = `${base.origin}${base.pathname.replace(/\/$/, "")}${o.pathStyle ? `/${o.bucket}` : ""}`;
  const at = (key: string): string => `${root}/${key.split("/").map(encodeURIComponent).join("/")}`;
  return {
    async put(key, bytes, contentType) {
      const res = await client.fetch(at(key), { method: "PUT", body: new Uint8Array(bytes), headers: { "Content-Type": contentType } });
      if (!res.ok) throw new Error(`the bucket refused a take: ${res.status}`);
    },
    async get(key) {
      const res = await client.fetch(at(key));
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`the bucket would not give a take: ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    },
  };
}

/** A store that forgets when the process ends: for tests. */
export function createMemoryStore(): TakeStore & { readonly objects: Map<string, { bytes: Buffer; contentType: string }> } {
  const objects = new Map<string, { bytes: Buffer; contentType: string }>();
  return {
    objects,
    put: async (key, bytes, contentType) => void objects.set(key, { bytes, contentType }),
    get: async (key) => objects.get(key)?.bytes ?? null,
  };
}
