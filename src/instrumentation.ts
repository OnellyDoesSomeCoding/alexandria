/** Runs once when a server instance starts, before it handles requests. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && !process.env.DATABASE_URL && !process.env.VERCEL) {
    const { openLocalDb } = await import("./db/local");
    await openLocalDb();
  }
}
