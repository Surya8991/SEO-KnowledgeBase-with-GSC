import { NextRequest, NextResponse } from "next/server";
import { getOAuthClient, saveTokens } from "@/lib/gsc";
import { log } from "@/lib/logger";
import {
  verifyOauthState,
  OAUTH_STATE_COOKIE,
} from "@/lib/oauth-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Audit S2 (Session 6): the prior implementation accepted any ?code= with
 * no state/PKCE validation, letting anyone overwrite the org's GSC tokens
 * with their own by tricking a victim into visiting a crafted callback URL.
 * Now requires the state nonce minted at /api/gsc/auth to match the
 * HttpOnly cookie before redeeming the code.
 */
export async function GET(request: NextRequest) {
  const base = process.env.APP_BASE_URL || request.nextUrl.origin;
  const code = request.nextUrl.searchParams.get("code");
  const stateParam = request.nextUrl.searchParams.get("state");
  const cookieValue = request.cookies.get(OAUTH_STATE_COOKIE)?.value ?? null;

  // Clear the cookie immediately — single-use, regardless of outcome.
  const clearCookie = (res: NextResponse) => {
    res.cookies.set({
      name: OAUTH_STATE_COOKIE,
      value: "",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/gsc",
      maxAge: 0,
    });
    return res;
  };

  if (!code) {
    return clearCookie(NextResponse.redirect(`${base}/search-console?gsc=error&reason=missing-code`));
  }
  if (!verifyOauthState(stateParam, cookieValue)) {
    log.warn("gsc callback rejected: state mismatch", {
      hasState: !!stateParam,
      hasCookie: !!cookieValue,
    });
    return clearCookie(NextResponse.redirect(`${base}/search-console?gsc=error&reason=state-mismatch`));
  }
  try {
    const client = getOAuthClient();
    const { tokens } = await client.getToken(code);
    await saveTokens(tokens);
    return clearCookie(NextResponse.redirect(`${base}/search-console?gsc=connected`));
  } catch (e) {
    log.error("gsc callback failed", { error: (e as Error).message });
    return clearCookie(NextResponse.redirect(`${base}/search-console?gsc=error&reason=exchange-failed`));
  }
}
