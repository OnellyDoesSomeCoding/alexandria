"use client";

import Link from "next/link";
import { useActionState, useMemo, useState, useTransition } from "react";
import { type ActionMessage, checkNow, markReadUpTo, setRead } from "@/app/actions/library";
import { ErrorText, SubtleButton } from "@/components/ui";
import type { ChapterRow } from "@/lib/library";

export function CheckButton({ seriesId }: { seriesId: string }) {
  const [state, action, pending] = useActionState(checkNow.bind(null, seriesId), {} as ActionMessage);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <SubtleButton type="submit" disabled={pending}>
        {pending ? "Checking…" : "Check for new chapters"}
      </SubtleButton>
      {state.message && <span className="text-sm text-neutral-500">{state.message}</span>}
      <ErrorText>{state.error}</ErrorText>
    </form>
  );
}

const DAY = 24 * 60 * 60 * 1000;

export function ChapterList({ chapters, subscribedAt }: { chapters: ChapterRow[]; subscribedAt: string | null }) {
  const [newestFirst, setNewestFirst] = useState(true);
  const [pending, startTransition] = useTransition();
  const [now] = useState(() => Date.now());
  const ordered = useMemo(() => (newestFirst ? [...chapters].reverse() : chapters), [chapters, newestFirst]);
  const since = subscribedAt ? new Date(subscribedAt).getTime() : null;

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{chapters.length} chapters</h2>
        <SubtleButton type="button" onClick={() => setNewestFirst((v) => !v)}>
          {newestFirst ? "Newest first" : "Oldest first"}
        </SubtleButton>
      </div>
      <ul className={`divide-y divide-neutral-200 dark:divide-neutral-800 ${pending ? "opacity-70" : ""}`}>
        {ordered.map((c) => {
          const created = new Date(c.createdAt).getTime();
          const isNew = !c.completed && since !== null && created > since && now - created < 14 * DAY;
          return (
            <li key={c.id} className="flex items-center gap-3 py-2">
              <Link href={`/read/${c.id}`} className={`min-w-0 flex-1 truncate ${c.completed ? "text-neutral-400 dark:text-neutral-600" : ""}`}>
                {c.name}
                {isNew && <span className="ml-2 rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">new</span>}
                {!c.completed && c.page !== null && c.page > 0 && <span className="ml-2 text-xs text-neutral-500">page {c.page + 1}</span>}
              </Link>
              <button
                type="button"
                title="Mark this and every earlier chapter as read"
                className="hidden text-xs text-neutral-500 hover:text-neutral-900 sm:block dark:hover:text-neutral-100"
                onClick={() => startTransition(() => markReadUpTo(c.id))}
              >
                read up to here
              </button>
              <button
                type="button"
                aria-label={c.completed ? `Mark ${c.name} unread` : `Mark ${c.name} read`}
                aria-pressed={c.completed}
                className={`h-6 w-6 shrink-0 rounded border text-xs ${c.completed ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900" : "border-neutral-300 dark:border-neutral-700"}`}
                onClick={() => startTransition(() => setRead(c.id, !c.completed))}
              >
                {c.completed ? "✓" : ""}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
