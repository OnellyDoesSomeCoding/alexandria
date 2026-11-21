"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { type ActionMessage, checkNow, markReadUpTo, markUnreadFrom, setRead } from "@/app/actions/library";
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
  const [menuFor, setMenuFor] = useState<string | null>(null); // chapter whose ⋯ menu is open
  const act = (action: () => Promise<void>) => {
    setMenuFor(null);
    startTransition(action);
  };
  // Close the menu when tapping anywhere else or pressing Escape.
  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuFor]);
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
              <div className="relative">
                <button
                  type="button"
                  aria-label={`More for ${c.name}`}
                  aria-expanded={menuFor === c.id}
                  aria-haspopup="menu"
                  className="h-6 w-7 rounded text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuFor((open) => (open === c.id ? null : c.id));
                  }}
                >
                  ⋯
                </button>
                {menuFor === c.id && (
                  <div
                    role="menu"
                    className="absolute right-0 top-7 z-10 flex w-48 flex-col overflow-hidden rounded-md border border-neutral-200 bg-white text-sm shadow-lg dark:border-neutral-800 dark:bg-neutral-900"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MenuItem onSelect={() => act(() => markReadUpTo(c.id))}>Read up to here</MenuItem>
                    <MenuItem onSelect={() => act(() => markUnreadFrom(c.id))}>Unread from here</MenuItem>
                  </div>
                )}
              </div>
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

function MenuItem({ onSelect, children }: { onSelect: () => void; children: string }) {
  return (
    <button type="button" role="menuitem" className="px-3 py-2 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800" onClick={onSelect}>
      {children}
    </button>
  );
}
