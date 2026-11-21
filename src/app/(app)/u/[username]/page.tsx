import { sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SeriesCard } from "@/components/series-card";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { areFriends } from "@/lib/auth/accounts";
import { requireUser } from "@/lib/auth/session";
import { getLibrary, subscribedAmong } from "@/lib/library";

export default function FriendPage({ params }: PageProps<"/u/[username]">) {
  return (
    <Suspense fallback={<p className="text-neutral-500">Loading…</p>}>
      <FriendLibrary params={params} />
    </Suspense>
  );
}

async function FriendLibrary({ params }: { params: PageProps<"/u/[username]">["params"] }) {
  const { username } = await params;
  const me = await requireUser();
  const db = await getDb();
  const [them] = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(sql`lower(${users.username}) = ${decodeURIComponent(username).toLowerCase()}`);
  // Only friends (or yourself) can see a reading list; everyone else gets a plain 404.
  if (!them || (them.id !== me.id && !(await areFriends(db, me.id, them.id)))) notFound();

  const entries = await getLibrary(db, them.id);
  const mine = await subscribedAmong(db, me.id, entries.map((e) => e.id));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">{them.username}&apos;s reading list</h1>
      {entries.length === 0 ? (
        <p className="text-neutral-500">{them.username} hasn&apos;t subscribed to anything yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
          {entries.map((e) => (
            <SeriesCard
              key={e.id}
              href={`/series/${e.id}`}
              title={e.title}
              coverUrl={e.coverUrl}
              badge={mine.has(e.id) ? "In your library" : undefined}
              lines={[e.lastReadAt ? `Read ${e.readCount}/${e.chapterCount}` : "Not started", e.lastReadAt && e.continueChapterName ? `Up next: ${e.continueChapterName}` : ""].filter(Boolean)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
