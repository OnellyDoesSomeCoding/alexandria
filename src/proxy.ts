/**
 * Optimistic auth check: no session cookie -> login page. This only looks at the cookie; pages still verify
 * the session against the database (requireUser), so a stale or forged cookie gets nowhere.
 */
import { type NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "alx_session"; // keep in sync with lib/auth/session.ts (that file is server-only)
const PUBLIC_PATHS = ["/login", "/signup"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.includes(pathname) || request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  // Skip Next internals, static files, and API routes (they check auth themselves, e.g. the cron route uses a secret).
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|txt)$).*)"],
};
