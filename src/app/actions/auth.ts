"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db";
import { AuthError, createAccount, verifyLogin } from "@/lib/auth/accounts";
import { clientIp, endSession, startSession } from "@/lib/auth/session";

export interface FormState {
  error?: string;
  username?: string; // echoed back so the field isn't wiped on error
}

function messageFor(err: unknown): string {
  if (err instanceof AuthError) return err.message;
  if (err instanceof z.ZodError) return err.issues[0]?.message ?? "Please check the form.";
  console.error(err);
  return "Something went wrong. Please try again.";
}

/** Only allow same-site paths, so ?next= can't send people to another website. */
function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

export async function signup(_prev: FormState, formData: FormData): Promise<FormState> {
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");
  if (password !== String(formData.get("confirm") ?? "")) return { error: "The passwords don't match.", username };
  try {
    const user = await createAccount(
      await getDb(),
      { username, password, signupCode: String(formData.get("signupCode") ?? "") },
      { signupCode: process.env.SIGNUP_CODE || undefined, allowOpenSignup: process.env.NODE_ENV !== "production" },
    );
    await startSession(user.id);
  } catch (err) {
    return { error: messageFor(err), username };
  }
  redirect("/");
}

export async function login(_prev: FormState, formData: FormData): Promise<FormState> {
  const username = String(formData.get("username") ?? "");
  try {
    const user = await verifyLogin(await getDb(), {
      username,
      password: String(formData.get("password") ?? ""),
      ip: await clientIp(),
    });
    await startSession(user.id);
  } catch (err) {
    return { error: messageFor(err), username };
  }
  redirect(safeNext(formData.get("next")));
}

export async function logout(): Promise<void> {
  await endSession();
  redirect("/login");
}
