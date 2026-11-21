/** Page count and name of a chapter, for the PDF builder. Scrapes the page list if nobody has opened it yet. */
import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/auth/session";
import { getChapterPages } from "@/lib/library";
import { SourceError } from "@/lib/sources";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: RouteContext<"/api/chapters/[id]/pages">) {
  if (!(await getCurrentUser())) return Response.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return Response.json({ error: "Not found" }, { status: 404 });
  try {
    const chapter = await getChapterPages(await getDb(), id);
    if (!chapter) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ name: chapter.name, seriesTitle: chapter.seriesTitle, count: chapter.pages.length });
  } catch (err) {
    if (err instanceof SourceError) return Response.json({ error: err.message }, { status: 502 });
    throw err;
  }
}
