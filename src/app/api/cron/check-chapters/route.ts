/**
 * Daily job (vercel.json "crons"): look for new chapters in every series someone subscribes to.
 * Vercel calls it with "Authorization: Bearer $CRON_SECRET"; anything else is refused.
 * Series are checked least-recently-checked first, so if the time budget runs out the rest go first tomorrow.
 */
import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/db";
import { checkForNewChapters, subscribedSeriesIds } from "@/lib/library";

export const maxDuration = 300; // the Hobby plan maximum

const TIME_BUDGET_MS = 240_000; // stop starting new checks with a minute to spare
const PAUSE_BETWEEN_MS = 1_000; // be polite to the source site

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return Response.json({ error: "CRON_SECRET is not set. Add it in Vercel > Settings > Environment Variables." }, { status: 500 });
  }
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const started = performance.now();
  const db = await getDb();
  const ids = await subscribedSeriesIds(db);
  const result = { series: ids.length, checked: 0, newChapters: 0, failed: [] as string[], skippedForTime: 0 };

  for (const [i, id] of ids.entries()) {
    if (performance.now() - started > TIME_BUDGET_MS) {
      result.skippedForTime = ids.length - i;
      break;
    }
    try {
      result.newChapters += (await checkForNewChapters(db, id, { force: true })) ?? 0;
      result.checked++;
    } catch (err) {
      console.error(`[cron] series ${id} failed:`, err);
      result.failed.push(id);
    }
    if (i < ids.length - 1) await new Promise((r) => setTimeout(r, PAUSE_BETWEEN_MS));
  }
  console.log("[cron] check-chapters", result);
  return Response.json(result);
}
