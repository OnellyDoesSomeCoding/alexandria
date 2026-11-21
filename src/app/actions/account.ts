"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import { adminDeleteAccount, adminResetPassword, AuthError, changePassword } from "@/lib/auth/accounts";
import { requireUser, startSession } from "@/lib/auth/session";

export interface AccountFormState {
  error?: string;
  message?: string;
}

function messageFor(err: unknown): string {
  if (err instanceof AuthError) return err.message;
  if (err instanceof z.ZodError) return err.issues[0]?.message ?? "Please check the form.";
  console.error(err);
  return "Something went wrong. Please try again.";
}

const id = z.uuid();

export async function changeOwnPassword(_prev: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const user = await requireUser();
  const next = String(formData.get("newPassword") ?? "");
  if (next !== String(formData.get("confirm") ?? "")) return { error: "The new passwords don't match." };
  try {
    await changePassword(await getDb(), user.id, String(formData.get("current") ?? ""), next);
    await startSession(user.id); // every session was ended; keep this device signed in
    return { message: "Password changed. Other devices have been signed out." };
  } catch (err) {
    return { error: messageFor(err) };
  }
}

export interface ResetState {
  error?: string;
  username?: string;
  password?: string;
}

/** Admin only (checked again inside adminResetPassword). */
export async function resetPasswordFor(targetId: string): Promise<ResetState> {
  const admin = await requireUser();
  try {
    return await adminResetPassword(await getDb(), admin.id, id.parse(targetId));
  } catch (err) {
    return { error: messageFor(err) };
  }
}

/** Admin only (checked again inside adminDeleteAccount). */
export async function deleteAccount(targetId: string): Promise<{ error?: string }> {
  const admin = await requireUser();
  try {
    await adminDeleteAccount(await getDb(), admin.id, id.parse(targetId));
    refresh();
    return {};
  } catch (err) {
    return { error: messageFor(err) };
  }
}
