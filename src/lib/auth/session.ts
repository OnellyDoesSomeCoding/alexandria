/** The cookie side of auth: who is signed in on this request. */
import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/db";
import { createSession, type CurrentUser, deleteSession, userFromSessionToken } from "./accounts";

export const SESSION_COOKIE = "alx_session";

/** The signed-in user, or null. Deduplicated within one request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return userFromSessionToken(await getDb(), token);
});

/** The signed-in user; sends everyone else to the login page. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Call from a Server Action after verifying credentials. */
export async function startSession(userId: string): Promise<void> {
  const { token, expiresAt } = await createSession(await getDb(), userId);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(await getDb(), token);
  store.delete(SESSION_COOKIE);
}

/** Best-effort client IP for login throttling (Vercel sets x-forwarded-for). */
export async function clientIp(): Promise<string | undefined> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || undefined;
}
