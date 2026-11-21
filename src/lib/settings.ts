import { eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { type ReaderSettings, userSettings } from "@/db/schema";

export const DEFAULT_READER: ReaderSettings = {
  layout: "strip",
  fit: "width",
  direction: "ltr",
  coverAlone: true,
  stripGap: 0,
  maxWidth: 900,
};

export const readerSettingsSchema = z
  .object({
    layout: z.enum(["single", "double", "strip"]),
    fit: z.enum(["width", "height", "both", "original"]),
    direction: z.enum(["ltr", "rtl"]),
    coverAlone: z.boolean(),
    stripGap: z.number().int().min(0).max(100),
    maxWidth: z.number().int().min(0).max(4000),
  })
  .partial();

export async function getReaderSettings(db: DB, userId: string): Promise<ReaderSettings> {
  const [row] = await db.select({ reader: userSettings.reader }).from(userSettings).where(eq(userSettings.userId, userId));
  // Ignore anything stored by an older version that no longer validates.
  const saved = readerSettingsSchema.safeParse(row?.reader ?? {});
  return { ...DEFAULT_READER, ...(saved.success ? saved.data : {}) };
}

export async function saveReaderSettings(db: DB, userId: string, changes: unknown): Promise<ReaderSettings> {
  const next = { ...(await getReaderSettings(db, userId)), ...readerSettingsSchema.parse(changes) };
  await db.insert(userSettings).values({ userId, reader: next }).onConflictDoUpdate({ target: userSettings.userId, set: { reader: next } });
  return next;
}
