/**
 * Series, chapters, subscriptions and reading progress. Series and chapters are shared by everyone: a series
 * is scraped once, no matter how many people subscribe. Every function takes the database first so it can be
 * tested against an in-memory Postgres.
 */
import { and, asc, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { chapters, readingProgress, series, subscriptions } from "@/db/schema";
import { getSource, resolveLink, type Source } from "@/lib/sources";

/** Don't re-scrape a series more often than this when someone presses "Check for new chapters". */
export const MIN_CHECK_INTERVAL_MS = 60 * 1000;

export class LibraryError extends Error {}

// ---------- subscribing & syncing ----------

/** Insert new chapters and refresh names/order of known ones. Returns how many were new. */
async function storeChapters(db: DB, seriesId: string, source: Source, sourceSeriesId: string): Promise<number> {
  const found = await source.getChapters(sourceSeriesId);
  const known = await db.select({ sourceId: chapters.sourceId }).from(chapters).where(eq(chapters.seriesId, seriesId));
  const knownIds = new Set(known.map((c) => c.sourceId));
  const rows = found.map((c, position) => ({ seriesId, sourceId: c.sourceId, name: c.name, number: c.number, position }));

  // Batches keep each statement well under Postgres' parameter limit, even for 1000+ chapter series.
  for (let i = 0; i < rows.length; i += 500) {
    await db
      .insert(chapters)
      .values(rows.slice(i, i + 500))
      .onConflictDoUpdate({
        target: [chapters.seriesId, chapters.sourceId],
        set: { name: sql`excluded.name`, number: sql`excluded.number`, position: sql`excluded.position` },
      });
  }
  await db.update(series).set({ lastCheckedAt: sql`now()` }).where(eq(series.id, seriesId));
  return rows.filter((r) => !knownIds.has(r.sourceId)).length;
}

/** Subscribe a user to the series behind a pasted link, scraping it first if nobody has added it yet. */
export async function subscribeByLink(db: DB, userId: string, link: string): Promise<{ seriesId: string; isNew: boolean }> {
  const { source, seriesId: sourceSeriesId } = resolveLink(link);
  let [existing] = await db
    .select({ id: series.id })
    .from(series)
    .where(and(eq(series.source, source.key), eq(series.sourceId, sourceSeriesId)));

  const isNew = !existing;
  if (!existing) {
    const info = await source.getSeries(sourceSeriesId);
    [existing] = await db
      .insert(series)
      .values({ source: source.key, sourceId: info.sourceId, title: info.title, url: info.url, coverUrl: info.coverUrl })
      .onConflictDoUpdate({ target: [series.source, series.sourceId], set: { title: info.title } }) // someone added it at the same moment
      .returning({ id: series.id });
    try {
      await storeChapters(db, existing.id, source, sourceSeriesId);
    } catch (err) {
      await db.delete(series).where(eq(series.id, existing.id)); // don't leave a series with no chapters behind
      throw err;
    }
  }
  await db.insert(subscriptions).values({ userId, seriesId: existing.id }).onConflictDoNothing();
  return { seriesId: existing.id, isNew };
}

export async function unsubscribe(db: DB, userId: string, seriesId: string): Promise<void> {
  await db.delete(subscriptions).where(and(eq(subscriptions.userId, userId), eq(subscriptions.seriesId, seriesId)));
}

/**
 * Re-scrape a series' chapter list. With `force` false (the button), a series checked within the last minute
 * is skipped. Returns the number of new chapters, or null if skipped.
 */
export async function checkForNewChapters(db: DB, seriesId: string, { force = false } = {}): Promise<number | null> {
  const [row] = await db
    .select({
      source: series.source,
      sourceId: series.sourceId,
      recent: sql<boolean>`coalesce(${series.lastCheckedAt} > now() - make_interval(secs => ${MIN_CHECK_INTERVAL_MS / 1000}), false)`,
    })
    .from(series)
    .where(eq(series.id, seriesId));
  if (!row) throw new LibraryError("That series doesn't exist.");
  if (row.recent && !force) return null;
  return storeChapters(db, seriesId, getSource(row.source), row.sourceId);
}

/** Every series at least one person subscribes to, least recently checked first (for the daily cron). */
export async function subscribedSeriesIds(db: DB): Promise<string[]> {
  const rows = await db
    .selectDistinct({ id: series.id, lastCheckedAt: series.lastCheckedAt })
    .from(series)
    .innerJoin(subscriptions, eq(subscriptions.seriesId, series.id))
    .orderBy(sql`${series.lastCheckedAt} asc nulls first`);
  return rows.map((r) => r.id);
}

// ---------- reading lists ----------

export interface LibraryEntry {
  id: string;
  title: string;
  coverUrl: string | null;
  chapterCount: number;
  readCount: number;
  latestChapter: string | null;
  /** The chapter to open with "Continue": first unread after the last one touched, or the first chapter. */
  continueChapterId: string | null;
  continueChapterName: string | null;
  lastReadAt: Date | null;
  newSinceSubscribed: number;
}

/** A user's subscribed series with progress, most recently read first. */
export async function getLibrary(db: DB, userId: string): Promise<LibraryEntry[]> {
  const result = await db.execute(sql`
    select
      s.id, s.title, s.cover_url as "coverUrl",
      (select count(*)::int from chapters c where c.series_id = s.id) as "chapterCount",
      (select count(*)::int from chapters c join reading_progress p on p.chapter_id = c.id
         where c.series_id = s.id and p.user_id = ${userId} and p.completed) as "readCount",
      (select c.name from chapters c where c.series_id = s.id order by c.position desc limit 1) as "latestChapter",
      (select max(p.updated_at) from reading_progress p join chapters c on c.id = p.chapter_id
         where c.series_id = s.id and p.user_id = ${userId}) as "lastReadAt",
      (select count(*)::int from chapters c where c.series_id = s.id and c.created_at > sub.created_at) as "newSinceSubscribed",
      cont.id as "continueChapterId", cont.name as "continueChapterName"
    from subscriptions sub
    join series s on s.id = sub.series_id
    left join lateral (
      with last_touched as (
        select c.position, p.completed from reading_progress p join chapters c on c.id = p.chapter_id
        where c.series_id = s.id and p.user_id = ${userId}
        order by p.updated_at desc limit 1
      )
      select c.id, c.name from chapters c
      where c.series_id = s.id and c.position >= coalesce(
        (select case when completed then position + 1 else position end from last_touched), 0)
      order by c.position asc limit 1
    ) cont on true
    where sub.user_id = ${userId}
    order by "lastReadAt" desc nulls last, sub.created_at desc
  `);
  return (result as unknown as { rows: LibraryEntry[] }).rows.map((r) => ({
    ...r,
    lastReadAt: r.lastReadAt ? new Date(r.lastReadAt) : null,
  }));
}

export interface ChapterRow {
  id: string;
  name: string;
  number: number | null;
  position: number;
  createdAt: Date;
  completed: boolean;
  page: number | null;
}

export async function getSeriesWithChapters(db: DB, userId: string, seriesId: string) {
  const [info] = await db
    .select({
      id: series.id,
      title: series.title,
      url: series.url,
      coverUrl: series.coverUrl,
      source: series.source,
      lastCheckedAt: series.lastCheckedAt,
      subscribed: sql<boolean>`exists(select 1 from ${subscriptions} where ${subscriptions.seriesId} = ${series.id} and ${subscriptions.userId} = ${userId})`,
    })
    .from(series)
    .where(eq(series.id, seriesId));
  if (!info) return null;
  const list: ChapterRow[] = await db
    .select({
      id: chapters.id,
      name: chapters.name,
      number: chapters.number,
      position: chapters.position,
      createdAt: chapters.createdAt,
      completed: sql<boolean>`coalesce(${readingProgress.completed}, false)`,
      page: readingProgress.page,
    })
    .from(chapters)
    .leftJoin(readingProgress, and(eq(readingProgress.chapterId, chapters.id), eq(readingProgress.userId, userId)))
    .where(eq(chapters.seriesId, seriesId))
    .orderBy(asc(chapters.position));
  return { ...info, chapters: list };
}

// ---------- progress ----------

export async function saveProgress(db: DB, userId: string, chapterId: string, page: number, completed: boolean): Promise<void> {
  await db
    .insert(readingProgress)
    .values({ userId, chapterId, page, completed })
    .onConflictDoUpdate({
      target: [readingProgress.userId, readingProgress.chapterId],
      // Once finished, re-opening a chapter doesn't mark it unread again.
      set: { page, completed: sql`${readingProgress.completed} or excluded.completed`, updatedAt: sql`now()` },
    });
}

/** Mark one chapter read or unread from the chapter list. */
export async function setChapterRead(db: DB, userId: string, chapterId: string, completed: boolean): Promise<void> {
  await db
    .insert(readingProgress)
    .values({ userId, chapterId, completed })
    .onConflictDoUpdate({ target: [readingProgress.userId, readingProgress.chapterId], set: { completed, updatedAt: sql`now()` } });
}

/** Mark every chapter before (and including) this one as read. */
export async function markReadUpTo(db: DB, userId: string, chapterId: string): Promise<void> {
  const [target] = await db.select({ seriesId: chapters.seriesId, position: chapters.position }).from(chapters).where(eq(chapters.id, chapterId));
  if (!target) return;
  const ids = await db
    .select({ id: chapters.id })
    .from(chapters)
    .where(and(eq(chapters.seriesId, target.seriesId), lt(chapters.position, target.position + 1)));
  for (let i = 0; i < ids.length; i += 500) {
    await db
      .insert(readingProgress)
      .values(ids.slice(i, i + 500).map((c) => ({ userId, chapterId: c.id, completed: true })))
      .onConflictDoUpdate({ target: [readingProgress.userId, readingProgress.chapterId], set: { completed: true } });
  }
}

/** Mark this chapter and every later one as unread (undo for "read up to here"). */
export async function markUnreadFrom(db: DB, userId: string, chapterId: string): Promise<void> {
  const [target] = await db.select({ seriesId: chapters.seriesId, position: chapters.position }).from(chapters).where(eq(chapters.id, chapterId));
  if (!target) return;
  await db.execute(sql`
    update reading_progress p set completed = false, updated_at = now()
    from chapters c
    where c.id = p.chapter_id and p.user_id = ${userId} and c.series_id = ${target.seriesId} and c.position >= ${target.position}
  `);
}

// ---------- reader ----------

export interface ReaderChapter {
  id: string;
  name: string;
  number: number | null;
  seriesId: string;
  seriesTitle: string;
  pages: string[];
  prevId: string | null;
  nextId: string | null;
  savedPage: number;
}

/** Everything the reader needs. Page URLs are scraped the first time anyone opens the chapter, then reused. */
export async function getReaderChapter(db: DB, userId: string, chapterId: string): Promise<ReaderChapter | null> {
  const [row] = await db
    .select({
      id: chapters.id,
      name: chapters.name,
      number: chapters.number,
      sourceId: chapters.sourceId,
      position: chapters.position,
      pageUrls: chapters.pageUrls,
      seriesId: series.id,
      seriesTitle: series.title,
      source: series.source,
    })
    .from(chapters)
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .where(eq(chapters.id, chapterId));
  if (!row) return null;
  const pages = await ensurePageUrls(db, row);

  const [prev] = await db
    .select({ id: chapters.id })
    .from(chapters)
    .where(and(eq(chapters.seriesId, row.seriesId), lt(chapters.position, row.position)))
    .orderBy(desc(chapters.position))
    .limit(1);
  const [next] = await db
    .select({ id: chapters.id })
    .from(chapters)
    .where(and(eq(chapters.seriesId, row.seriesId), gt(chapters.position, row.position)))
    .orderBy(asc(chapters.position))
    .limit(1);
  const [progress] = await db
    .select({ page: readingProgress.page, completed: readingProgress.completed })
    .from(readingProgress)
    .where(and(eq(readingProgress.userId, userId), eq(readingProgress.chapterId, chapterId)));

  return {
    id: row.id,
    name: row.name,
    number: row.number,
    seriesId: row.seriesId,
    seriesTitle: row.seriesTitle,
    pages,
    prevId: prev?.id ?? null,
    nextId: next?.id ?? null,
    // Finished chapters reopen at the start; unfinished ones where you left off.
    savedPage: progress && !progress.completed ? Math.min(progress.page, pages.length - 1) : 0,
  };
}

/** Stored page URLs, scraping and storing them first if nobody has opened the chapter yet. */
async function ensurePageUrls(
  db: DB,
  row: { id: string; sourceId: string; source: string; pageUrls: string[] | null },
): Promise<string[]> {
  if (row.pageUrls && row.pageUrls.length > 0) return row.pageUrls;
  const pages = await getSource(row.source).getPageUrls(row.sourceId);
  await db.update(chapters).set({ pageUrls: pages }).where(eq(chapters.id, row.id));
  return pages;
}

/** A chapter's name and page URLs, for downloads. Null if the chapter doesn't exist. */
export async function getChapterPages(db: DB, chapterId: string): Promise<{ name: string; seriesTitle: string; pages: string[] } | null> {
  const [row] = await db
    .select({
      id: chapters.id,
      name: chapters.name,
      sourceId: chapters.sourceId,
      pageUrls: chapters.pageUrls,
      source: series.source,
      seriesTitle: series.title,
    })
    .from(chapters)
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .where(eq(chapters.id, chapterId));
  if (!row) return null;
  return { name: row.name, seriesTitle: row.seriesTitle, pages: await ensurePageUrls(db, row) };
}

/** Page URL for the PDF download proxy: only URLs we scraped ourselves, so the proxy can't fetch arbitrary sites. */
export async function getPageUrl(db: DB, chapterId: string, index: number): Promise<string | null> {
  const [row] = await db.select({ pageUrls: chapters.pageUrls }).from(chapters).where(eq(chapters.id, chapterId));
  return row?.pageUrls?.[index] ?? null;
}

/** Map of seriesId -> subscribed, for a set of series (used on friends' pages). */
export async function subscribedAmong(db: DB, userId: string, seriesIds: string[]): Promise<Set<string>> {
  if (seriesIds.length === 0) return new Set();
  const rows = await db
    .select({ id: subscriptions.seriesId })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), inArray(subscriptions.seriesId, seriesIds)));
  return new Set(rows.map((r) => r.id));
}
