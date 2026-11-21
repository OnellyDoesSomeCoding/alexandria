"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ReaderSettings } from "@/db/schema";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/session";
import * as library from "@/lib/library";
import { saveReaderSettings } from "@/lib/settings";
import { SourceError } from "@/lib/sources";

export interface ActionMessage {
  error?: string;
  message?: string;
}

function explain(err: unknown): string {
  if (err instanceof SourceError || err instanceof library.LibraryError) return err.message;
  console.error(err);
  return "Something went wrong talking to the manga site. Please try again in a minute.";
}

const id = z.uuid();

export async function subscribe(_prev: ActionMessage, formData: FormData): Promise<ActionMessage> {
  const user = await requireUser();
  const link = String(formData.get("link") ?? "").trim();
  if (!link) return { error: "Paste a series link first." };
  let seriesId: string;
  try {
    ({ seriesId } = await library.subscribeByLink(await getDb(), user.id, link));
  } catch (err) {
    return { error: explain(err) };
  }
  redirect(`/series/${seriesId}`);
}

export async function subscribeTo(seriesId: string): Promise<void> {
  const user = await requireUser();
  const db = await getDb();
  const page = await library.getSeriesWithChapters(db, user.id, id.parse(seriesId));
  if (page) await library.subscribeByLink(db, user.id, page.url);
  refresh();
}

export async function unsubscribe(seriesId: string): Promise<void> {
  const user = await requireUser();
  await library.unsubscribe(await getDb(), user.id, id.parse(seriesId));
  refresh();
}

export async function checkNow(seriesId: string): Promise<ActionMessage> {
  await requireUser();
  try {
    const added = await library.checkForNewChapters(await getDb(), id.parse(seriesId));
    refresh();
    if (added === null) return { message: "Checked less than a minute ago. Try again shortly." };
    return { message: added === 0 ? "No new chapters." : `${added} new chapter${added === 1 ? "" : "s"} added.` };
  } catch (err) {
    return { error: explain(err) };
  }
}

export async function setRead(chapterId: string, completed: boolean): Promise<void> {
  const user = await requireUser();
  await library.setChapterRead(await getDb(), user.id, id.parse(chapterId), completed);
  refresh();
}

export async function markReadUpTo(chapterId: string): Promise<void> {
  const user = await requireUser();
  await library.markReadUpTo(await getDb(), user.id, id.parse(chapterId));
  refresh();
}

/** Called by the reader as you turn pages. No refresh: the reader keeps its own state. */
export async function saveProgress(chapterId: string, page: number, completed: boolean): Promise<void> {
  const user = await requireUser();
  await library.saveProgress(await getDb(), user.id, id.parse(chapterId), z.number().int().min(0).parse(page), completed === true);
}

export async function updateReaderSettings(changes: Partial<ReaderSettings>): Promise<ReaderSettings> {
  const user = await requireUser();
  return saveReaderSettings(await getDb(), user.id, changes);
}
