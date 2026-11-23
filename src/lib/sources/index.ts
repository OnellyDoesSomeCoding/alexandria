import type { SearchResult, Source } from "./types";
import { SourceError } from "./types";
import { weebcentral } from "./weebcentral";

export const sources: Source[] = [weebcentral];

export function getSource(key: string): Source {
  const source = sources.find((s) => s.key === key);
  if (!source) throw new Error(`Unknown source: ${key}`);
  return source;
}

/** The source that understands a pasted link, plus the series id inside it. */
export function resolveLink(url: string): { source: Source; seriesId: string } {
  const source = sources.find((s) => s.matches(url));
  if (!source) {
    throw new SourceError(`That link isn't from a supported site. Supported: ${sources.map((s) => s.name).join(", ")}.`, "bad_link");
  }
  return { source, seriesId: source.parseSeriesId(url) };
}

// ---------- search ----------

export const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 100;
const SEARCH_TTL_MS = 10 * 60 * 1000;
const SEARCH_CACHE_SIZE = 200;

export interface SourceSearch {
  sourceKey: string;
  sourceName: string;
  results: SearchResult[];
  error?: string; // set instead of results when this source's search failed
}

/**
 * Recent searches, so repeating one doesn't hit the site again. It lives in this server instance's memory,
 * which Vercel reuses between nearby requests but not forever. Failed searches are never stored.
 */
const searchCache = new Map<string, { at: number; results: SearchResult[] }>();

export function normalizeQuery(query: string): string {
  return query.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LENGTH);
}

async function cachedSearch(source: Source, query: string, now: number): Promise<SearchResult[]> {
  const key = `${source.key}\n${query.toLowerCase()}`;
  const hit = searchCache.get(key);
  if (hit && now - hit.at < SEARCH_TTL_MS) return hit.results;
  const results = await source.search!(query);
  searchCache.delete(key); // re-insert so Map order stays oldest-first
  searchCache.set(key, { at: now, results });
  while (searchCache.size > SEARCH_CACHE_SIZE) searchCache.delete(searchCache.keys().next().value!);
  return results;
}

/** Search every source that supports it, side by side. One site failing doesn't hide the others' results. */
export async function searchSources(rawQuery: string, list: Source[] = sources, now = Date.now()): Promise<SourceSearch[]> {
  const query = normalizeQuery(rawQuery);
  if (query.length < MIN_QUERY_LENGTH) return [];
  return Promise.all(
    list
      .filter((s) => s.search)
      .map(async (source): Promise<SourceSearch> => {
        const base = { sourceKey: source.key, sourceName: source.name };
        try {
          return { ...base, results: await cachedSearch(source, query, now) };
        } catch (err) {
          if (!(err instanceof SourceError)) console.error(err);
          const error = err instanceof SourceError ? err.message : `Couldn't search ${source.name} right now. Try again in a minute.`;
          return { ...base, results: [], error };
        }
      }),
  );
}

export function clearSearchCache() {
  searchCache.clear();
}

export type { ChapterInfo, SearchResult, SeriesInfo, Source } from "./types";
export { SourceError } from "./types";
