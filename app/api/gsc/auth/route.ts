import { NextResponse } from "next/server";
import { getAuthUrl } from "@/lib/gsc";
import {
  mintOauthState,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_MAX_AGE_SEC,
} from "@/lib/oauth-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Audit S2 (Session 6): mint a one-time signed state nonce, drop it in an
 * HttpOnly cookie, and hand the same value to Google's OAuth `state` param.
 * The callback rejects when either is missing or they don't match.
 */
export async function GET() {
  try {
    const state = mintOauthState();
    const res = NextResponse.redirect(getAuthUrl(state.stateParam));
    res.cookies.set({
      name: OAUTH_STATE_COOKIE,
      value: state.cookieValue,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/gsc",
      maxAge: OAUTH_STATE_MAX_AGE_SEC,
    });
    return res;
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
