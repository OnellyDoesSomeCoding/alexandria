# Alexandria

A manga library for you and your friends. Subscribe to a series by pasting its link, and Alexandria lists every chapter. You can read in the browser or download chapters as PDF. Supported sites: WeebCentral, with more planned.

Next.js 16 · TypeScript · Postgres (Neon) via Drizzle · hosted on Vercel (free tier).

## Run locally

```powershell
pnpm install
pnpm dev          # http://localhost:3000
```

No database setup is needed locally. Without `DATABASE_URL`, the app uses PGlite, a real Postgres running in-process, and stores it in `.data/pglite`. Delete that folder to start fresh. The first account you create becomes the admin. In development anyone can sign up.

```powershell
pnpm test         # unit tests (parsers, accounts, friends) against an in-memory Postgres
pnpm lint
```

## Deploy (Vercel)

1. Import the GitHub repo in Vercel.
2. **Storage → Create → Neon (Postgres)**, then connect it to the project. This sets `DATABASE_URL`.
3. **Settings → Environment Variables**: add `SIGNUP_CODE` (any phrase). Give it to friends so they can sign up. Without it, sign-ups are closed after the first account. Also add `CRON_SECRET` (any long random string) so the daily new-chapter check can run.
4. Redeploy. `vercel-build` applies database migrations before building.

| Variable | Needed | Meaning |
|---|---|---|
| `DATABASE_URL` | yes, on Vercel | Neon connection string (set by the Neon integration) |
| `SIGNUP_CODE` | recommended | Shared code required to create an account (except the first) |
| `CRON_SECRET` | for the daily check | Vercel sends it to `/api/cron/check-chapters`; without it the job refuses to run |

Open `/api/health` on the deployed site to check that the database is connected and migrated.

The daily check for new chapters (`vercel.json`) runs at 21:00 UTC (04:00 in Bangkok). On the free plan Vercel may run it any time within that hour.

## Changing the database

Edit `src/db/schema.ts`, then run `pnpm db:generate` to write a SQL migration in `drizzle/`. Commit it. The next deploy applies it.

## Layout

- `src/lib/sources/`: one adapter per manga site behind the `Source` interface (`types.ts`). Add a site by implementing it and registering it in `index.ts`.
- `src/lib/library.ts`: subscriptions, chapter syncing, reading progress, reader data.
- `src/lib/pdf-client.ts`: builds bookmarked PDFs in the browser (pages come through `/api/chapters/:id/pages/:n`).
- `src/app/read/[chapterId]/`: the reader.
- `src/lib/auth/`: passwords (scrypt), sessions (hashed tokens in Postgres), friend codes.
- `src/db/`: schema and database client.
- `src/app/(auth)`: login and sign-up. `src/app/(app)`: everything behind login.
- `src/proxy.ts`: sends signed-out visitors to `/login` (a cookie check only; pages verify the session).
