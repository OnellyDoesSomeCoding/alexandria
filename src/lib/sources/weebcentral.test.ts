import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  chapterNumber,
  parseChapterList,
  parsePageImages,
  parseSearchResults,
  parseSeries,
  parseSeriesUrl,
  sortChapters,
  sortPages,
} from "./weebcentral";
import { clearSearchCache, resolveLink, searchSources } from "./index";
import { type SearchResult, type Source, SourceError } from "./types";

const ID_A = "01J76XYFD97DRQQKK75FZB7PQA";
const ID_B = "01J76XYFD97DRQQKK75FZB7PQB";
const ID_C = "01J76XYFD97DRQQKK75FZB7PQC";

// Shaped like WeebCentral's /full-chapter-list fragment: newest first.
const CHAPTER_LIST_HTML = `
<div x-data="{}" class="flex items-center">
  <a href="https://weebcentral.com/chapters/${ID_C}" class="hover:bg-base-300 flex-1 flex items-center p-2">
    <span class="grow flex items-center gap-2"><span class="">Chapter 2</span></span>
    <time datetime="2024-02-01T00:00:00Z">2/1/2024</time>
  </a>
</div>
<div x-data="{}" class="flex items-center">
  <a href="https://weebcentral.com/chapters/${ID_B}"><span class="grow flex items-center gap-2"><span class="">Special Episode</span></span></a>
</div>
<div x-data="{}" class="flex items-center">
  <a href="https://weebcentral.com/chapters/${ID_A}"><span class="grow flex items-center gap-2"><span class="">Chapter 1</span></span></a>
</div>
<a href="https://weebcentral.com/chapters/${ID_A}">duplicate link</a>`;

const chapterListHtml = (...names: string[]) =>
  names
    .map(
      (name, i) =>
        `<a href="/chapters/01J76XYFD97DRQQKK75FZB${String(i).padStart(4, "0")}"><span class="grow flex items-center gap-2">` +
        `<span class="">${name}</span><span class="hidden md:inline">Last Read</span></span></a>`,
    )
    .join("");

const make = (...names: string[]) => names.map((name, i) => ({ sourceId: `ID${i}`, name, number: chapterNumber(name) }));
const names = (chapters: { name: string }[]) => chapters.map((c) => c.name);

describe("links", () => {
  it("parses series links", () => {
    expect(parseSeriesUrl("https://weebcentral.com/series/01J76XYFD97DRQQKK75FZB7PQH/Gachiakuta")).toEqual({
      id: "01J76XYFD97DRQQKK75FZB7PQH",
      slug: "Gachiakuta",
    });
    expect(parseSeriesUrl("https://weebcentral.com/series/01J76XYFD97DRQQKK75FZB7PQH").slug).toBe("");
  });

  it("rejects other sites", () => {
    expect(() => parseSeriesUrl("https://example.com/series/01J76XYFD97DRQQKK75FZB7PQH/Gachiakuta")).toThrow();
    expect(() => resolveLink("https://example.com/manga/1")).toThrow(/supported/);
  });

  it("finds the source for a link", () => {
    const { source, seriesId } = resolveLink("https://weebcentral.com/series/01J76XYFD97DRQQKK75FZB7PQH/Gachiakuta");
    expect(source.key).toBe("weebcentral");
    expect(seriesId).toBe("01J76XYFD97DRQQKK75FZB7PQH");
  });
});

describe("chapter numbers", () => {
  it.each([
    ["Chapter 152", 152],
    ["Chapter 10.5", 10.5],
    ["Episode 3", 3],
    ["Ch. 7", 7],
    ["12", 12],
    ["Special Episode", null],
    ["Extra 1", null],
  ])("%s -> %s", (name, expected) => {
    expect(chapterNumber(name)).toBe(expected);
  });
});

