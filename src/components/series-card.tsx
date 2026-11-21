import Link from "next/link";

/** Cover tile used by the library and friends' pages. */
export function SeriesCard({
  href,
  title,
  coverUrl,
  lines,
  badge,
}: {
  href: string;
  title: string;
  coverUrl: string | null;
  lines: string[];
  badge?: string;
}) {
  return (
    <Link href={href} className="group flex flex-col gap-2">
      <div className="relative aspect-[2/3] overflow-hidden rounded-md bg-neutral-200 dark:bg-neutral-800">
        {coverUrl ? (
          <img src={coverUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover transition group-hover:scale-[1.02]" />
        ) : (
          <span className="flex h-full items-center justify-center p-2 text-center text-sm text-neutral-500">{title}</span>
        )}
        {badge && <span className="absolute right-1.5 top-1.5 rounded bg-neutral-900/85 px-1.5 py-0.5 text-xs font-medium text-white">{badge}</span>}
      </div>
      <div className="min-w-0">
        <p className="line-clamp-2 text-sm font-medium leading-snug">{title}</p>
        {lines.map((line) => (
          <p key={line} className="truncate text-xs text-neutral-500">
            {line}
          </p>
        ))}
      </div>
    </Link>
  );
}
