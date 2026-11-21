/**
 * Temporary feasibility check: can this server reach WeebCentral? Open /api/probe on the deployed site.
 * Delete once the result is known.
 */
import { resolveLink } from "@/lib/sources";

const DEFAULT_LINK = "https://weebcentral.com/series/01J76XYFD97DRQQKK75FZB7PQH/Gachiakuta";

export async function GET(request: Request) {
  const link = new URL(request.url).searchParams.get("url") ?? DEFAULT_LINK;
  const steps: Record<string, unknown> = { region: process.env.VERCEL_REGION ?? "local" };
  const timed = async <T,>(name: string, fn: () => Promise<T>) => {
    const start = Date.now();
    try {
      const value = await fn();
      steps[name] = { ok: true, ms: Date.now() - start };
      return value;
    } catch (err) {
      steps[name] = { ok: false, ms: Date.now() - start, error: String(err) };
      return null;
    }
  };

  const { source, seriesId } = resolveLink(link);
  const series = await timed("series", () => source.getSeries(seriesId));
  const chapters = await timed("chapters", () => source.getChapters(seriesId));
  const first = chapters?.[0];
  const pages = first ? await timed("pages", () => source.getPageUrls(first.sourceId)) : null;
  const image = pages?.[0]
    ? await timed("image", async () => {
        const res = await fetch(pages[0], { cache: "no-store" });
        return { status: res.status, type: res.headers.get("content-type"), bytes: (await res.arrayBuffer()).byteLength };
      })
    : null;

  return Response.json({
    steps,
    series,
    chapterCount: chapters?.length ?? 0,
    firstChapters: chapters?.slice(0, 3),
    lastChapters: chapters?.slice(-3),
    firstChapterPages: pages?.length ?? 0,
    image,
  });
}
