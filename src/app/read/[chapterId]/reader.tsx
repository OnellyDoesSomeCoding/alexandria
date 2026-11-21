"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type CSSProperties, type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { saveProgress, updateReaderSettings } from "@/app/actions/library";
import { DownloadChapterButton } from "@/components/download-pdf";
import type { ReaderFit, ReaderLayout, ReaderSettings } from "@/db/schema";
import type { ReaderChapter } from "@/lib/library";
import { spreads } from "./spreads";

const PRELOAD_AHEAD = 4;

export function Reader({ chapter, initialSettings }: { chapter: ReaderChapter; initialSettings: ReaderSettings }) {
  const router = useRouter();
  const [settings, setSettings] = useState(initialSettings);
  const [page, setPage] = useState(chapter.savedPage); // first page of the current view
  const [atEnd, setAtEnd] = useState(false); // paged modes: the "end of chapter" screen
  const [showUi, setShowUi] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [sizes, setSizes] = useState<Record<number, { w: number; h: number }>>({});
  const count = chapter.pages.length;
  const strip = settings.layout === "strip";
  const rtl = settings.direction === "rtl";

  const wide = useMemo(() => new Set(Object.entries(sizes).filter(([, s]) => s.w > s.h * 1.1).map(([i]) => Number(i))), [sizes]);
  const groups = useMemo(
    () => (settings.layout === "double" ? spreads(count, settings.coverAlone, wide) : chapter.pages.map((_, i) => [i])),
    [settings.layout, settings.coverAlone, count, wide, chapter.pages],
  );
  const viewIndex = Math.max(0, groups.findIndex((g) => g.includes(page)));
  const view = useMemo(() => groups[viewIndex] ?? [], [groups, viewIndex]);

  // Long strip: pages above a jump target are placeholders until they load, and loading at full height pushes
  // the target down. So a jump is remembered and re-applied as images load, until the reader scrolls themselves.
  const pendingJump = useRef<{ index: number; until: number } | null>(null);
  const scrollToPage = useCallback((index: number) => {
    pendingJump.current = { index, until: performance.now() + 5000 };
    document.getElementById(`page-${index}`)?.scrollIntoView({ block: "start" });
  }, []);
  useEffect(() => {
    const cancel = () => (pendingJump.current = null);
    const opts = { passive: true } as const;
    window.addEventListener("wheel", cancel, opts);
    window.addEventListener("touchstart", cancel, opts);
    return () => {
      window.removeEventListener("wheel", cancel);
      window.removeEventListener("touchstart", cancel);
    };
  }, []);

  const recordSize = useCallback((index: number, img: HTMLImageElement) => {
    const { naturalWidth: w, naturalHeight: h } = img;
    setSizes((prev) => (prev[index] ? prev : { ...prev, [index]: { w, h } }));
    const jump = pendingJump.current;
    if (jump && performance.now() < jump.until) {
      requestAnimationFrame(() => document.getElementById(`page-${jump.index}`)?.scrollIntoView({ block: "start" }));
    }
  }, []);

  // ---- navigation ----

  const goTo = useCallback(
    (index: number) => {
      const target = Math.min(Math.max(index, 0), count - 1);
      setAtEnd(false);
      setPage(target);
      if (strip) scrollToPage(target);
      else window.scrollTo(0, 0);
    },
    [count, strip, scrollToPage],
  );

  const next = useCallback(() => {
    if (strip) {
      if (page < count - 1) goTo(page + 1);
      else document.getElementById("chapter-end")?.scrollIntoView({ block: "center" });
      return;
    }
    if (atEnd) {
      if (chapter.nextId) router.push(`/read/${chapter.nextId}`);
    } else if (viewIndex < groups.length - 1) {
      goTo(groups[viewIndex + 1][0]);
    } else {
      setAtEnd(true);
      window.scrollTo(0, 0);
    }
  }, [strip, page, count, goTo, atEnd, chapter.nextId, router, viewIndex, groups]);

  const prev = useCallback(() => {
    if (strip) {
      if (page > 0) goTo(page - 1);
      return;
    }
    if (atEnd) setAtEnd(false);
    else if (viewIndex > 0) goTo(groups[viewIndex - 1][0]);
    else if (chapter.prevId) router.push(`/read/${chapter.prevId}`);
  }, [strip, page, goTo, atEnd, viewIndex, groups, chapter.prevId, router]);

  // Keyboard: arrows follow the reading direction; space/page keys always go forward/back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "Escape") return setPanelOpen(false);
      const forward = rtl ? "ArrowLeft" : "ArrowRight";
      const back = rtl ? "ArrowRight" : "ArrowLeft";
      if (e.key === forward || (!strip && (e.key === " " || e.key === "PageDown"))) {
        e.preventDefault();
        next();
      } else if (e.key === back || (!strip && e.key === "PageUp")) {
        e.preventDefault();
        prev();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, rtl, strip]);

  // Tap zones: outer thirds turn pages (paged modes), the middle shows/hides the bars.
  const onTap = (e: MouseEvent) => {
    if (panelOpen) return setPanelOpen(false);
    const x = e.clientX / window.innerWidth;
    if (strip || (x > 0.3 && x < 0.7)) return setShowUi((v) => !v);
    const leftSide = x <= 0.3;
    if (leftSide !== rtl) prev();
    else next();
  };

  // Long strip: the current page is whichever one crosses a line 40% down the screen.
  useEffect(() => {
    if (!strip) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) setPage(Number((entry.target as HTMLElement).dataset.index));
      },
      { rootMargin: "-40% 0px -59% 0px" },
    );
    document.querySelectorAll("[data-index]").forEach((el) => observer.observe(el));
    // Reaching the end panel finishes the chapter.
    const end = document.getElementById("chapter-end");
    const endObserver = new IntersectionObserver(([entry]) => entry?.isIntersecting && setAtEnd(true));
    if (end) endObserver.observe(end);
    return () => {
      observer.disconnect();
      endObserver.disconnect();
    };
  }, [strip, count]);

  // Long strip: jump to the saved page once, on open.
  const resumed = useRef(false);
  useEffect(() => {
    if (strip && !resumed.current) {
      resumed.current = true;
      if (chapter.savedPage > 0) scrollToPage(chapter.savedPage);
    }
  }, [strip, chapter.savedPage, scrollToPage]);

  // Paged modes: fetch the next few pages ahead (and learn their sizes for spread pairing).
  useEffect(() => {
    if (strip) return;
    const last = view[view.length - 1] ?? 0;
    for (let i = last + 1; i <= Math.min(last + PRELOAD_AHEAD, count - 1); i++) {
      const img = new Image();
      img.referrerPolicy = "no-referrer";
      const index = i;
      img.onload = () => recordSize(index, img);
      img.src = chapter.pages[i];
    }
  }, [strip, view, count, chapter.pages, recordSize]);

  // Save progress shortly after the page stops changing.
  const completed = atEnd || view.includes(count - 1) || (strip && page >= count - 1);
  useEffect(() => {
    const timer = setTimeout(() => void saveProgress(chapter.id, page, completed).catch(() => {}), 800);
    return () => clearTimeout(timer);
  }, [chapter.id, page, completed]);

  const change = (patch: Partial<ReaderSettings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    void updateReaderSettings(patch).catch(() => {});
    if (patch.layout && patch.layout !== settings.layout) {
      setAtEnd(false);
      if (patch.layout === "strip") requestAnimationFrame(() => scrollToPage(page));
      else window.scrollTo(0, 0);
    }
  };

  const img = (index: number, className: string, style?: CSSProperties) => (
    <img
      key={index}
      id={strip ? `page-${index}` : undefined}
      data-index={strip ? index : undefined}
      src={chapter.pages[index]}
      alt={`Page ${index + 1}`}
      referrerPolicy="no-referrer"
      loading={strip && Math.abs(index - chapter.savedPage) > 2 ? "lazy" : "eager"}
      draggable={false}
      onLoad={(e) => recordSize(index, e.currentTarget)}
      className={className}
      style={{ ...style, ...(sizes[index] ? {} : { minHeight: "60vh" }) }}
    />
  );

  return (
    <div className="min-h-dvh bg-neutral-950 text-neutral-100" onClick={onTap}>
      {strip ? (
        <div className="mx-auto flex flex-col items-center" style={{ gap: settings.stripGap, maxWidth: stripMaxWidth(settings) }}>
          {chapter.pages.map((_, i) => img(i, stripImageClass(settings.fit)))}
          <EndPanel chapter={chapter} />
        </div>
      ) : atEnd ? (
        <div className="flex min-h-dvh items-center justify-center p-6">
          <EndPanel chapter={chapter} />
        </div>
      ) : (
        <div className={`flex min-h-dvh ${settings.fit === "width" ? "items-start" : "items-center"} ${rtl ? "flex-row-reverse" : ""} justify-center overflow-x-auto`}>
          {view.map((i) => img(i, pagedImageClass(settings.fit, view.length)))}
        </div>
      )}

      {showUi && (
        <>
          <header
            className="fixed inset-x-0 top-0 z-10 flex items-center gap-3 bg-neutral-900/95 px-4 py-2 text-sm backdrop-blur"
            onClick={(e) => e.stopPropagation()}
          >
            <Link href={`/series/${chapter.seriesId}`} className="shrink-0 text-neutral-400 hover:text-white" aria-label="Back to series">
              ←
            </Link>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{chapter.name}</p>
              <p className="truncate text-xs text-neutral-400">{chapter.seriesTitle}</p>
            </div>
            <DownloadChapterButton seriesTitle={chapter.seriesTitle} chapter={chapter} />
            <button type="button" className="rounded border border-neutral-700 px-2 py-1" onClick={() => setPanelOpen((v) => !v)} aria-expanded={panelOpen}>
              Settings
            </button>
          </header>

          {panelOpen && <SettingsPanel settings={settings} onChange={change} />}

          <footer
            className="fixed inset-x-0 bottom-0 z-10 flex items-center gap-3 bg-neutral-900/95 px-4 py-2 text-sm backdrop-blur"
            onClick={(e) => e.stopPropagation()}
          >
            <ChapterLink id={rtl ? chapter.nextId : chapter.prevId} label={rtl ? "Next ›" : "‹ Prev"} />
            <input
              type="range"
              min={1}
              max={count}
              value={page + 1}
              onChange={(e) => goTo(Number(e.target.value) - 1)}
              aria-label="Page"
              className="min-w-0 flex-1 accent-neutral-200"
              dir={rtl ? "rtl" : "ltr"}
            />
            <span className="w-16 shrink-0 text-center tabular-nums text-neutral-400">
              {page + 1}/{count}
            </span>
            <ChapterLink id={rtl ? chapter.prevId : chapter.nextId} label={rtl ? "‹ Prev" : "Next ›"} />
          </footer>
        </>
      )}
    </div>
  );
}

