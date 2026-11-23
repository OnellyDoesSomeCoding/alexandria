/** What every manga site adapter provides. Add a site by implementing this and registering it in ./index.ts. */

export interface SeriesInfo {
  sourceId: string; // the site's own id for the series
  title: string;
  url: string; // canonical series page
  coverUrl: string | null;
}

export interface ChapterInfo {
  sourceId: string; // the site's own id for the chapter
  name: string;
  number: number | null; // null for unnumbered extras/specials
}

export interface SearchResult extends SeriesInfo {
  details: string[]; // short facts for the result card, e.g. ["Manga", "2022", "Ongoing"]
}

export interface Source {
  key: string; // stored in the database, never change it once used, e.g. "weebcentral"
  name: string; // shown to users
  /** True if this source understands the link. */
  matches(url: string): boolean;
  /** The series id inside a link this source matches. Throws on a malformed link. */
  parseSeriesId(url: string): string;
  getSeries(seriesId: string): Promise<SeriesInfo>;
  /** All chapters in ascending reading order. */
  getChapters(seriesId: string): Promise<ChapterInfo[]>;
  /** Page image URLs in reading order. */
  getPageUrls(chapterId: string): Promise<string[]>;
  /** Optional: series matching a title, best match first. Sources without it are added by pasting a link only. */
  search?(query: string): Promise<SearchResult[]>;
}

export class SourceError extends Error {
  constructor(
    message: string,
    readonly kind: "blocked" | "not_found" | "layout_changed" | "network" | "bad_link",
  ) {
    super(message);
    this.name = "SourceError";
  }
}
