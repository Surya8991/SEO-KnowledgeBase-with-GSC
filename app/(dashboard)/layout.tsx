import Sidebar from "@/app/components/Sidebar";
import HelpButton from "@/app/components/HelpButton";
import SignOutButton from "@/app/components/SignOutButton";
import { ToastViewport } from "@/app/components/Toast";
import ProjectLogLink from "@/app/components/ProjectLogLink";
import { auth, isAuthEnabled } from "@/auth";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Pull the session server-side when auth is on so the sidebar can render
  // the user badge + sign-out without a client-side round trip. SignOut is
  // a server-component slot because the underlying `signOut()` server action
  // can't run inside the "use client" Sidebar.
  let user: { name?: string | null; email?: string | null; image?: string | null } | null = null;
  if (isAuthEnabled()) {
    const session = await auth().catch(() => null);
    user = session?.user ?? null;
  }
  return (
    <div className="flex min-h-screen">
      <Sidebar user={user} signOutSlot={user ? <SignOutButton /> : null} />
      {/* Top padding on small screens so the floating burger button doesn't
          overlap the PageHeader. Sidebar is in-flow on >= lg, drawer below. */}
      <main className="flex-1 min-w-0 pt-12 lg:pt-0">{children}</main>
      <ProjectLogLink />
      <HelpButton />
      <ToastViewport />
    </div>
  );
}
