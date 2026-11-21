import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import { series, userSettings } from "@/db/schema";
import { testDb } from "@/test/db";
import { createAccount } from "./auth/accounts";
import {
  DEFAULT_READER,
  getReaderSettings,
  getSeriesReaderSettings,
  makeSeriesSettingsDefault,
  resetSeriesReaderSettings,
  saveReaderSettings,
  saveSeriesReaderSettings,
} from "./settings";

let db: DB;
let userId: string;
let manga: string;
let webtoon: string;
beforeEach(async () => {
  db = await testDb();
  userId = (await createAccount(db, { username: "reader", password: "password1" }, { allowOpenSignup: true })).id;
  const rows = await db
    .insert(series)
    .values([
      { source: "fake", sourceId: "M", title: "Manga", url: "https://x/m" },
      { source: "fake", sourceId: "W", title: "Webtoon", url: "https://x/w" },
    ])
    .returning({ id: series.id });
  [manga, webtoon] = rows.map((r) => r.id);
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
    await expect(saveSeriesReaderSettings(db, userId, manga, { layout: "sideways" })).rejects.toThrow();
  });
});

describe("per-series reader settings", () => {
  it("changes made in one series stay in that series", async () => {
    await saveSeriesReaderSettings(db, userId, manga, { layout: "double", direction: "rtl" });
    expect(await getSeriesReaderSettings(db, userId, manga)).toMatchObject({ settings: { layout: "double", direction: "rtl" }, customized: true });
    expect(await getSeriesReaderSettings(db, userId, webtoon)).toMatchObject({ settings: { layout: "strip", direction: "ltr" }, customized: false });
    expect((await getReaderSettings(db, userId)).layout).toBe("strip"); // defaults untouched
  });

  it("untouched keys keep following the defaults", async () => {
    await saveSeriesReaderSettings(db, userId, manga, { layout: "double" });
    await saveReaderSettings(db, userId, { fit: "height" });
    expect((await getSeriesReaderSettings(db, userId, manga)).settings).toMatchObject({ layout: "double", fit: "height" });
  });

  it("reset makes a series follow the defaults again", async () => {
    await saveSeriesReaderSettings(db, userId, manga, { layout: "double" });
    expect((await resetSeriesReaderSettings(db, userId, manga)).layout).toBe("strip");
    expect((await getSeriesReaderSettings(db, userId, manga)).customized).toBe(false);
  });

  it("a series' settings can become the defaults", async () => {
    await saveSeriesReaderSettings(db, userId, manga, { layout: "single", fit: "both" });
    await makeSeriesSettingsDefault(db, userId, manga);
    expect(await getReaderSettings(db, userId)).toMatchObject({ layout: "single", fit: "both" });
    expect((await getSeriesReaderSettings(db, userId, webtoon)).settings.layout).toBe("single");
    expect((await getSeriesReaderSettings(db, userId, manga)).customized).toBe(false);
  });
});
