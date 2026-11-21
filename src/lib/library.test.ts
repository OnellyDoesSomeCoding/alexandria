import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DB } from "@/db";
import { series as seriesTable } from "@/db/schema";
import { testDb } from "@/test/db";
import { createAccount } from "./auth/accounts";
import type { ChapterInfo, Source } from "./sources";

// A fake site whose chapter list the tests can change, standing in for WeebCentral.
const site = vi.hoisted(() => ({
  chapters: [] as ChapterInfo[],
  pages: {} as Record<string, string[]>,
  calls: { getSeries: 0, getChapters: 0, getPageUrls: 0 },
  failChapters: false,
}));
vi.mock("@/lib/sources", async () => {
  const fake: Source = {
    key: "fake",
    name: "Fake",
    matches: (url) => url.startsWith("https://fake.test/series/"),
    parseSeriesId: (url) => url.split("/").pop()!,
    getSeries: async (id) => {
      site.calls.getSeries++;
      return { sourceId: id, title: `Series ${id}`, url: `https://fake.test/series/${id}`, coverUrl: null };
    },
    getChapters: async () => {
      site.calls.getChapters++;
      if (site.failChapters) throw new Error("site down");
      return site.chapters;
    },
    getPageUrls: async (id) => {
      site.calls.getPageUrls++;
      return site.pages[id] ?? [];
    },
  };
  return {
    getSource: () => fake,
    resolveLink: (url: string) => {
      if (!fake.matches(url)) throw new Error("unsupported");
      return { source: fake, seriesId: fake.parseSeriesId(url) };
    },
  };
});

const lib = await import("./library");
const ch = (n: number, name = `Chapter ${n}`): ChapterInfo => ({ sourceId: `C${n}`, name, number: n });

let db: DB;
let alice: string;
let bob: string;
beforeEach(async () => {
  db = await testDb();
  site.chapters = [ch(1), ch(2), ch(3)];
  site.pages = { C1: ["https://img/1-1.png", "https://img/1-2.png"], C2: ["https://img/2-1.png"] };
  site.calls = { getSeries: 0, getChapters: 0, getPageUrls: 0 };
  site.failChapters = false;
  alice = (await createAccount(db, { username: "alice", password: "password1" }, { allowOpenSignup: true })).id;
  bob = (await createAccount(db, { username: "bob", password: "password1" }, { allowOpenSignup: true })).id;
});

describe("subscribing", () => {
  it("scrapes a new series once and shares it between subscribers", async () => {
    const a = await lib.subscribeByLink(db, alice, "https://fake.test/series/X");
    const b = await lib.subscribeByLink(db, bob, "https://fake.test/series/X");
    expect(a.isNew).toBe(true);
    expect(b).toEqual({ seriesId: a.seriesId, isNew: false });
    expect(site.calls).toMatchObject({ getSeries: 1, getChapters: 1 });

    const page = await lib.getSeriesWithChapters(db, alice, a.seriesId);
    expect(page?.title).toBe("Series X");
    expect(page?.subscribed).toBe(true);
    expect(page?.chapters.map((c) => c.name)).toEqual(["Chapter 1", "Chapter 2", "Chapter 3"]);
  });

  it("subscribing twice is harmless and unsubscribing removes it from the library", async () => {
    const { seriesId } = await lib.subscribeByLink(db, alice, "https://fake.test/series/X");
    await lib.subscribeByLink(db, alice, "https://fake.test/series/X");
    expect(await lib.getLibrary(db, alice)).toHaveLength(1);
    await lib.unsubscribe(db, alice, seriesId);
    expect(await lib.getLibrary(db, alice)).toHaveLength(0);
  });

  it("leaves nothing behind when the chapter list can't be fetched", async () => {
    site.failChapters = true;
    await expect(lib.subscribeByLink(db, alice, "https://fake.test/series/X")).rejects.toThrow("site down");
    expect(await db.select().from(seriesTable)).toHaveLength(0);
  });
});

describe("checking for new chapters", () => {
  it("adds new chapters, keeps reading order, and is rate limited unless forced", async () => {
    const { seriesId } = await lib.subscribeByLink(db, alice, "https://fake.test/series/X");
    site.chapters = [ch(1), ch(2), { sourceId: "EXTRA", name: "Side Story", number: null }, ch(3), ch(4)];

    expect(await lib.checkForNewChapters(db, seriesId)).toBeNull(); // checked moments ago
    expect(await lib.checkForNewChapters(db, seriesId, { force: true })).toBe(2);
    const page = await lib.getSeriesWithChapters(db, alice, seriesId);
    expect(page?.chapters.map((c) => c.name)).toEqual(["Chapter 1", "Chapter 2", "Side Story", "Chapter 3", "Chapter 4"]);
    expect(await lib.checkForNewChapters(db, seriesId, { force: true })).toBe(0);
  });

  it("lists subscribed series for the cron, least recently checked first", async () => {
    const x = await lib.subscribeByLink(db, alice, "https://fake.test/series/X");
    const y = await lib.subscribeByLink(db, bob, "https://fake.test/series/Y");
    await lib.checkForNewChapters(db, x.seriesId, { force: true });
    expect(await lib.subscribedSeriesIds(db)).toEqual([y.seriesId, x.seriesId]);
    await lib.unsubscribe(db, bob, y.seriesId);
    expect(await lib.subscribedSeriesIds(db)).toEqual([x.seriesId]);
  });
});

