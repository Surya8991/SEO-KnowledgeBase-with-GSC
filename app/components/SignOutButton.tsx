import { signOut } from "@/auth";

/**
 * Sign-out button — server component using the NextAuth v5 `signOut()`
 * server action. The previous implementation posted a plain form to
 * /api/auth/signout, which returns 200 OK but doesn't reliably clear the
 * session cookie in v5 (it expects a CSRF token + callbackUrl form
 * fields, or this server-action path).
 *
 * Passed into the client Sidebar as a slot so the sidebar can stay
 * "use client" (it needs usePathname for active-route highlighting).
 */
export default function SignOutButton() {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/signin" });
      }}
    >
      <button
        type="submit"
        className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700"
      >
        Sign out
      </button>
    </form>
  );
}
