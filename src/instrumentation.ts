/** Runs once when a server instance starts, before it handles requests. */
export async function register() {
  const hasRemoteDb = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL);
  if (process.env.NEXT_RUNTIME === "nodejs" && !hasRemoteDb && !process.env.VERCEL) {
    const { openLocalDb } = await import("./db/local");
    await openLocalDb();
  }
}
