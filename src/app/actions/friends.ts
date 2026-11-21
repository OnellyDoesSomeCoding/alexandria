"use server";

import { refresh } from "next/cache";
import { getDb } from "@/db";
import { addFriendByCode, AuthError, regenerateFriendCode, removeFriend } from "@/lib/auth/accounts";
import { requireUser } from "@/lib/auth/session";

export interface FriendFormState {
  error?: string;
  added?: string;
}

export async function addFriend(_prev: FriendFormState, formData: FormData): Promise<FriendFormState> {
  const user = await requireUser();
  try {
    const added = await addFriendByCode(await getDb(), user.id, String(formData.get("code") ?? ""));
    refresh();
    return { added };
  } catch (err) {
    if (err instanceof AuthError) return { error: err.message };
    throw err;
  }
}

export async function unfriend(friendId: string): Promise<void> {
  const user = await requireUser();
  await removeFriend(await getDb(), user.id, friendId);
  refresh();
}

export async function newFriendCode(): Promise<void> {
  const user = await requireUser();
  await regenerateFriendCode(await getDb(), user.id);
  refresh();
}
