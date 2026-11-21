"use client";

import { useRef, useState } from "react";
import { SubtleButton } from "@/components/ui";
import type { PdfProgress } from "@/lib/pdf-client";

export interface DownloadChapter {
  id: string;
  name: string;
  number: number | null;
}

const MAX_CHAPTERS = 50; // one PDF is built in memory; keep it phone-friendly

function useDownload(seriesTitle: string) {
  const [progress, setProgress] = useState<PdfProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);

  async function start(chapters: DownloadChapter[]) {
    setError(null);
    setBusy(true);
    abort.current = new AbortController();
    try {
      const { buildChaptersPdf, pdfFileName, saveFile } = await import("@/lib/pdf-client");
      const bytes = await buildChaptersPdf(chapters, setProgress, abort.current.signal);
      saveFile(bytes, pdfFileName(seriesTitle, chapters));
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }
  return { start, cancel: () => abort.current?.abort(), progress, error, busy };
}

function ProgressText({ progress }: { progress: PdfProgress | null }) {
  if (!progress) return <span>Preparing…</span>;
  return (
    <span className="tabular-nums">
      {progress.chapters > 1 && `Chapter ${progress.chapter}/${progress.chapters} · `}
      page {progress.page}/{progress.pages || "…"}
    </span>
  );
}

/** Series page: pick a range of chapters and download them as one PDF with a bookmark per chapter. */
export function DownloadRange({ seriesTitle, chapters }: { seriesTitle: string; chapters: DownloadChapter[] }) {
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(0);
  const { start, cancel, progress, error, busy } = useDownload(seriesTitle);
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const tooMany = hi - lo + 1 > MAX_CHAPTERS;
  const select = "rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700";

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-semibold">Download PDF</h2>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select aria-label="From chapter" className={select} value={from} onChange={(e) => setFrom(Number(e.target.value))} disabled={busy}>
          {chapters.map((c, i) => (
            <option key={c.id} value={i}>
              {c.name}
            </option>
          ))}
        </select>
        <span>to</span>
        <select aria-label="To chapter" className={select} value={to} onChange={(e) => setTo(Number(e.target.value))} disabled={busy}>
          {chapters.map((c, i) => (
            <option key={c.id} value={i}>
              {c.name}
            </option>
          ))}
        </select>
        {busy ? (
          <>
            <SubtleButton type="button" onClick={cancel}>
              Cancel
            </SubtleButton>
            <span className="text-neutral-500">
              <ProgressText progress={progress} />
            </span>
          </>
        ) : (
          <SubtleButton type="button" disabled={tooMany || chapters.length === 0} onClick={() => start(chapters.slice(lo, hi + 1))}>
            Download {hi - lo + 1} chapter{hi === lo ? "" : "s"}
          </SubtleButton>
        )}
      </div>
      {tooMany && <p className="text-sm text-neutral-500">Pick at most {MAX_CHAPTERS} chapters per PDF.</p>}
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          Download failed: {error}
        </p>
      )}
    </section>
  );
}

/** Reader: download the open chapter. */
export function DownloadChapterButton({ seriesTitle, chapter }: { seriesTitle: string; chapter: DownloadChapter }) {
  const { start, cancel, progress, error, busy } = useDownload(seriesTitle);
  return (
    <button
      type="button"
      title={error ? `Download failed: ${error}` : "Download this chapter as PDF"}
      className={`rounded border px-2 py-1 ${error ? "border-red-500 text-red-400" : "border-neutral-700"}`}
      onClick={() => (busy ? cancel() : start([chapter]))}
    >
      {busy ? (
        <>
          <ProgressText progress={progress} /> ✕
        </>
      ) : error ? (
        "Retry PDF"
      ) : (
        "PDF"
      )}
    </button>
  );
}
