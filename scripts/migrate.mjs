// Applies ./drizzle migrations to the database in DATABASE_URL. Runs before each Vercel build (see "vercel-build").
// Without DATABASE_URL it skips, so the build still succeeds before a database is connected.
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";

const url = process.env.DATABASE_URL;
if (!url) {
  console.warn("[migrate] DATABASE_URL is not set; skipping migrations. Connect a Neon database in Vercel > Storage.");
  process.exit(0);
}

const pool = new Pool({ connectionString: url });
try {
  await migrate(drizzle({ client: pool }), { migrationsFolder: "drizzle" });
  console.log("[migrate] database is up to date");
} finally {
  await pool.end();
}
