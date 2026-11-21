/**
 * weebcentral.com. The site loads its pieces as htmx HTML fragments, so we request those directly:
 *
 *   /series/{id}/{slug}                    -> title, cover
 *   /series/{id}/full-chapter-list         -> one <a href=".../chapters/{chapterId}"> per chapter
 *   /chapters/{chapterId}/images?...       -> the page <img> tags
 */

import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { fetchText } from "./http";
import { type ChapterInfo, type SeriesInfo, type Source, SourceError } from "./types";

export const BASE_URL = "https://weebcentral.com";
const SERIES_URL_RE = /^https?:\/\/(?:www\.)?weebcentral\.com\/series\/([0-9A-Za-z]{26})(?:\/([^/?#]*))?/i;
const CHAPTER_HREF_RE = /\/chapters\/([0-9A-Za-z]{26})/;
const CHAPTER_NUMBER_RE = /\b(?:chapter|episode|ch\.?|ep\.?)\s*(\d+(?:\.\d+)?)/i;
const BARE_NUMBER_RE = /^\s*(\d+(?:\.\d+)?)\s*$/;
// A series' own chapter word, like "Hunt 106" or "Lesson 5": one word, then the number.
const LABELLED_NUMBER_RE = /^\s*([A-Za-z]+)\.?\s*#?(\d+(?:\.\d+)?)\b/;
const PAGE_NUMBER_RE = /(\d+)\.[A-Za-z0-9]+$/; // trailing number in the filename

export function parseSeriesUrl(url: string): { id: string; slug: string } {
  const m = SERIES_URL_RE.exec(url.trim());
  if (!m) {
    throw new SourceError(
      "Not a WeebCentral series link. Expected something like https://weebcentral.com/series/01J76XYFD97DRQQKK75FZB7PQH/Gachiakuta",
      "bad_link",
    );
  }
  return { id: m[1].toUpperCase(), slug: m[2] ?? "" };
}

/** The chapter number in a name, or null for an unnumbered extra. `label` is the series' own chapter word. */
export function chapterNumber(name: string, label?: string | null): number | null {
  const m = CHAPTER_NUMBER_RE.exec(name) ?? BARE_NUMBER_RE.exec(name);
  if (m) return Number(m[1]);
  if (label) {
    const l = LABELLED_NUMBER_RE.exec(name);
    if (l && l[1].toLowerCase() === label) return Number(l[2]);
  }
  return null;
}

/** The word a series uses instead of "Chapter", if at least half the chapters use the same one. */
export function seriesChapterLabel(names: string[]): string | null {
  const counts = new Map<string, number>();
  for (const name of names) {
    if (chapterNumber(name) !== null) continue;
    const l = LABELLED_NUMBER_RE.exec(name);
    if (l) counts.set(l[1].toLowerCase(), (counts.get(l[1].toLowerCase()) ?? 0) + 1);
  }
  let best: [string, number] | null = null;
  for (const entry of counts) if (!best || entry[1] > best[1]) best = entry;
  if (!best) return null;
  const [label, count] = best;
  return count >= 2 && count * 2 >= names.length ? label : null;
}

/**
 * Ascending by number, whatever order the site listed them in. Unnumbered extras stay right after
 * the numbered chapter they followed in reading order; equal numbers keep their listed order.
 */
export function sortChapters<T extends { number: number | null }>(chapters: T[]): T[] {
  const numbers = chapters.flatMap((c) => (c.number === null ? [] : [c.number]));
  let desc = 0;
  let asc = 0;
  for (let i = 1; i < numbers.length; i++) {
    if (numbers[i - 1] > numbers[i]) desc++;
    if (numbers[i - 1] < numbers[i]) asc++;
  }
  const oriented = desc > asc ? [...chapters].reverse() : [...chapters];
  let anchor = -Infinity;
  const keyed = oriented.map((chapter, position) => {
    if (chapter.number !== null) {
      anchor = chapter.number;
      return { key: [chapter.number, 0, position], chapter };
    }
    return { key: [anchor, 1, position], chapter };
  });
  keyed.sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2] - b.key[2]);
  return keyed.map((k) => k.chapter);
}

export function parseSeries(html: string, id: string, slug: string): SeriesInfo {
  const $ = cheerio.load(html);
  const fallback = slug.replace(/-/g, " ").trim() || id;
  const h1 = $("h1").first().text().replace(/\s+/g, " ").trim();
  const og = $('meta[property="og:title"]').attr("content")?.split("|")[0].trim();
  const cover = $('meta[property="og:image"]').attr("content") ?? $('img[alt*="cover" i], picture img').first().attr("src");
  return {
    sourceId: id,
    title: h1 || og || fallback,
    url: `${BASE_URL}/series/${id}/${slug}`,
    coverUrl: cover ? new URL(cover, BASE_URL).href : null,
  };
}

function chapterName($: cheerio.CheerioAPI, anchor: Element): string {
  const a = $(anchor);
  const preferred = a.find("span.flex > span").first().text().replace(/\s+/g, " ").trim();
  if (preferred) return preferred;
  for (const span of a.find("span").toArray()) {
    const text = $(span).text().replace(/\s+/g, " ").trim();
    if (CHAPTER_NUMBER_RE.test(text)) return text;
  }
  return a.text().replace(/\s+/g, " ").trim().slice(0, 80);
}

export function parseChapterList(html: string): ChapterInfo[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const entries: { sourceId: string; name: string }[] = [];
  for (const anchor of $('a[href*="/chapters/"]').toArray()) {
    const m = CHAPTER_HREF_RE.exec($(anchor).attr("href") ?? "");
    if (!m) continue;
    const id = m[1].toUpperCase();
    if (seen.has(id)) continue;
    seen.add(id);
    entries.push({ sourceId: id, name: chapterName($, anchor) });
  }
  const label = seriesChapterLabel(entries.map((e) => e.name));
  return sortChapters(entries.map((e) => ({ ...e, number: chapterNumber(e.name, label) })));
}

/** Sort by the number at the end of the filename (0001-002.png -> 2), unless any is missing or repeated. */
export function sortPages(urls: string[]): string[] {
  const numbers: number[] = [];
  for (const url of urls) {
    const m = PAGE_NUMBER_RE.exec(new URL(url).pathname);
    if (!m) return urls;
    numbers.push(Number(m[1]));
  }
  if (new Set(numbers).size !== numbers.length) return urls;
  return urls.map((url, i) => ({ url, n: numbers[i] })).sort((a, b) => a.n - b.n).map((p) => p.url);
}

export function parsePageImages(html: string): string[] {
  const $ = cheerio.load(html);
  let imgs = $("section[x-data~=scroll] > img").toArray();
  if (imgs.length === 0) imgs = $("img").toArray();
  const siteHost = new URL(BASE_URL).hostname;
  const urls: string[] = [];
  for (const img of imgs) {
    const src = $(img).attr("src") || $(img).attr("data-src") || "";
    if (!src || src.startsWith("data:")) continue;
    const absolute = new URL(src, BASE_URL);
    if (absolute.hostname === siteHost) continue; // logos, icons, placeholders
    if (!urls.includes(absolute.href)) urls.push(absolute.href);
  }
  return sortPages(urls);
}

export const weebcentral: Source = {
  key: "weebcentral",
  name: "WeebCentral",
  matches: (url) => SERIES_URL_RE.test(url.trim()),
  parseSeriesId: (url) => parseSeriesUrl(url).id,

  async getSeries(seriesId) {
    // The slug only affects the URL's cosmetics; the site resolves the page from the id.
    const html = await fetchText(`${BASE_URL}/series/${seriesId}`);
    const canonical = cheerio.load(html)('link[rel="canonical"]').attr("href");
    const slug = canonical ? (SERIES_URL_RE.exec(canonical)?.[2] ?? "") : "";
    return parseSeries(html, seriesId, slug);
  },

  async getChapters(seriesId) {
    const html = await fetchText(`${BASE_URL}/series/${seriesId}/full-chapter-list`);
    const chapters = parseChapterList(html);
    if (chapters.length === 0) throw new SourceError("No chapters found. The site layout may have changed.", "layout_changed");
    return chapters;
  },

  async getPageUrls(chapterId) {
    const html = await fetchText(
      `${BASE_URL}/chapters/${chapterId}/images?is_prev=False&current_page=1&reading_style=long_strip`,
    );
    const urls = parsePageImages(html);
    if (urls.length === 0) throw new SourceError("No page images found. The site layout may have changed.", "layout_changed");
    return urls;
  },
};
