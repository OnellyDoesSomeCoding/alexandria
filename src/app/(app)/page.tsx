import { Suspense } from "react";
import { SeriesCard } from "@/components/series-card";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/session";
import { getLibrary } from "@/lib/library";
import { SearchForm } from "./search/search-form";
import { SubscribeForm } from "./subscribe-form";

export default function LibraryPage() {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">Your library</h1>
        <p className="text-sm text-neutral-500">Search WeebCentral by title, or paste a series link to subscribe.</p>
        <SearchForm />
        <SubscribeForm />
      </section>
      <Suspense fallback={<p className="text-neutral-500">Loading your library…</p>}>
        <Library />
      </Suspense>
    </div>
  );
}

async function Library() {
  const user = await requireUser();
  const entries = await getLibrary(await getDb(), user.id);
  if (entries.length === 0) {
    return <p className="text-neutral-500">Nothing here yet. Subscribe to a series above and it will show up here.</p>;
  }
  const reading = entries.filter((e) => e.lastReadAt);
  const notStarted = entries.filter((e) => !e.lastReadAt);
  return (
    <>
      {reading.length > 0 && <Shelf title="Continue reading" entries={reading} />}
      {notStarted.length > 0 && <Shelf title={reading.length > 0 ? "Not started" : "Subscribed"} entries={notStarted} />}
    </>
  );
}

function Shelf({ title, entries }: { title: string; entries: Awaited<ReturnType<typeof getLibrary>> }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-semibold">{title}</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
        {entries.map((e) => {
          const unread = e.chapterCount - e.readCount;
          return (
            <SeriesCard
              key={e.id}
              href={`/series/${e.id}`}
              title={e.title}
              coverUrl={e.coverUrl}
              badge={e.lastReadAt && unread > 0 ? `${unread} unread` : undefined}
              lines={[
                e.lastReadAt ? `${e.readCount}/${e.chapterCount} read` : `${e.chapterCount} chapters`,
                e.latestChapter ? `Latest: ${e.latestChapter}` : "",
              ].filter(Boolean)}
            />
          );
        })}
      </div>
    </section>
  );
}
