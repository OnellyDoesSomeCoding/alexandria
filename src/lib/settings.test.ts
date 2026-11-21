import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import { userSettings } from "@/db/schema";
import { testDb } from "@/test/db";
import { createAccount } from "./auth/accounts";
import { DEFAULT_READER, getReaderSettings, saveReaderSettings } from "./settings";

let db: DB;
let userId: string;
beforeEach(async () => {
  db = await testDb();
  userId = (await createAccount(db, { username: "reader", password: "password1" }, { allowOpenSignup: true })).id;
});

describe("reader settings", () => {
  it("starts from the defaults", async () => {
    expect(await getReaderSettings(db, userId)).toEqual(DEFAULT_READER);
  });

  it("page direction and page turn are independent", async () => {
    await saveReaderSettings(db, userId, { direction: "rtl" });
    expect(await getReaderSettings(db, userId)).toMatchObject({ direction: "rtl", turn: "ltr" });
    await saveReaderSettings(db, userId, { turn: "rtl", direction: "ltr" });
    expect(await getReaderSettings(db, userId)).toMatchObject({ direction: "ltr", turn: "rtl" });
  });

  it("settings saved before page turn existed keep turning the way they did", async () => {
    await db.insert(userSettings).values({ userId, reader: { layout: "double", direction: "rtl" } });
    expect(await getReaderSettings(db, userId)).toMatchObject({ layout: "double", direction: "rtl", turn: "rtl" });
  });

  it("rejects invalid values", async () => {
    await expect(saveReaderSettings(db, userId, { turn: "sideways" })).rejects.toThrow();
  });
});
