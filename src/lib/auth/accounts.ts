/**
 * Account, session and friend logic. Every function takes the database as its first argument so it can be
 * tested against an in-memory Postgres; the cookie-handling layer is in ./session.ts.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { and, count, eq, gt, lt, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { friendships, loginFailures, sessions, users } from "@/db/schema";
import { newFriendCode, newSessionToken, normalizeFriendCode, sessionIdFromToken } from "./codes";
import { DUMMY_HASH, hashPassword, verifyPassword } from "./password";

export const SESSION_DAYS = 60;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_USER = 10;
const MAX_FAILURES_PER_IP = 30;

export const usernameSchema = z
  .string()
  .trim()
  .min(3, "Username must be at least 3 characters.")
  .max(24, "Username can be at most 24 characters.")
  .regex(/^[A-Za-z0-9_.-]+$/, "Username can only use letters, numbers, and _ . -");
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(200, "Password can be at most 200 characters.");

export interface CurrentUser {
  id: string;
  username: string;
  isAdmin: boolean;
  friendCode: string;
}

export class AuthError extends Error {}

function codesMatch(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function isUniqueViolation(err: unknown, index: string): boolean {
  const text = String((err as { cause?: unknown })?.cause ?? err);
  return text.includes(index);
}

/**
 * Create an account. The first account ever is the admin and needs no sign-up code. After that, a code is
 * required when `signupCode` is set; when it isn't, sign-ups are open only if `allowOpenSignup`.
 */
export async function createAccount(
  db: DB,
  input: { username: string; password: string; signupCode?: string },
  config: { signupCode?: string; allowOpenSignup: boolean },
): Promise<CurrentUser> {
  const username = usernameSchema.parse(input.username);
  const password = passwordSchema.parse(input.password);

  const [{ total }] = await db.select({ total: count() }).from(users);
  const isFirst = total === 0;
  if (!isFirst) {
    if (config.signupCode) {
      if (!codesMatch((input.signupCode ?? "").trim(), config.signupCode)) throw new AuthError("That sign-up code isn't right.");
    } else if (!config.allowOpenSignup) {
      throw new AuthError("Sign-ups are closed. Ask the site owner for a sign-up code.");
    }
  }

  const passwordHash = await hashPassword(password);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const [row] = await db
        .insert(users)
        .values({ username, passwordHash, friendCode: newFriendCode(), isAdmin: isFirst })
        .returning({ id: users.id, username: users.username, isAdmin: users.isAdmin, friendCode: users.friendCode });
      return row;
    } catch (err) {
      if (isUniqueViolation(err, "users_username_lower")) throw new AuthError("That username is taken.");
      if (!isUniqueViolation(err, "users_friend_code")) throw err; // otherwise: code collision, try another
    }
  }
  throw new Error("Could not generate a unique friend code.");
}

/** Check a username and password, with throttling. Returns the user or throws AuthError. */
export async function verifyLogin(db: DB, input: { username: string; password: string; ip?: string }): Promise<CurrentUser> {
  const name = input.username.trim().toLowerCase();
  const keys = [`user:${name}`, ...(input.ip ? [`ip:${input.ip}`] : [])];
  const since = new Date(Date.now() - FAILURE_WINDOW_MS);

  for (const key of keys) {
    const [{ n }] = await db
      .select({ n: count() })
      .from(loginFailures)
      .where(and(eq(loginFailures.key, key), gt(loginFailures.at, since)));
    const limit = key.startsWith("ip:") ? MAX_FAILURES_PER_IP : MAX_FAILURES_PER_USER;
    if (n >= limit) throw new AuthError("Too many failed attempts. Try again in 15 minutes.");
  }

  const [user] = await db.select().from(users).where(sql`lower(${users.username}) = ${name}`).limit(1);
  const ok = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) {
    await db.delete(loginFailures).where(lt(loginFailures.at, since));
    await db.insert(loginFailures).values(keys.map((key) => ({ key })));
    throw new AuthError("Wrong username or password.");
  }
  await db.delete(loginFailures).where(eq(loginFailures.key, `user:${name}`));
  return { id: user.id, username: user.username, isAdmin: user.isAdmin, friendCode: user.friendCode };
}

export async function createSession(db: DB, userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ id: sessionIdFromToken(token), userId, expiresAt });
  return { token, expiresAt };
}

export async function userFromSessionToken(db: DB, token: string): Promise<CurrentUser | null> {
  const [row] = await db
    .select({ id: users.id, username: users.username, isAdmin: users.isAdmin, friendCode: users.friendCode })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sessionIdFromToken(token)), gt(sessions.expiresAt, sql`now()`))) // DB clock: this runs during page renders
    .limit(1);
  return row ?? null;
}

export async function deleteSession(db: DB, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionIdFromToken(token)));
}

// ---------- friends ----------

/** Connect two users both ways. Returns the friend's username. */
export async function addFriendByCode(db: DB, userId: string, rawCode: string): Promise<string> {
  const code = normalizeFriendCode(rawCode);
  if (!code) throw new AuthError("Friend codes look like ABCD-2345.");
  const [friend] = await db.select({ id: users.id, username: users.username }).from(users).where(eq(users.friendCode, code));
  if (!friend) throw new AuthError("No one has that friend code.");
  if (friend.id === userId) throw new AuthError("That's your own code.");
  await db
    .insert(friendships)
    .values([
      { userId, friendId: friend.id },
      { userId: friend.id, friendId: userId },
    ])
    .onConflictDoNothing();
  return friend.username;
}

export async function removeFriend(db: DB, userId: string, friendId: string): Promise<void> {
  await db
    .delete(friendships)
    .where(
      sql`(${friendships.userId} = ${userId} and ${friendships.friendId} = ${friendId}) or (${friendships.userId} = ${friendId} and ${friendships.friendId} = ${userId})`,
    );
}

export async function listFriends(db: DB, userId: string): Promise<{ id: string; username: string; since: Date }[]> {
  return db
    .select({ id: users.id, username: users.username, since: friendships.createdAt })
    .from(friendships)
    .innerJoin(users, eq(users.id, friendships.friendId))
    .where(eq(friendships.userId, userId))
    .orderBy(sql`lower(${users.username})`);
}

export async function areFriends(db: DB, userId: string, otherId: string): Promise<boolean> {
  const [row] = await db
    .select({ one: sql`1` })
    .from(friendships)
    .where(and(eq(friendships.userId, userId), eq(friendships.friendId, otherId)))
    .limit(1);
  return Boolean(row);
}

/** New code for a user (e.g. if they shared it too widely). Existing friends are kept. */
export async function regenerateFriendCode(db: DB, userId: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newFriendCode();
    try {
      await db.update(users).set({ friendCode: code }).where(eq(users.id, userId));
      return code;
    } catch (err) {
      if (!isUniqueViolation(err, "users_friend_code")) throw err;
    }
  }
  throw new Error("Could not generate a unique friend code.");
}
