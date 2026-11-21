import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getDb } from "@/db";
import { listUsers } from "@/lib/auth/accounts";
import { requireUser } from "@/lib/auth/session";
import { UserActions } from "./admin-controls";

export const metadata: Metadata = { title: "Admin" };

export default function AdminPage() {
  return (
    <Suspense fallback={<p className="text-neutral-500">Loading…</p>}>
      <Admin />
    </Suspense>
  );
}

const date = (d: Date | null) => (d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "never");

async function Admin() {
  const me = await requireUser();
  if (!me.isAdmin) notFound(); // non-admins get a plain 404, same as a missing page
  const users = await listUsers(await getDb());

  const checks = [
    { label: "Sign-up code (SIGNUP_CODE)", ok: Boolean(process.env.SIGNUP_CODE), missing: "not set: nobody else can sign up on the live site" },
    { label: "Daily new-chapter check (CRON_SECRET)", ok: Boolean(process.env.CRON_SECRET), missing: "not set: the daily check won't run" },
  ];

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">Admin</h1>
        <ul className="flex flex-col gap-1 text-sm">
          {checks.map((c) => (
            <li key={c.label}>
              <span className={c.ok ? "text-green-700 dark:text-green-400" : "text-amber-700 dark:text-amber-400"}>{c.ok ? "✓" : "!"}</span> {c.label}:{" "}
              {c.ok ? "set" : c.missing}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Accounts ({users.length})</h2>
        <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
          {users.map((u) => (
            <li key={u.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex flex-col">
                <span className="font-medium">
                  {u.username}
                  {u.isAdmin && <span className="ml-2 rounded bg-neutral-200 px-1.5 py-0.5 text-xs dark:bg-neutral-800">admin</span>}
                  {u.id === me.id && <span className="ml-2 text-xs text-neutral-500">(you)</span>}
                </span>
                <span className="text-xs text-neutral-500">
                  Joined {date(u.createdAt)} · last active {date(u.lastActive)} · {u.subscriptions} subscribed
                </span>
              </div>
              {u.id !== me.id && <UserActions userId={u.id} username={u.username} protectedAccount={u.isAdmin} />}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
