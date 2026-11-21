import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/session";
import { getReaderChapter, type ReaderChapter } from "@/lib/library";
import { getSeriesReaderSettings } from "@/lib/settings";
import { SourceError } from "@/lib/sources";
import { Reader } from "./reader";

export const metadata: Metadata = { title: "Reading" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function ReadPage({ params }: PageProps<"/read/[chapterId]">) {
  return (
    <Suspense fallback={<div className="flex min-h-dvh items-center justify-center bg-neutral-950 text-neutral-400">Loading chapter…</div>}>
      <ReadChapter params={params} />
    </Suspense>
  );
}

async function ReadChapter({ params }: { params: PageProps<"/read/[chapterId]">["params"] }) {
  const { chapterId } = await params;
  if (!UUID.test(chapterId)) notFound();
  const user = await requireUser();
  const db = await getDb();

  let chapter: ReaderChapter | null;
  try {
    chapter = await getReaderChapter(db, user.id, chapterId);
  } catch (err) {
    if (!(err instanceof SourceError)) throw err;
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-neutral-950 p-6 text-center text-neutral-200">
        <p>Couldn&apos;t load this chapter&apos;s pages: {err.message}</p>
        <Link href={`/read/${chapterId}`} className="underline">
          Try again
        </Link>
      </div>
    );
  }
  if (!chapter) notFound();
  const { settings, customized } = await getSeriesReaderSettings(db, user.id, chapter.seriesId);
  // key: a fresh reader (page 1, closed panels) for every chapter.
  return <Reader key={chapter.id} chapter={chapter} initialSettings={settings} initialCustomized={customized} />;
}
