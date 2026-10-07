/**
 * FNV-1a over a canonical byte-ish stream. Used to fingerprint engine state so that the client
 * and the server can detect divergence cheaply. Not cryptographic; the server never trusts the
 * hash alone, it replays the full move log (ADR 0003).
 */

export class Hasher {
  private h = 0x811c9dc5;

  int(n: number): this {
    // Mix 32 bits of an integer (negative numbers and -0 are normalized).
    let v = (n | 0) >>> 0;
    for (let i = 0; i < 4; i++) {
      this.h ^= v & 0xff;
      this.h = Math.imul(this.h, 0x01000193) >>> 0;
      v >>>= 8;
    }
    return this;
  }

  str(s: string): this {
    this.int(s.length);
    for (let i = 0; i < s.length; i++) this.int(s.charCodeAt(i));
    return this;
  }

  digest(): string {
    return (this.h >>> 0).toString(16).padStart(8, "0");
  }
}
