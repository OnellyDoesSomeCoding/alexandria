import { SourceError } from "./types";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

function looksLikeCloudflareChallenge(status: number, body: string): boolean {
  if (status !== 403 && status !== 503) return false;
  const text = body.slice(0, 5000).toLowerCase();
  return text.includes("just a moment") || text.includes("cf-chl") || text.includes("challenge-platform");
}

/** GET a page as text with browser-like headers, retrying temporary failures with backoff. */
export async function fetchText(url: string, init: { referer?: string; retries?: number; timeoutMs?: number } = {}) {
  const { referer, retries = 2, timeoutMs = 15000 } = init;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let wait = 1000 * 2 ** attempt;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, ...(referer ? { Referer: referer } : {}) },
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
      const body = await res.text();
      if (looksLikeCloudflareChallenge(res.status, body)) {
        throw new SourceError("The site is blocking automated requests from this server (Cloudflare challenge).", "blocked");
      }
      if (res.status === 404) throw new SourceError(`Not found: ${url}`, "not_found");
      if (res.ok) return body;
      if (!RETRY_STATUS.has(res.status)) throw new SourceError(`HTTP ${res.status} for ${url}`, "network");
      lastError = new SourceError(`HTTP ${res.status} for ${url}`, "network");
      const retryAfter = Number(res.headers.get("retry-after"));
      if (Number.isFinite(retryAfter) && retryAfter > 0) wait = Math.max(wait, retryAfter * 1000);
    } catch (err) {
      if (err instanceof SourceError && err.kind !== "network") throw err;
      lastError = err instanceof SourceError ? err : new SourceError(`Could not reach ${new URL(url).host}: ${String(err)}`, "network");
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, wait));
  }
  throw lastError;
}
