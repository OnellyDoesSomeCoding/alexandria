/** Bare-bones shared styles. The real visual design comes later; keep class names here so it's one place to change. */
import type { ComponentProps } from "react";

export const inputClass =
  "w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:border-neutral-500 dark:border-neutral-700";

export const buttonClass =
  "inline-block rounded-md bg-neutral-900 px-4 py-2 font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900";

export function Button({ className = "", ...props }: ComponentProps<"button">) {
  return <button className={`${buttonClass} ${className}`} {...props} />;
}

export function SubtleButton({ className = "", ...props }: ComponentProps<"button">) {
  return (
    <button
      className={`rounded-md border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-neutral-700 ${className}`}
      {...props}
    />
  );
}

export function Field({ label, ...props }: { label: string } & ComponentProps<"input">) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <input className={inputClass} {...props} />
    </label>
  );
}

export function ErrorText({ children }: { children?: string }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-sm text-red-600 dark:text-red-400">
      {children}
    </p>
  );
}
