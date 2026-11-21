"use client";

import { useActionState, useState } from "react";
import { addFriend, type FriendFormState } from "@/app/actions/friends";
import { Button, ErrorText, inputClass, SubtleButton } from "@/components/ui";

export function AddFriendForm() {
  const [state, action, pending] = useActionState(addFriend, {} as FriendFormState);
  return (
    <form action={action} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input name="code" placeholder="ABCD-2345" aria-label="Friend code" autoComplete="off" required className={`${inputClass} max-w-48 font-mono uppercase`} />
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add friend"}
        </Button>
      </div>
      <ErrorText>{state.error}</ErrorText>
      {state.added && <p className="text-sm text-green-700 dark:text-green-400">You and {state.added} are now friends.</p>}
    </form>
  );
}

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <SubtleButton
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "Copied" : "Copy"}
    </SubtleButton>
  );
}