describe("chapter list", () => {
  it("is ascending and deduplicated", () => {
    const chapters = parseChapterList(CHAPTER_LIST_HTML);
    expect(names(chapters)).toEqual(["Chapter 1", "Special Episode", "Chapter 2"]);
    expect(chapters.map((c) => c.number)).toEqual([1, null, 2]);
    expect(chapters[0].sourceId).toBe(ID_A);
  });

  it("understands a series' own chapter word", () => {
    const chapters = parseChapterList(chapterListHtml("Hunt 3", "Hunt 2.5", "Hunt 2", "Hunt 1"));
    expect(chapters.map((c) => c.number)).toEqual([1, 2, 2.5, 3]);
    expect(names(chapters)).toEqual(["Hunt 1", "Hunt 2", "Hunt 2.5", "Hunt 3"]);
  });

  it("leaves other extras alone when using the chapter word", () => {
    const chapters = parseChapterList(chapterListHtml("Lesson 3", "Special 1", "Lesson 2", "Lesson 1"));
    expect(chapters.map((c) => [c.name, c.number])).toEqual([
      ["Lesson 1", 1],
      ["Lesson 2", 2],
      ["Special 1", null],
      ["Lesson 3", 3],
    ]);
  });

  it("does not take a rare word as the chapter word", () => {
    const chapters = parseChapterList(chapterListHtml("Chapter 3", "Chapter 2", "Extra 1", "Chapter 1"));
    expect(chapters.map((c) => c.number)).toEqual([1, null, 2, 3]);
  });
});

describe("ordering", () => {
  it("turns a newest-first list ascending", () => {
    expect(names(sortChapters(make("Chapter 3", "Chapter 2", "Chapter 1")))).toEqual(["Chapter 1", "Chapter 2", "Chapter 3"]);
  });

  it("is not thrown off by an odd entry at the end", () => {
    expect(sortChapters(make("Chapter 20", "Chapter 19", "Chapter 18", "Chapter 99")).map((c) => c.number)).toEqual([18, 19, 20, 99]);
  });

  it("sorts a shuffled list with decimals", () => {
    const chapters = make("Chapter 2", "Chapter 10", "Chapter 1", "Chapter 140.2", "Chapter 140", "Chapter 3");
    expect(sortChapters(chapters).map((c) => c.number)).toEqual([1, 2, 3, 10, 140, 140.2]);
  });

  it("keeps extras after the chapter they followed", () => {
    const newestFirst = make("Chapter 3", "Side Story", "Chapter 2", "Chapter 1", "Prologue Extra", "Prologue Extra 2");
    expect(names(sortChapters(newestFirst))).toEqual([
      "Prologue Extra 2",
      "Prologue Extra",
      "Chapter 1",
      "Chapter 2",
      "Side Story",
      "Chapter 3",
    ]);
  });

  it("keeps listed order for duplicate numbers", () => {
    const chapters = [
      { sourceId: "A", name: "Chapter 1", number: 1 },
      { sourceId: "B", name: "Chapter 1", number: 1 },
      { sourceId: "C", name: "Chapter 2", number: 2 },
    ];
    expect(sortChapters(chapters).map((c) => c.sourceId)).toEqual(["A", "B", "C"]);
  });
});

describe("pages", () => {
  it("drops site assets and keeps order", () => {
    const html = `
      <section class="flex-1 flex flex-col" x-data="{ scroll: true }">
        <img src="https://hot.planeptune.us/manga/Gachiakuta/0001-001.png" alt="Page 1">
        <img src="https://hot.planeptune.us/manga/Gachiakuta/0001-002.png" alt="Page 2">
      </section>
      <img src="https://weebcentral.com/static/images/brand.png" alt="logo">`;
    expect(parsePageImages(html)).toEqual([
      "https://hot.planeptune.us/manga/Gachiakuta/0001-001.png",
      "https://hot.planeptune.us/manga/Gachiakuta/0001-002.png",
    ]);
  });

  it("sorts by the number in the filename", () => {
    const urls = [3, 1, 10, 2].map((p) => `https://img.example/m/0001-${String(p).padStart(3, "0")}.png`);
    expect(sortPages(urls).map((u) => u.slice(-7))).toEqual(["001.png", "002.png", "003.png", "010.png"]);
  });

  it("keeps site order when filenames have no numbers", () => {
    const urls = ["https://img.example/b.png", "https://img.example/a.png"];
    expect(sortPages(urls)).toEqual(urls);
  });
});

describe("series page", () => {
  it("reads title and cover with fallbacks", () => {
    expect(parseSeries("<html><h1> Gachiakuta </h1></html>", "ID", "x").title).toBe("Gachiakuta");
    expect(parseSeries('<meta property="og:title" content="Gachiakuta | Weeb Central">', "ID", "x").title).toBe("Gachiakuta");
    expect(parseSeries("<p>nothing</p>", "ID", "some-slug").title).toBe("some slug");
    expect(parseSeries('<meta property="og:image" content="/cover/x.webp">', "ID", "").coverUrl).toBe(
      "https://weebcentral.com/cover/x.webp",
    );
  });
});

