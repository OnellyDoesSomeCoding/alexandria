"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useActionState } from "react";
import { type FormState, login, signup } from "@/app/actions/auth";
import { Button, ErrorText, Field } from "@/components/ui";

export function LoginForm() {
  const next = useSearchParams().get("next") ?? "/";
  const [state, action, pending] = useActionState(login, {} as FormState);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <Field label="Username" name="username" autoComplete="username" required defaultValue={state.username} />
      <Field label="Password" name="password" type="password" autoComplete="current-password" required />
      <ErrorText>{state.error}</ErrorText>
      <Button type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-sm text-neutral-500">
        New here?{" "}
        <Link href="/signup" className="underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}

export function SignupForm({ needsCode }: { needsCode: boolean }) {
  const [state, action, pending] = useActionState(signup, {} as FormState);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Username" name="username" autoComplete="username" required minLength={3} maxLength={24} defaultValue={state.username} />
      <Field label="Password" name="password" type="password" autoComplete="new-password" required minLength={8} />
      <Field label="Confirm password" name="confirm" type="password" autoComplete="new-password" required minLength={8} />
      {needsCode && <Field label="Sign-up code" name="signupCode" autoComplete="off" required />}
      <ErrorText>{state.error}</ErrorText>
      <Button type="submit" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>
      <p className="text-sm text-neutral-500">
        Already have an account?{" "}
        <Link href="/login" className="underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
