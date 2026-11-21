/**
 * Database client.
 *
 * - DATABASE_URL set (Vercel + Neon): Neon's serverless driver. Migrations run in `vercel-build`.
 * - DATABASE_URL unset (local dev): PGlite in .data/pglite, migrated at server start (see ./local.ts),
 *   so `pnpm dev` works with no setup.
 *
 * Inside page renders, prefer SQL `now()` over `new Date()`: Next rejects clock reads while prefetching pages.
 */
import "server-only";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { connection } from "next/server";
import { openLocalDb } from "./local";
import * as schema from "./schema";

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

async function connect(): Promise<DB> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool } = await import("@neondatabase/serverless");
    const { drizzle } = await import("drizzle-orm/neon-serverless");
    return drizzle({ client: new Pool({ connectionString: url }), schema }) as unknown as DB;
  }
  if (process.env.VERCEL) {
    throw new Error("DATABASE_URL is not set. Add a Neon database in the Vercel dashboard (Storage tab), then redeploy.");
  }
  return (await openLocalDb()) as DB;
}

// One client per server instance; survives dev hot reloads.
const g = globalThis as unknown as { alexandriaDb?: Promise<DB> };

/**
 * The database, for request-time code (pages, Server Actions, Route Handlers). `connection()` tells Next
 * this read belongs to the request: PGlite runs in-process, so without it Next would try to prerender the query.
 */
export async function getDb(): Promise<DB> {
  await connection();
  g.alexandriaDb ??= connect().catch((err) => {
    g.alexandriaDb = undefined; // let the next request retry
    throw err;
  });
  return g.alexandriaDb;
}

export { schema };
