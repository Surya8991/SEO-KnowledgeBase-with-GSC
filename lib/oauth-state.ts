/**
 * Signed-state helper for OAuth flows (audit S2, Session 6).
 *
 * The prior /api/gsc/callback accepted any ?code= with no state validation,
 * letting an attacker who could trick a victim into visiting a crafted URL
 * overwrite the org's stored GSC tokens with their own. Fix: mint a random
 * nonce at /api/gsc/authorize, store it (a) HMAC-signed in the redirect's
 * `state` param AND (b) in an HttpOnly cookie. The callback must see both;
 * constant-time compare the nonce; reject otherwise.
 *
 * Secret precedence: AUTH_SECRET → GOOGLE_CLIENT_SECRET. We refuse to mint
 * in production if neither is set so misconfig is loud, not silent.
 */
import crypto from "node:crypto";

export const OAUTH_STATE_COOKIE = "gsc_oauth_state";
export const OAUTH_STATE_MAX_AGE_SEC = 600; // 10 minutes — long enough for human, short enough for replay

function getSecret(): string {
  const s = process.env.AUTH_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  if (!s) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_SECRET (or GOOGLE_CLIENT_SECRET) must be set for OAuth state signing.");
    }
    return "dev-only-insecure-fallback";
  }
  return s;
}

function sign(nonce: string): string {
  return crypto.createHmac("sha256", getSecret()).update(nonce).digest("base64url");
}

export interface MintedState {
  /** Send as the OAuth `state` query param. */
  stateParam: string;
  /** Set as an HttpOnly cookie so the callback can re-derive. */
  cookieValue: string;
}

/** Mint a fresh state nonce + signed token for this flow. */
export function mintOauthState(): MintedState {
  const nonce = crypto.randomBytes(24).toString("base64url");
  const sig = sign(nonce);
  const token = `${nonce}.${sig}`;
  return { stateParam: token, cookieValue: token };
}

/**
 * Verify a state token returned by the OAuth provider against the cookie value.
 * Returns true iff (a) both are present, (b) HMAC signature is valid,
 * (c) the two values match in constant time.
 */
export function verifyOauthState(
  stateParam: string | null | undefined,
  cookieValue: string | null | undefined,
): boolean {
  if (!stateParam || !cookieValue) return false;
  if (stateParam.length !== cookieValue.length) return false;
  // Constant-time equality across the whole token.
  const a = Buffer.from(stateParam);
  const b = Buffer.from(cookieValue);
  if (a.length !== b.length) return false;
  if (!crypto.timingSafeEqual(a, b)) return false;
  // Re-derive signature from the nonce portion and compare.
  const [nonce, sig] = stateParam.split(".");
  if (!nonce || !sig) return false;
  const expected = sign(nonce);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}
