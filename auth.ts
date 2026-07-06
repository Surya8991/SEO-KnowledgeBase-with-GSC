/**
 * NextAuth v5 (Auth.js) — Google SSO restricted to @edstellar.com.
 *
 * Wired to be opt-in via `AUTH_ENABLED=true`. When the flag is unset or
 * "false", every helper here is exported but `isAuthEnabled()` returns
 * false and middleware short-circuits, so the dashboard keeps working
 * exactly as it did before this lands. Flip the flag once the Google
 * OAuth consent screen is published.
 *
 * Required env when AUTH_ENABLED=true:
 *   - AUTH_SECRET        — random string (openssl rand -hex 32)
 *   - GOOGLE_CLIENT_ID   — reused from the GSC OAuth client (or a new one)
 *   - GOOGLE_CLIENT_SECRET
 *
 * In Google Cloud Console, ADD this redirect URI alongside the GSC one:
 *   https://<prod-host>/api/auth/callback/google
 *
 * Optional env:
 *   - AUTH_ALLOWED_DOMAINS — comma-separated. Defaults to "edstellar.com".
 *     Email addresses outside the list bounce at the signIn callback.
 *   - AUTH_TRUST_HOST=true — recommended on Vercel (auto-detected when
 *     deployed there but harmless to set explicitly).
 */
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export function isAuthEnabled(): boolean {
  const v = (process.env.AUTH_ENABLED ?? "").toString().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

function allowedDomains(): string[] {
  return (process.env.AUTH_ALLOWED_DOMAINS ?? "edstellar.com")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

export const { auth, handlers, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  pages: {
    signIn: "/signin",
    error: "/signin",
  },
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 12,
  },
  // Audit H4 (Session 6): hardcoded `trustHost: true` let host-header
  // injection attacks spoof the auth callback URL outside Vercel's edge.
  // Auto-enable only inside Vercel (where the edge is the trusted hop),
  // otherwise require an explicit AUTH_TRUST_HOST=true opt-in.
  trustHost:
    !!process.env.VERCEL ||
    process.env.AUTH_TRUST_HOST === "true",
  callbacks: {
    /** Reject sign-ins outside the allow-listed email domains. */
    async signIn({ profile }) {
      const email = (profile?.email ?? "").toLowerCase();
      if (!email) return false;
      const domains = allowedDomains();
      return domains.some((d) => email.endsWith("@" + d));
    },
    /** Persist the email + name onto the JWT so middleware can read them
     *  without a DB round-trip. */
    async jwt({ token, user }) {
      if (user) {
        token.email = user.email ?? token.email;
        token.name = user.name ?? token.name;
        token.picture = (user as { image?: string }).image ?? token.picture;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.email = (token.email as string) ?? session.user.email;
        session.user.name = (token.name as string) ?? session.user.name;
        session.user.image = (token.picture as string) ?? session.user.image;
      }
      return session;
    },
  },
});