describe("progress and the library", () => {
  it("continue points at the next unread chapter and counts read chapters per user", async () => {
    const { seriesId } = await lib.subscribeByLink(db, alice, "https://fake.test/series/X");
    let [entry] = await lib.getLibrary(db, alice);
    expect(entry).toMatchObject({ chapterCount: 3, readCount: 0, latestChapter: "Chapter 3", continueChapterName: "Chapter 1" });

    const page = await lib.getSeriesWithChapters(db, alice, seriesId);
    const [c1, c2] = page!.chapters;
    await lib.saveProgress(db, alice, c1.id, 1, true);
    [entry] = await lib.getLibrary(db, alice);
    expect(entry).toMatchObject({ readCount: 1, continueChapterName: "Chapter 2" });

    await lib.saveProgress(db, alice, c2.id, 0, false); // started chapter 2
    [entry] = await lib.getLibrary(db, alice);
    expect(entry.continueChapterName).toBe("Chapter 2");

    await lib.subscribeByLink(db, bob, "https://fake.test/series/X");
    const [bobEntry] = await lib.getLibrary(db, bob);
    expect(bobEntry).toMatchObject({ readCount: 0, continueChapterName: "Chapter 1" });
  });

  it("re-opening a finished chapter doesn't mark it unread", async () => {
    const { seriesId } = await lib.subscribeByLink(db, alice, "https://fake.test/series/X");
    const [c1] = (await lib.getSeriesWithChapters(db, alice, seriesId))!.chapters;
    await lib.saveProgress(db, alice, c1.id, 1, true);
    await lib.saveProgress(db, alice, c1.id, 0, false);
    const [again] = (await lib.getSeriesWithChapters(db, alice, seriesId))!.chapters;
    expect(again.completed).toBe(true);
  });

  it("marks chapters read and unread, including everything up to a chapter", async () => {
    const { seriesId } = await lib.subscribeByLink(db, alice, "https://fake.test/series/X");
    const list = (await lib.getSeriesWithChapters(db, alice, seriesId))!.chapters;
    await lib.markReadUpTo(db, alice, list[1].id);
    let now = (await lib.getSeriesWithChapters(db, alice, seriesId))!.chapters;
    expect(now.map((c) => c.completed)).toEqual([true, true, false]);
    await lib.setChapterRead(db, alice, list[0].id, false);
    now = (await lib.getSeriesWithChapters(db, alice, seriesId))!.chapters;
    expect(now.map((c) => c.completed)).toEqual([false, true, false]);
  });

  it("counts chapters added after subscribing", async () => {
    const { seriesId } = await lib.subscribeByLink(db, alice, "https://fake.test/series/X");
    await new Promise((r) => setTimeout(r, 5));
    site.chapters = [ch(1), ch(2), ch(3), ch(4)];
    await lib.checkForNewChapters(db, seriesId, { force: true });
    const [entry] = await lib.getLibrary(db, alice);
    expect(entry.newSinceSubscribed).toBe(1);
  });
});

describe("reader", () => {
  it("scrapes page URLs once, links neighbours and resumes unfinished chapters", async () => {
    const { seriesId } = await lib.subscribeByLink(db, alice, "https://fake.test/series/X");
    const [c1, c2, c3] = (await lib.getSeriesWithChapters(db, alice, seriesId))!.chapters;

    const first = await lib.getReaderChapter(db, alice, c1.id);
    expect(first).toMatchObject({ pages: site.pages.C1, prevId: null, nextId: c2.id, savedPage: 0, seriesTitle: "Series X" });
    await lib.getReaderChapter(db, bob, c1.id);
    expect(site.calls.getPageUrls).toBe(1); // second open (even by someone else) uses the stored list

    await lib.saveProgress(db, alice, c1.id, 1, false);
    expect((await lib.getReaderChapter(db, alice, c1.id))?.savedPage).toBe(1);
    await lib.saveProgress(db, alice, c1.id, 1, true);
    expect((await lib.getReaderChapter(db, alice, c1.id))?.savedPage).toBe(0); // finished: start over

    expect((await lib.getReaderChapter(db, alice, c3.id))?.nextId).toBeNull();
    expect(await lib.getPageUrl(db, c1.id, 1)).toBe("https://img/1-2.png");
    expect(await lib.getPageUrl(db, c1.id, 5)).toBeNull();
  });
});
