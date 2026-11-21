/**
 * Reader settings come in two layers: the user's defaults, and per-series changes on top. Changing a setting
 * while reading saves it for that series only, so a webtoon can stay in long strip while a manga stays in
 * double page right-to-left. Series without changes follow the defaults.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { type ReaderSettings, seriesReaderSettings, userSettings } from "@/db/schema";

export const DEFAULT_READER: ReaderSettings = {
  layout: "strip",
  fit: "width",
  direction: "ltr",
  turn: "ltr",
  coverAlone: true,
  stripGap: 0,
  maxWidth: 900,
};

export const readerSettingsSchema = z
  .object({
    layout: z.enum(["single", "double", "strip"]),
    fit: z.enum(["width", "height", "both", "original"]),
    direction: z.enum(["ltr", "rtl"]),
    turn: z.enum(["ltr", "rtl"]),
    coverAlone: z.boolean(),
    stripGap: z.number().int().min(0).max(100),
    maxWidth: z.number().int().min(0).max(4000),
  })
  .partial();

type Layer = z.infer<typeof readerSettingsSchema>;

/** Stored values that still validate (anything from an older version that doesn't is ignored). */
function clean(value: unknown): Layer {
  const parsed = readerSettingsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : {};
}

/** Page turning used to follow the direction; settings saved before it was separate keep behaving the same. */
function withTurn(layer: Layer): Layer {
  return layer.direction && !layer.turn ? { ...layer, turn: layer.direction } : layer;
}

async function defaultsLayer(db: DB, userId: string): Promise<Layer> {
  const [row] = await db.select({ reader: userSettings.reader }).from(userSettings).where(eq(userSettings.userId, userId));
  return withTurn(clean(row?.reader));
}

async function seriesLayer(db: DB, userId: string, seriesId: string): Promise<Layer> {
  const [row] = await db
    .select({ reader: seriesReaderSettings.reader })
    .from(seriesReaderSettings)
    .where(and(eq(seriesReaderSettings.userId, userId), eq(seriesReaderSettings.seriesId, seriesId)));
  return clean(row?.reader);
}

/** The user's defaults (used by any series they haven't customised). */
export async function getReaderSettings(db: DB, userId: string): Promise<ReaderSettings> {
  return { ...DEFAULT_READER, ...(await defaultsLayer(db, userId)) };
}

/** Settings for reading one series, plus whether that series has its own changes. */
export async function getSeriesReaderSettings(
  db: DB,
  userId: string,
  seriesId: string,
): Promise<{ settings: ReaderSettings; customized: boolean }> {
  const own = await seriesLayer(db, userId, seriesId);
  return { settings: { ...DEFAULT_READER, ...(await defaultsLayer(db, userId)), ...own }, customized: Object.keys(own).length > 0 };
}

/** Change the user's defaults. */
export async function saveReaderSettings(db: DB, userId: string, changes: unknown): Promise<ReaderSettings> {
  const next = { ...(await getReaderSettings(db, userId)), ...readerSettingsSchema.parse(changes) };
  await db.insert(userSettings).values({ userId, reader: next }).onConflictDoUpdate({ target: userSettings.userId, set: { reader: next } });
  return next;
}

/** Change settings for one series only (what the reader does when you change a setting). */
export async function saveSeriesReaderSettings(db: DB, userId: string, seriesId: string, changes: unknown): Promise<ReaderSettings> {
  const own = { ...(await seriesLayer(db, userId, seriesId)), ...readerSettingsSchema.parse(changes) };
  await db
    .insert(seriesReaderSettings)
    .values({ userId, seriesId, reader: own })
    .onConflictDoUpdate({ target: [seriesReaderSettings.userId, seriesReaderSettings.seriesId], set: { reader: own } });
  return (await getSeriesReaderSettings(db, userId, seriesId)).settings;
}

/** Forget a series' own settings so it follows the defaults again. Returns the settings now in effect. */
export async function resetSeriesReaderSettings(db: DB, userId: string, seriesId: string): Promise<ReaderSettings> {
  await db
    .delete(seriesReaderSettings)
    .where(and(eq(seriesReaderSettings.userId, userId), eq(seriesReaderSettings.seriesId, seriesId)));
  return getReaderSettings(db, userId);
}

/** Make this series' current settings the defaults for every series without its own changes. */
export async function makeSeriesSettingsDefault(db: DB, userId: string, seriesId: string): Promise<ReaderSettings> {
  const { settings } = await getSeriesReaderSettings(db, userId, seriesId);
  await saveReaderSettings(db, userId, settings);
  await resetSeriesReaderSettings(db, userId, seriesId); // now identical to the defaults
  return settings;
}
