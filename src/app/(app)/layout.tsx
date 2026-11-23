import Link from "next/link";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth/session";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <nav className="mx-auto flex w-full max-w-5xl items-center gap-6 px-4 py-3">
          <Link href="/" className="font-semibold tracking-tight">
            Alexandria
          </Link>
          <Link href="/" className="text-sm text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100">
            Library
          </Link>
          <Link href="/search" className="text-sm text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100">
            Search
          </Link>
          <div className="ml-auto">
            <Suspense fallback={null}>
              <UserLink />
            </Suspense>
          </div>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
    </>
  );
}

async function UserLink() {
  const user = await getCurrentUser();
  if (!user) return null;
  return (
    <div className="flex items-center gap-4">
      {user.isAdmin && (
        <Link href="/admin" className="text-sm text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100">
          Admin
        </Link>
      )}
      <Link href="/profile" className="text-sm font-medium">
        {user.username}
      </Link>
    </div>
  );
}
