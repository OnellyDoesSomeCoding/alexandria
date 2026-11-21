import { Suspense } from "react";
import { requireUser } from "@/lib/auth/session";

export default function LibraryPage() {
  return (
    <Suspense fallback={<p className="text-neutral-500">Loading your library…</p>}>
      <Library />
    </Suspense>
  );
}

async function Library() {
  const user = await requireUser();
  return (
    <section className="flex flex-col gap-2">
      <h1 className="text-xl font-semibold">Your library</h1>
      <p className="text-neutral-500">
        Welcome, {user.username}. Nothing here yet. Subscribing to a series by link is the next thing being built.
      </p>
    </section>
  );
}
