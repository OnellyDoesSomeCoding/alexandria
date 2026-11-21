// Applies ./drizzle migrations to the app's database. Runs before each Vercel build (see "vercel-build").
// On Vercel a missing database fails the build loudly, so a deploy never goes live without its tables.
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";

// Keep in sync with databaseUrl() in src/db/index.ts.
const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) {
  const dbVars = Object.keys(process.env).filter((k) => /DATABASE|POSTGRES|PG|NEON/.test(k));
  const message =
    "[migrate] No DATABASE_URL (or POSTGRES_URL) in this build's environment." +
    (dbVars.length ? ` Found these database-looking variables instead: ${dbVars.join(", ")}.` : "") +
    " In Vercel: Storage > your Neon database > connect it to this project for this environment, then redeploy.";
  if (process.env.VERCEL) {
    console.error(message);
    process.exit(1);
  }
  console.warn(message + " Skipping (local build).");
  process.exit(0);
}

const pool = new Pool({ connectionString: url });
try {
  await migrate(drizzle({ client: pool }), { migrationsFolder: "drizzle" });
  console.log("[migrate] database is up to date");
} catch (err) {
  console.error("[migrate] failed:", err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
