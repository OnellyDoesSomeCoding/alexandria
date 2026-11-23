import Link from "next/link";
import { Suspense } from "react";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/session";
import { librarySeriesBySourceId } from "@/lib/library";
import { MIN_QUERY_LENGTH, normalizeQuery, type SearchResult, searchSources } from "@/lib/sources";
import { ErrorText } from "@/components/ui";
import { SearchForm } from "./search-form";
import { SubscribeButton } from "./subscribe-button";

export default function SearchPage({ searchParams }: PageProps<"/search">) {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Search</h1>
      <Suspense fallback={<SearchForm />}>
        <SearchContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function SearchContent({ searchParams }: { searchParams: PageProps<"/search">["searchParams"] }) {
  const { q } = await searchParams;
  const query = normalizeQuery(typeof q === "string" ? q : "");
  return (
    <>
      <SearchForm key={`form:${query}`} defaultValue={query} />
      {query.length >= MIN_QUERY_LENGTH ? (
        <Suspense key={`results:${query}`} fallback={<p className="text-neutral-500">Searching…</p>}>
          <Results query={query} />
        </Suspense>
      ) : (
        query && <p className="text-neutral-500">Type at least {MIN_QUERY_LENGTH} characters.</p>
      )}
    </>
  );
}

async function Results({ query }: { query: string }) {
  const user = await requireUser();
  const [searches, db] = await Promise.all([searchSources(query), getDb()]);
  return (
    <>
      {await Promise.all(
        searches.map(async (s) => {
          const inLibrary = await librarySeriesBySourceId(db, user.id, s.sourceKey, s.results.map((r) => r.sourceId));
          return (
            <section key={s.sourceKey} className="flex flex-col gap-3">
              <h2 className="font-semibold">
                {s.sourceName}
                {!s.error && <span className="ml-2 text-sm font-normal text-neutral-500">{s.results.length} found</span>}
              </h2>
              <ErrorText>{s.error}</ErrorText>
              {!s.error && s.results.length === 0 && <p className="text-neutral-500">Nothing matched “{query}”.</p>}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
                {s.results.map((r) => (
                  <ResultCard key={r.sourceId} result={r} seriesId={inLibrary.get(r.sourceId)} />
                ))}
              </div>
            </section>
          );
        }),
      )}
    </>
  );
}

/** Already subscribed: links to our series page. Otherwise: the cover opens the site's page, and a button subscribes. */
function ResultCard({ result: r, seriesId }: { result: SearchResult; seriesId?: string }) {
  const cover = (
    <div className="relative aspect-[2/3] overflow-hidden rounded-md bg-neutral-200 dark:bg-neutral-800">
      {r.coverUrl ? (
        <img src={r.coverUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover transition group-hover:scale-[1.02]" />
      ) : (
        <span className="flex h-full items-center justify-center p-2 text-center text-sm text-neutral-500">{r.title}</span>
      )}
      {seriesId && <span className="absolute right-1.5 top-1.5 rounded bg-neutral-900/85 px-1.5 py-0.5 text-xs font-medium text-white">In library</span>}
    </div>
  );
  return (
    <div className="flex flex-col gap-2">
      {seriesId ? (
        <Link href={`/series/${seriesId}`} className="group">
          {cover}
        </Link>
      ) : (
        <a href={r.url} target="_blank" rel="noreferrer" className="group" title="Open on the site">
          {cover}
        </a>
      )}
      <div className="min-w-0">
        <p className="line-clamp-2 text-sm font-medium leading-snug">{r.title}</p>
        {r.details.length > 0 && <p className="truncate text-xs text-neutral-500">{r.details.join(" · ")}</p>}
      </div>
      {!seriesId && (
        <div className="mt-auto">
          <SubscribeButton link={r.url} />
        </div>
      )}
    </div>
  );
}
