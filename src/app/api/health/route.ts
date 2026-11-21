/**
 * Setup check: open /api/health to see whether the database is configured, reachable and migrated.
 * Reveals no secrets: only which variable names exist, and table/migration counts.
 */
import { sql } from "drizzle-orm";
import { databaseUrl, getDb } from "@/db";

export async function GET() {
  const report: Record<string, unknown> = {
    region: process.env.VERCEL_REGION ?? "local",
    databaseUrlSet: Boolean(databaseUrl()),
    databaseLookingVariables: Object.keys(process.env).filter((k) => /DATABASE|POSTGRES|NEON/.test(k)),
    signupCodeSet: Boolean(process.env.SIGNUP_CODE),
  };
  try {
    const db = await getDb();
    const tables = await db.execute<{ users: string | null; migrations: string | null }>(
      sql`select to_regclass('public.users')::text as users, to_regclass('drizzle.__drizzle_migrations')::text as migrations`,
    );
    const row = (tables as unknown as { rows: { users: string | null; migrations: string | null }[] }).rows[0];
    report.connected = true;
    report.tablesCreated = Boolean(row?.users);
    if (row?.migrations) {
      const applied = await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
      report.migrationsApplied = (applied as unknown as { rows: { n: number }[] }).rows[0]?.n ?? 0;
    }
    if (row?.users) {
      const users = await db.execute(sql`select count(*)::int as n from users`);
      report.accounts = (users as unknown as { rows: { n: number }[] }).rows[0]?.n ?? 0;
    }
  } catch (err) {
    report.connected = false;
    // Strip anything that looks like a connection string before showing the error.
    report.error = String(err instanceof Error ? (err.cause ?? err.message) : err).replace(/postgres(ql)?:\/\/\S+/g, "postgres://…");
  }
  const ok = report.connected === true && report.tablesCreated === true;
  return Response.json({ ok, ...report }, { status: ok ? 200 : 500 });
}
