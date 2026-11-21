import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DownloadRange } from "@/components/download-pdf";
import { subscribeTo, unsubscribe } from "@/app/actions/library";
import { buttonClass, SubtleButton } from "@/components/ui";
import { getDb } from "@/db";
import { subscriptions } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { getSeriesWithChapters } from "@/lib/library";
import { getSource } from "@/lib/sources";
import { ChapterList, CheckButton } from "./series-controls";

export default function SeriesPage({ params }: PageProps<"/series/[id]">) {
  return (
    <Suspense fallback={<p className="text-neutral-500">Loading…</p>}>
      <Series params={params} />
    </Suspense>
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function Series({ params }: { params: PageProps<"/series/[id]">["params"] }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const user = await requireUser();
  const db = await getDb();
  const s = await getSeriesWithChapters(db, user.id, id);
  if (!s) notFound();

  const [sub] = await db
    .select({ createdAt: subscriptions.createdAt })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, user.id), eq(subscriptions.seriesId, id)));

  // Continue after the furthest chapter you finished; otherwise resume a started one; otherwise start at the beginning.
  const lastDone = s.chapters.findLastIndex((c) => c.completed);
  const started = s.chapters.find((c) => !c.completed && (c.page ?? 0) > 0);
  const next = lastDone >= 0 ? s.chapters[lastDone + 1] : (started ?? s.chapters[0]);
  const readCount = s.chapters.filter((c) => c.completed).length;

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-5 sm:flex-row">
        <div className="aspect-[2/3] w-40 shrink-0 overflow-hidden rounded-md bg-neutral-200 dark:bg-neutral-800">
          {s.coverUrl && <img src={s.coverUrl} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />}
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <h1 className="text-2xl font-semibold">{s.title}</h1>
          <p className="text-sm text-neutral-500">
            {readCount}/{s.chapters.length} read ·{" "}
            <a href={s.url} target="_blank" rel="noreferrer" className="underline">
              on {getSource(s.source).name}
            </a>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {next ? (
              <Link href={`/read/${next.id}`} className={buttonClass}>
                {lastDone >= 0 || started ? "Continue" : "Start reading"}: {next.name}
              </Link>
            ) : (
              s.chapters.length > 0 && <span className="text-sm text-neutral-500">You&apos;re all caught up.</span>
            )}
            <form action={(s.subscribed ? unsubscribe : subscribeTo).bind(null, s.id)}>
              <SubtleButton type="submit">{s.subscribed ? "Unsubscribe" : "Subscribe"}</SubtleButton>
            </form>
          </div>
          <CheckButton seriesId={s.id} />
        </div>
      </section>
      <DownloadRange seriesTitle={s.title} chapters={s.chapters.map(({ id, name, number }) => ({ id, name, number }))} />
      <ChapterList chapters={s.chapters} subscribedAt={sub?.createdAt.toISOString() ?? null} />
    </div>
  );
}
