"use client";

import { useActionState, useRef } from "react";
import { type AccountFormState, changeOwnPassword } from "@/app/actions/account";
import { Button, ErrorText, Field } from "@/components/ui";

export function ChangePasswordForm() {
  const form = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(async (prev: AccountFormState, data: FormData) => {
    const result = await changeOwnPassword(prev, data);
    if (result.message) form.current?.reset();
    return result;
  }, {} as AccountFormState);

  return (
    <form ref={form} action={action} className="flex max-w-sm flex-col gap-3">
      <Field label="Current password" name="current" type="password" autoComplete="current-password" required />
      <Field label="New password" name="newPassword" type="password" autoComplete="new-password" required minLength={8} />
      <Field label="Confirm new password" name="confirm" type="password" autoComplete="new-password" required minLength={8} />
      <ErrorText>{state.error}</ErrorText>
      {state.message && <p className="text-sm text-green-700 dark:text-green-400">{state.message}</p>}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Changing…" : "Change password"}
      </Button>
    </form>
  );
}