function stripMaxWidth(s: ReaderSettings): string | undefined {
  if (s.fit === "original") return undefined;
  return s.maxWidth > 0 ? `${s.maxWidth}px` : undefined;
}

function stripImageClass(fit: ReaderFit): string {
  switch (fit) {
    case "height":
      return "h-dvh w-auto max-w-full object-contain";
    case "both":
      return "max-h-dvh w-auto max-w-full object-contain";
    case "original":
      return "max-w-none";
    default:
      return "w-full h-auto";
  }
}

function pagedImageClass(fit: ReaderFit, onScreen: number): string {
  const half = onScreen > 1;
  switch (fit) {
    case "width":
      return half ? "w-1/2 h-auto" : "w-full h-auto";
    case "height":
      return "h-dvh w-auto max-w-none";
    case "both":
      return `max-h-dvh w-auto object-contain ${half ? "max-w-[50%]" : "max-w-full"}`;
    default:
      return "max-w-none";
  }
}

function ChapterLink({ id, label }: { id: string | null; label: string }) {
  if (!id) return <span className="w-14 shrink-0 text-center text-neutral-600">{label}</span>;
  return (
    <Link href={`/read/${id}`} className="w-14 shrink-0 text-center hover:text-white">
      {label}
    </Link>
  );
}

