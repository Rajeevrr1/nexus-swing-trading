import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

/** Encrypts a JSON-serializable payload into a compact URL-safe AES-256-GCM cookie value. */
export function sealSession(payload: unknown, secret: string): string {
  const key = deriveKey(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

/** Decrypts and authenticates an AES-256-GCM cookie value; returns null if tampered or invalid. */
export function unsealSession<T>(token: string, secret: string): T | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [ivB64, tagB64, dataB64] = parts;
    const iv = Buffer.from(ivB64, "base64url");
    const tag = Buffer.from(tagB64, "base64url");
    const data = Buffer.from(dataB64, "base64url");
    if (iv.length !== 12 || tag.length !== 16) return null;
    const key = deriveKey(secret);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    return JSON.parse(decrypted) as T;
  } catch {
    return null;
  }
}

/** Deterministic HMAC token for desk PIN cookie verification. */
export function signDeskToken(password: string, secret: string): string {
  return createHmac("sha256", deriveKey(secret)).update(`nexus-desk:${password}`).digest("base64url");
}

/** Timing-safe comparison for PIN / HMAC verification. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = createHash("sha256").update(a).digest();
  const bufB = createHash("sha256").update(b).digest();
  return timingSafeEqual(bufA, bufB);
}
