import { defineConfig } from "drizzle-kit";

// `pnpm db:generate` writes SQL migrations to ./drizzle after you change src/db/schema.ts.
// On Vercel, `vercel-build` applies them to Neon before each build.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
