"use client";

import { useActionState } from "react";
import { type ActionMessage, subscribe } from "@/app/actions/library";
import { ErrorText, SubtleButton } from "@/components/ui";

/** Subscribes through the same action as pasting a link, then lands on the series page. */
export function SubscribeButton({ link }: { link: string }) {
  const [state, action, pending] = useActionState(subscribe, {} as ActionMessage);
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="link" value={link} />
      <SubtleButton type="submit" disabled={pending} className="w-full">
        {pending ? "Adding…" : "Subscribe"}
      </SubtleButton>
      <ErrorText>{state.error}</ErrorText>
    </form>
  );
}
