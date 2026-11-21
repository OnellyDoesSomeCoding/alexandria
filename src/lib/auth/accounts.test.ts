import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import { testDb } from "@/test/db";
import {
  addFriendByCode,
  AuthError,
  createAccount,
  createSession,
  deleteSession,
  listFriends,
  regenerateFriendCode,
  removeFriend,
  userFromSessionToken,
  verifyLogin,
} from "./accounts";
import { formatFriendCode, normalizeFriendCode } from "./codes";
import { hashPassword, verifyPassword } from "./password";

const open = { allowOpenSignup: true };
let db: DB;
beforeEach(async () => {
  db = await testDb();
});

describe("passwords", () => {
  it("verifies the right password only", async () => {
    const hash = await hashPassword("correct horse");
    expect(await verifyPassword("correct horse", hash)).toBe(true);
    expect(await verifyPassword("wrong horse", hash)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
});

describe("friend codes", () => {
  it("normalizes what people type", () => {
    expect(normalizeFriendCode("abcd-2345")).toBe("ABCD2345");
    expect(normalizeFriendCode(" ABCD 2345 ")).toBe("ABCD2345");
    expect(normalizeFriendCode("ABCD-O000")).toBeNull(); // O and 0 aren't in the alphabet
    expect(normalizeFriendCode("short")).toBeNull();
    expect(formatFriendCode("ABCD2345")).toBe("ABCD-2345");
  });
});

describe("sign-up", () => {
  it("makes the first account admin without a code", async () => {
    const first = await createAccount(db, { username: "Onelly", password: "password1" }, { signupCode: "secret", allowOpenSignup: false });
    expect(first.isAdmin).toBe(true);
    expect(first.friendCode).toHaveLength(8);
  });

  it("requires the sign-up code after the first account", async () => {
    const config = { signupCode: "secret", allowOpenSignup: false };
    await createAccount(db, { username: "owner", password: "password1" }, config);
    await expect(createAccount(db, { username: "friend", password: "password1" }, config)).rejects.toThrow(/sign-up code/);
    await expect(createAccount(db, { username: "friend", password: "password1", signupCode: "nope" }, config)).rejects.toThrow(AuthError);
    const friend = await createAccount(db, { username: "friend", password: "password1", signupCode: "secret" }, config);
    expect(friend.isAdmin).toBe(false);
  });

  it("is closed with no code configured unless open sign-up is allowed", async () => {
    const closed = { allowOpenSignup: false };
    await createAccount(db, { username: "owner", password: "password1" }, closed);
    await expect(createAccount(db, { username: "friend", password: "password1" }, closed)).rejects.toThrow(/closed/);
  });

  it("treats usernames case-insensitively", async () => {
    await createAccount(db, { username: "Onelly", password: "password1" }, open);
    await expect(createAccount(db, { username: "onelly", password: "password1" }, open)).rejects.toThrow(/taken/);
  });

  it("validates input", async () => {
    await expect(createAccount(db, { username: "ab", password: "password1" }, open)).rejects.toThrow(/at least 3/);
    await expect(createAccount(db, { username: "has space", password: "password1" }, open)).rejects.toThrow(/letters/);
    await expect(createAccount(db, { username: "okname", password: "short" }, open)).rejects.toThrow(/at least 8/);
  });
});

describe("login and sessions", () => {
  it("logs in with any username casing and rejects bad passwords", async () => {
    await createAccount(db, { username: "Onelly", password: "password1" }, open);
    expect((await verifyLogin(db, { username: "ONELLY", password: "password1" })).username).toBe("Onelly");
    await expect(verifyLogin(db, { username: "Onelly", password: "nope" })).rejects.toThrow(/Wrong username or password/);
    await expect(verifyLogin(db, { username: "nobody", password: "password1" })).rejects.toThrow(/Wrong username or password/);
  });

  it("locks a username after 10 failures, even with the right password", async () => {
    await createAccount(db, { username: "target", password: "password1" }, open);
    for (let i = 0; i < 10; i++) await verifyLogin(db, { username: "target", password: "bad" }).catch(() => {});
    await expect(verifyLogin(db, { username: "target", password: "password1" })).rejects.toThrow(/Too many/);
  });

  it("creates, reads and deletes sessions", async () => {
    const user = await createAccount(db, { username: "reader", password: "password1" }, open);
    const { token } = await createSession(db, user.id);
    expect((await userFromSessionToken(db, token))?.id).toBe(user.id);
    expect(await userFromSessionToken(db, "made-up-token")).toBeNull();
    await deleteSession(db, token);
    expect(await userFromSessionToken(db, token)).toBeNull();
  });
});

describe("friends", () => {
  it("connects both ways by code and disconnects both ways", async () => {
    const a = await createAccount(db, { username: "alice", password: "password1" }, open);
    const b = await createAccount(db, { username: "bob", password: "password1" }, open);

    expect(await addFriendByCode(db, a.id, formatFriendCode(b.friendCode).toLowerCase())).toBe("bob");
    expect(await addFriendByCode(db, a.id, b.friendCode)).toBe("bob"); // adding twice is harmless
    expect((await listFriends(db, a.id)).map((f) => f.username)).toEqual(["bob"]);
    expect((await listFriends(db, b.id)).map((f) => f.username)).toEqual(["alice"]);

    await removeFriend(db, b.id, a.id);
    expect(await listFriends(db, a.id)).toEqual([]);
    expect(await listFriends(db, b.id)).toEqual([]);
  });

  it("rejects own, unknown and malformed codes", async () => {
    const a = await createAccount(db, { username: "alice", password: "password1" }, open);
    await expect(addFriendByCode(db, a.id, a.friendCode)).rejects.toThrow(/own code/);
    await expect(addFriendByCode(db, a.id, "ZZZZ-ZZZZ")).rejects.toThrow(/No one/);
    await expect(addFriendByCode(db, a.id, "hello")).rejects.toThrow(/look like/);
  });

  it("regenerating a code keeps existing friends and retires the old code", async () => {
    const a = await createAccount(db, { username: "alice", password: "password1" }, open);
    const b = await createAccount(db, { username: "bob", password: "password1" }, open);
    const c = await createAccount(db, { username: "carol", password: "password1" }, open);
    await addFriendByCode(db, a.id, b.friendCode);
    const fresh = await regenerateFriendCode(db, b.id);
    expect(fresh).not.toBe(b.friendCode);
    expect((await listFriends(db, a.id)).map((f) => f.username)).toEqual(["bob"]);
    await expect(addFriendByCode(db, c.id, b.friendCode)).rejects.toThrow(/No one/);
    expect(await addFriendByCode(db, c.id, fresh)).toBe("bob");
  });
});
