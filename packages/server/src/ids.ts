import { randomBytes, randomUUID } from 'node:crypto';

export function uid(prefix = ''): string {
  return prefix + randomUUID().replace(/-/g, '').slice(0, 12);
}

export function token(): string {
  return randomBytes(24).toString('base64url');
}
