/**
 * AES-256-GCM encryption for secrets stored at rest (audit M2, Session 11).
 *
 * GSC OAuth access/refresh tokens were persisted to `gsc_connections` in
 * plaintext — a read-only leak of that one table (or the shared prod DB) hands
 * an attacker a long-lived Search Console refresh token. These helpers encrypt
 * before insert and decrypt after read.
 *
 * Key: derived (SHA-256) from GSC_TOKEN_KEY, falling back to AUTH_SECRET.
 * Format: "enc:v1:" + base64(iv[12] || authTag[16] || ciphertext).
 *
 * Backward-compatible: a stored value WITHOUT the "enc:v1:" prefix is treated
 * as legacy plaintext and returned as-is, so existing rows keep working. When
 * no key is configured, encryptToken is a no-op passthrough (dev) — set a key
 * in any environment that stores real tokens.
 */
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

const PREFIX = "enc:v1:";
const IV_LEN = 12;
const TAG_LEN = 16;

function key(): Buffer | null {
  const secret = process.env.GSC_TOKEN_KEY || process.env.AUTH_SECRET;
  if (!secret) return null;
  return createHash("sha256").update(secret).digest(); // 32 bytes
}

/** True when a value is in our encrypted envelope format. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function encryptToken(plain: string | null | undefined): string | null {
  if (plain == null) return null;
  const k = key();
  if (!k) return plain; // no key configured → store as-is (dev only)
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decryptToken(stored: string | null | undefined): string | null {
  if (stored == null) return null;
  if (!isEncrypted(stored)) return stored; // legacy plaintext row
  const k = key();
  if (!k) {
    throw new Error(
      "A stored token is encrypted but neither GSC_TOKEN_KEY nor AUTH_SECRET is set to decrypt it.",
    );
  }
  const buf = Buffer.from(stored.slice(PREFIX.length), "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", k, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