function EndPanel({ chapter }: { chapter: ReaderChapter }) {
  return (
    <div id="chapter-end" className="flex flex-col items-center gap-4 px-6 py-16 text-center" onClick={(e) => e.stopPropagation()}>
      <p className="text-neutral-400">End of {chapter.name}</p>
      {chapter.nextId ? (
        <Link href={`/read/${chapter.nextId}`} className="rounded-md bg-neutral-100 px-5 py-2 font-medium text-neutral-900">
          Next chapter
        </Link>
      ) : (
        <p>You&apos;re all caught up.</p>
      )}
      <Link href={`/series/${chapter.seriesId}`} className="text-sm text-neutral-400 underline">
        Back to {chapter.seriesTitle}
      </Link>
    </div>
  );
}

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-xs uppercase tracking-wide text-neutral-400">{label}</legend>
      <div className="flex overflow-hidden rounded-md border border-neutral-700">
        {options.map(([v, text]) => (
          <button
            key={v}
            type="button"
            aria-pressed={value === v}
            onClick={() => onChange(v)}
            className={`flex-1 px-2 py-1.5 text-sm ${value === v ? "bg-neutral-100 text-neutral-900" : "hover:bg-neutral-800"}`}
          >
            {text}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function SettingsPanel({ settings, onChange }: { settings: ReaderSettings; onChange: (patch: Partial<ReaderSettings>) => void }) {
  return (
    <div
      className="fixed right-2 top-14 z-20 flex w-[min(22rem,calc(100vw-1rem))] flex-col gap-4 rounded-lg border border-neutral-800 bg-neutral-900 p-4 text-sm shadow-xl"
      onClick={(e) => e.stopPropagation()}
    >
      <Segmented<ReaderLayout>
        label="Layout"
        value={settings.layout}
        options={[
          ["single", "Single"],
          ["double", "Double"],
          ["strip", "Long strip"],
        ]}
        onChange={(layout) => onChange({ layout })}
      />
      <Segmented<ReaderFit>
        label="Fit"
        value={settings.fit}
        options={[
          ["width", "Width"],
          ["height", "Height"],
          ["both", "Both"],
          ["original", "Original"],
        ]}
        onChange={(fit) => onChange({ fit })}
      />
      <Segmented
        label="Direction"
        value={settings.direction}
        options={[
          ["ltr", "Left to right"],
          ["rtl", "Right to left"],
        ]}
        onChange={(direction) => onChange({ direction })}
      />
      {settings.layout === "double" && (
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={settings.coverAlone} onChange={(e) => onChange({ coverAlone: e.target.checked })} />
          Show the first page on its own
        </label>
      )}
      {settings.layout === "strip" && (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-neutral-400">Gap between pages: {settings.stripGap}px</span>
            <input type="range" min={0} max={48} step={4} value={settings.stripGap} onChange={(e) => onChange({ stripGap: Number(e.target.value) })} />
          </label>
          {settings.fit !== "original" && (
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-neutral-400">
                Max width: {settings.maxWidth === 0 ? "none" : `${settings.maxWidth}px`}
              </span>
              <input type="range" min={0} max={1600} step={100} value={settings.maxWidth} onChange={(e) => onChange({ maxWidth: Number(e.target.value) })} />
            </label>
          )}
        </>
      )}
    </div>
  );
}