// Shaped like WeebCentral's /search/data "Full Display" fragment (trimmed): the cover link nests <article>s.
const searchCard = (id: string, slug: string, title: string, facts: string) => `
<article class="bg-base-300 flex gap-4 p-4">
  <section class="w-full lg:w-[25%] xl:w-[20%]">
    <a href="https://weebcentral.com/series/${id}/${slug}">
      <article class="hidden lg:block w-full aspect-4/6 overflow-hidden">
        <picture>
          <source srcset="https://temp.compsci88.com/cover/normal/${id}.webp" media="(min-width: 768px)" type="image/webp">
          <source srcset="https://temp.compsci88.com/cover/small/${id}.webp" type="image/webp">
          <img src="https://temp.compsci88.com/cover/fallback/${id}.jpg" alt="${title} cover">
        </picture>
      </article>
      <article class="lg:hidden relative overflow-hidden"><div class="truncate">${title}</div></article>
    </a>
  </section>
  <section class="hidden lg:block">
    <div class="text-lg font-semibold flex items-center gap-1">
      <span class="tooltip tooltip-bottom" data-tip="${title}">
        <a href="https://weebcentral.com/series/${id}/${slug}" class="line-clamp-1 link link-hover">${title}</a>
      </span>
    </div>
    ${facts}
    <div><strong class="opacity-70">Author(s): </strong><span><a href="https://weebcentral.com/search?author=X">X</a></span></div>
  </section>
</article>`;
const fact = (label: string, value: string) => `<div class="opacity-70"><strong>${label}:</strong>\n<span>${value}</span></div>`;

describe("search results", () => {
  it("reads title, cover, link and facts for each series once", () => {
    const html =
      searchCard(ID_A, "One-Piece", "One Piece", fact("Year", "1997") + fact("Status", "Ongoing") + fact("Type", "Manga")) +
      searchCard(ID_B, "The-One", "The One", fact("Type", "Manhua")) +
      `<button hx-get="/search/data?limit=32&amp;offset=32&amp;text=one">View More</button>`;
    expect(parseSearchResults(html)).toEqual([
      {
        sourceId: ID_A,
        title: "One Piece",
        url: `https://weebcentral.com/series/${ID_A}/One-Piece`,
        coverUrl: `https://temp.compsci88.com/cover/small/${ID_A}.webp`,
        details: ["Manga", "1997", "Ongoing"],
      },
      {
        sourceId: ID_B,
        title: "The One",
        url: `https://weebcentral.com/series/${ID_B}/The-One`,
        coverUrl: `https://temp.compsci88.com/cover/small/${ID_B}.webp`,
        details: ["Manhua"],
      },
    ]);
  });

  it("returns nothing for the 'No results found' alert", () => {
    expect(parseSearchResults('<div role="alert" class="alert alert-warning"><span>No results found</span></div>')).toEqual([]);
  });
});

describe("searchSources", () => {
  const result: SearchResult = { sourceId: "S1", title: "Found", url: "https://x/1", coverUrl: null, details: [] };
  const fakeSource = (key: string, search?: Source["search"]): Source => ({
    key,
    name: key.toUpperCase(),
    matches: () => false,
    parseSeriesId: () => "",
    getSeries: async () => ({ ...result }),
    getChapters: async () => [],
    getPageUrls: async () => [],
    search,
  });

  beforeEach(() => clearSearchCache());

  it("skips short queries and sources without search", async () => {
    const search = vi.fn(async () => [result]);
    expect(await searchSources(" a ", [fakeSource("a", search)])).toEqual([]);
    expect(await searchSources("found", [fakeSource("nosearch")])).toEqual([]);
    expect(search).not.toHaveBeenCalled();
  });

  it("caches repeat searches for ten minutes, ignoring case and spacing", async () => {
    const search = vi.fn(async () => [result]);
    const list = [fakeSource("a", search)];
    await searchSources("One  Piece", list, 0);
    await searchSources(" one piece", list, 9 * 60 * 1000);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("One Piece");
    await searchSources("one piece", list, 11 * 60 * 1000);
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("reports a failing source without hiding the others, and doesn't cache the failure", async () => {
    const failing = vi.fn(async (): Promise<SearchResult[]> => {
      throw new SourceError("blocked by the site", "blocked");
    });
    const list = [fakeSource("bad", failing), fakeSource("good", async () => [result])];
    expect(await searchSources("found", list)).toEqual([
      { sourceKey: "bad", sourceName: "BAD", results: [], error: "blocked by the site" },
      { sourceKey: "good", sourceName: "GOOD", results: [result] },
    ]);
    await searchSources("found", list);
    expect(failing).toHaveBeenCalledTimes(2);
  });
});
