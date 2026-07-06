import { redirect } from "next/navigation";
import { signIn, auth } from "@/auth";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ returnTo?: string; error?: string }>;
}

/**
 * Sign-in page. Server component — submits a form action that calls
 * NextAuth's signIn server function. Restricted to the Edstellar Google
 * Workspace (or whatever AUTH_ALLOWED_DOMAINS is set to).
 */
export default async function SignInPage({ searchParams }: PageProps) {
  const { returnTo = "/", error } = await searchParams;
  // Already signed in? Bounce straight to the destination.
  const session = await auth().catch(() => null);
  if (session?.user) redirect(returnTo);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        {/* Brand row — same circle-mark + wordmark + subtitle pattern as the
            sidebar header so the two surfaces read as one app. Centered for
            the sign-in context. */}
        <div className="mb-8 flex items-center justify-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/mark.svg"
            alt=""
            aria-hidden="true"
            className="h-10 w-10"
          />
          <div>
            <div className="text-base font-semibold tracking-tight text-slate-900">
              Edstellar
            </div>
            <div className="text-xs text-slate-500">Content Intelligence</div>
          </div>
        </div>

        <h1 className="text-center text-xl font-semibold text-slate-900">Sign in</h1>
        <p className="mt-1 text-center text-sm text-slate-500">
          Use your Edstellar Google account. Other accounts are blocked.
        </p>

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error === "AccessDenied"
              ? "That Google account isn't on the allow-list. Sign in with your Edstellar email."
              : "Sign-in failed. Try again, or contact an admin if it persists."}
          </div>
        )}

        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: returnTo });
          }}
          className="mt-6"
        >
          <button
            type="submit"
            className="inline-flex w-full items-center justify-center gap-3 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
          >
            {/* Google G — official multi-color logo. Each quadrant is one path. */}
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path fill="#4285F4" d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
              <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
              <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
              <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
            </svg>
            Continue with Google
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-400">
          By signing in you agree to the team's internal-tool acceptable use policy.
        </p>
      </div>
    </div>
  );
}
