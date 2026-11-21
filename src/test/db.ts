import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { DB } from "@/db";
import * as schema from "@/db/schema";

/** A fresh, migrated, in-memory Postgres for one test file. */
export async function testDb(): Promise<DB> {
  const db = drizzle({ client: new PGlite(), schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  return db as unknown as DB;
}
