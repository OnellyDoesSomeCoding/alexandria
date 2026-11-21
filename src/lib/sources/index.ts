import type { Source } from "./types";
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

export type { ChapterInfo, SeriesInfo, Source } from "./types";
export { SourceError } from "./types";
