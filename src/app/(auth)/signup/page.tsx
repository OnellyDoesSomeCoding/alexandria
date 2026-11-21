import type { Metadata } from "next";
import { count } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { SignupForm } from "../auth-form";

export const metadata: Metadata = { title: "Create account" };

export default function SignupPage() {
  return (
    <>
      <h1 className="text-lg font-medium">Create an account</h1>
      <Suspense fallback={<p className="text-sm text-neutral-500">Loading…</p>}>
        <SignupGate />
      </Suspense>
    </>
  );
}

async function SignupGate() {
  if (await getCurrentUser()) redirect("/");
  const [{ total }] = await (await getDb()).select({ total: count() }).from(users);
  const isFirst = total === 0;
  const hasCode = Boolean(process.env.SIGNUP_CODE);
  const openInDev = process.env.NODE_ENV !== "production";

  if (!isFirst && !hasCode && !openInDev) {
    return (
      <p className="text-sm">
        Sign-ups are closed. Ask the site owner for a sign-up code, or{" "}
        <Link href="/login" className="underline">
          sign in
        </Link>
        .
      </p>
    );
  }
  return (
    <>
      {isFirst && <p className="text-sm text-neutral-500">You&apos;re the first one here, so this account will be the admin.</p>}
      <SignupForm needsCode={!isFirst && hasCode} />
    </>
  );
}
