"use client";

import { useState, useTransition } from "react";
import { deleteAccount, type ResetState, resetPasswordFor } from "@/app/actions/account";
import { SubtleButton } from "@/components/ui";

export function UserActions({ userId, username, protectedAccount }: { userId: string; username: string; protectedAccount: boolean }) {
  const [pending, startTransition] = useTransition();
  const [reset, setReset] = useState<ResetState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const onReset = () => {
    if (!window.confirm(`Give ${username} a new temporary password? They'll be signed out everywhere.`)) return;
    setError(null);
    startTransition(async () => {
      const result = await resetPasswordFor(userId);
      if (result.error) setError(result.error);
      else setReset(result);
    });
  };
  const onDelete = () => {
    if (!window.confirm(`Delete ${username}? Their library, reading progress and friends are removed. This can't be undone.`)) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteAccount(userId);
      if (result.error) setError(result.error);
    });
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        <SubtleButton type="button" disabled={pending} onClick={onReset}>
          Reset password
        </SubtleButton>
        {!protectedAccount && (
          <SubtleButton type="button" disabled={pending} onClick={onDelete} className="text-red-600 dark:text-red-400">
            Delete
          </SubtleButton>
        )}
      </div>
      {reset?.password && (
        <div className="flex flex-col items-end gap-1 rounded-md bg-neutral-100 p-2 text-sm dark:bg-neutral-900">
          <span>
            New password for <strong>{reset.username}</strong>:
          </span>
          <div className="flex items-center gap-2">
            <code className="font-mono text-base tracking-wider">{reset.password}</code>
            <SubtleButton
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(reset.password!);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </SubtleButton>
          </div>
          <span className="text-xs text-neutral-500">Shown once. Send it to them; they can change it on their Profile page.</span>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
