import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { logout } from "@/app/actions/auth";
import { newFriendCode, unfriend } from "@/app/actions/friends";
import { SubtleButton } from "@/components/ui";
import { getDb } from "@/db";
import { listFriends } from "@/lib/auth/accounts";
import { formatFriendCode } from "@/lib/auth/codes";
import { requireUser } from "@/lib/auth/session";
import { AddFriendForm, CopyButton } from "./friend-forms";
import { ChangePasswordForm } from "./password-form";

export const metadata: Metadata = { title: "Profile" };

export default function ProfilePage() {
  return (
    <Suspense fallback={<p className="text-neutral-500">Loading…</p>}>
      <Profile />
    </Suspense>
  );
}

async function Profile() {
  const user = await requireUser();
  const friends = await listFriends(await getDb(), user.id);
  const code = formatFriendCode(user.friendCode);

  return (
    <div className="flex max-w-xl flex-col gap-10">
      <section className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">
          {user.username}
          {user.isAdmin && <span className="ml-2 rounded bg-neutral-200 px-1.5 py-0.5 align-middle text-xs font-medium dark:bg-neutral-800">admin</span>}
        </h1>
        <form action={logout}>
          <SubtleButton type="submit">Sign out</SubtleButton>
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Your friend code</h2>
        <p className="text-sm text-neutral-500">Share it with friends so they can add you. Friends can see what you&apos;re reading.</p>
        <div className="flex items-center gap-2">
          <code className="rounded-md bg-neutral-100 px-3 py-1.5 font-mono text-lg tracking-widest dark:bg-neutral-900">{code}</code>
          <CopyButton text={code} />
          <form action={newFriendCode}>
            <SubtleButton type="submit" title="Your current friends stay. The old code stops working.">
              New code
            </SubtleButton>
          </form>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Add a friend</h2>
        <AddFriendForm />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Friends ({friends.length})</h2>
        {friends.length === 0 ? (
          <p className="text-sm text-neutral-500">No friends added yet.</p>
        ) : (
          <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {friends.map((friend) => (
              <li key={friend.id} className="flex items-center justify-between py-2">
                <Link href={`/u/${encodeURIComponent(friend.username)}`} className="font-medium underline-offset-2 hover:underline">
                  {friend.username}
                </Link>
                <form action={unfriend.bind(null, friend.id)}>
                  <SubtleButton type="submit">Remove</SubtleButton>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Change password</h2>
        <ChangePasswordForm />
      </section>
    </div>
  );
}
