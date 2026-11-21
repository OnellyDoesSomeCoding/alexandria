/**
 * Local development database: PGlite (real Postgres in-process) stored in .data/pglite.
 * Opened and migrated once at server start from instrumentation.ts, outside any page render, because
 * Next refuses clock reads (which migrations do) while prerendering or prefetching a page.
 */
import { mkdirSync } from "node:fs";
import * as schema from "./schema";

const DIR = ".data/pglite";
const g = globalThis as unknown as { alexandriaLocalDb?: Promise<unknown> };

export function openLocalDb(): Promise<unknown> {
  g.alexandriaLocalDb ??= (async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    mkdirSync(DIR, { recursive: true });
    const db = drizzle({ client: new PGlite(DIR), schema });
    await migrate(db, { migrationsFolder: "drizzle" });
    return db;
  })();
  return g.alexandriaLocalDb;
}
