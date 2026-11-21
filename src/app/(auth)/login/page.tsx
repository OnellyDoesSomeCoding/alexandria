import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth/session";
import { LoginForm } from "../auth-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <>
      <h1 className="text-lg font-medium">Sign in</h1>
      <Suspense fallback={null}>
        <RedirectIfSignedIn />
      </Suspense>
      <Suspense>
        <LoginForm />
      </Suspense>
    </>
  );
}

async function RedirectIfSignedIn() {
  if (await getCurrentUser()) redirect("/");
  return null;
}
