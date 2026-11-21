"use client";

import { useActionState } from "react";
import { type ActionMessage, subscribe } from "@/app/actions/library";
import { Button, ErrorText, inputClass } from "@/components/ui";

export function SubscribeForm() {
  const [state, action, pending] = useActionState(subscribe, {} as ActionMessage);
  return (
    <form action={action} className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          name="link"
          type="url"
          required
          placeholder="https://weebcentral.com/series/…"
          aria-label="Series link"
          className={`${inputClass} sm:flex-1`}
        />
        <Button type="submit" disabled={pending}>
          {pending ? "Fetching chapters…" : "Subscribe"}
        </Button>
      </div>
      <ErrorText>{state.error}</ErrorText>
    </form>
  );
}
