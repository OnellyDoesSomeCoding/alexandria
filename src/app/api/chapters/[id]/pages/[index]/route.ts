/**
 * One page image, fetched from the source site on the server. The browser can show the site's images directly,
 * but can't read their bytes (no CORS), which building a PDF needs. Only URLs stored for the chapter are fetched,
 * so this can't be used as an open proxy. Used for downloads only; the reader loads images directly.
 */
import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/auth/session";
import { getPageUrl } from "@/lib/library";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: RouteContext<"/api/chapters/[id]/pages/[index]">) {
  if (!(await getCurrentUser())) return new Response("Sign in first.", { status: 401 });
  const { id, index } = await params;
  const n = Number(index);
  if (!UUID.test(id) || !Number.isInteger(n) || n < 0) return new Response("Not found", { status: 404 });

  const url = await getPageUrl(await getDb(), id, n);
  if (!url) return new Response("Not found", { status: 404 });

  const upstream = await fetch(url, { signal: AbortSignal.timeout(20_000), cache: "no-store" }).catch(() => null);
  const type = upstream?.headers.get("content-type") ?? "";
  if (!upstream?.ok || !type.startsWith("image/")) {
    return new Response(`The manga site didn't return this page (HTTP ${upstream?.status ?? "error"}).`, { status: 502 });
  }
  return new Response(upstream.body, {
    headers: { "Content-Type": type, "Cache-Control": "private, max-age=86400" },
  });
}
