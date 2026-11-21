import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// ---------- accounts ----------

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    username: text("username").notNull(), // shown as typed; uniqueness is case-insensitive
    passwordHash: text("password_hash").notNull(),
    friendCode: text("friend_code").notNull(),
    isAdmin: boolean("is_admin").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_username_lower").on(sql`lower(${t.username})`), uniqueIndex("users_friend_code").on(t.friendCode)],
);

/** One row per signed-in browser. `id` is the SHA-256 of the cookie token, so a leaked table can't be replayed. */
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user").on(t.userId)],
);

/** Failed logins, for throttling. `key` is "user:<lowercased name>" or "ip:<address>". Old rows are pruned on write. */
export const loginFailures = pgTable(
  "login_failures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("login_failures_key_at").on(t.key, t.at)],
);

/** Stored both ways round (A->B and B->A) so "my friends" is a single lookup. */
export const friendships = pgTable(
  "friendships",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    friendId: uuid("friend_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.friendId] })],
);

export type ReaderLayout = "single" | "double" | "strip";
export type ReaderFit = "width" | "height" | "both" | "original";
export interface ReaderSettings {
  layout: ReaderLayout;
  fit: ReaderFit;
  direction: "ltr" | "rtl"; // page order: which page of a spread sits on the right
  turn: "ltr" | "rtl"; // page turning: "ltr" = right side / right arrow goes forward, "rtl" = left goes forward
  coverAlone: boolean; // double-page: show the first page by itself
  stripGap: number; // px between pages in long strip
  maxWidth: number; // px cap for long strip, 0 = none
}

export const userSettings = pgTable("user_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  reader: jsonb("reader").$type<Partial<ReaderSettings>>().notNull().default({}),
});

/**
 * Reader settings changed while reading a particular series. Only the changed keys are stored, so anything
 * not customised for the series keeps following the user's defaults (user_settings.reader).
 */
export const seriesReaderSettings = pgTable(
  "series_reader_settings",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    seriesId: uuid("series_id")
      .notNull()
      .references(() => series.id, { onDelete: "cascade" }),
    reader: jsonb("reader").$type<Partial<ReaderSettings>>().notNull().default({}),
  },
  (t) => [primaryKey({ columns: [t.userId, t.seriesId] })],
);

// ---------- manga (shared by all users, scraped once) ----------

export const series = pgTable(
  "series",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(), // Source.key, e.g. "weebcentral"
    sourceId: text("source_id").notNull(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    coverUrl: text("cover_url"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("series_source").on(t.source, t.sourceId)],
);

export const chapters = pgTable(
  "chapters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seriesId: uuid("series_id")
      .notNull()
      .references(() => series.id, { onDelete: "cascade" }),
    sourceId: text("source_id").notNull(),
    name: text("name").notNull(),
    number: doublePrecision("number"), // null for unnumbered extras
    position: integer("position").notNull(), // reading order within the series
    pageUrls: jsonb("page_urls").$type<string[]>(), // filled the first time anyone opens the chapter
    createdAt: createdAt(), // first time we saw it, drives "new" badges
  },
  (t) => [uniqueIndex("chapters_source").on(t.seriesId, t.sourceId), index("chapters_order").on(t.seriesId, t.position)],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    seriesId: uuid("series_id")
      .notNull()
      .references(() => series.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.seriesId] }), index("subscriptions_series").on(t.seriesId)],
);

export const readingProgress = pgTable(
  "reading_progress",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    page: integer("page").notNull().default(0),
    completed: boolean("completed").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.chapterId] }), index("reading_progress_recent").on(t.userId, t.updatedAt)],
);
