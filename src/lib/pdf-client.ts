/**
 * Builds a PDF in the browser from chapters' page images, with one bookmark per chapter (like the old mangadl).
 * Images come through /api/chapters/:id/pages/:n (same origin), so they can be read and drawn to canvas.
 * Browser-only: import it dynamically from a click handler.
 */
import { PDFDocument, PDFHexString, PDFName, type PDFRef } from "pdf-lib";

const PX_TO_PT = 0.75; // 96 dpi, same as the old downloader
const MAX_PAGE_PT = 14_400; // PDF viewers' page size limit (200 inches)
const MAX_SLICE_PX = Math.floor(MAX_PAGE_PT / PX_TO_PT);
const PARALLEL = 4;

export interface PdfProgress {
  chapter: number; // 1-based
  chapters: number;
  chapterName: string;
  page: number;
  pages: number;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
  return res.json();
}

async function fetchPage(chapterId: string, index: number): Promise<Blob> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`/api/chapters/${chapterId}/pages/${index}`);
    if (res.ok) return res.blob();
    if (attempt >= 2 || res.status < 500) throw new Error(`Page ${index + 1}: ${await res.text()}`);
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
}

/** Embed one image, converting formats pdf-lib can't read and splitting pages taller than the PDF limit. */
async function addImage(doc: PDFDocument, blob: Blob): Promise<void> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
  const bitmap = await createImageBitmap(blob);
  try {
    const { width, height } = bitmap;
    if ((isJpeg || isPng) && height <= MAX_SLICE_PX) {
      const image = isJpeg ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
      doc.addPage([width * PX_TO_PT, height * PX_TO_PT]).drawImage(image, { x: 0, y: 0, width: width * PX_TO_PT, height: height * PX_TO_PT });
      return;
    }
    // WebP/AVIF/GIF, or a very tall webtoon strip: redraw as JPEG slices.
    for (let top = 0; top < height; top += MAX_SLICE_PX) {
      const sliceHeight = Math.min(MAX_SLICE_PX, height - top);
      const canvas = new OffscreenCanvas(width, sliceHeight);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, sliceHeight);
      ctx.drawImage(bitmap, 0, top, width, sliceHeight, 0, 0, width, sliceHeight);
      const jpeg = new Uint8Array(await (await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 })).arrayBuffer());
      const image = await doc.embedJpg(jpeg);
      doc
        .addPage([width * PX_TO_PT, sliceHeight * PX_TO_PT])
        .drawImage(image, { x: 0, y: 0, width: width * PX_TO_PT, height: sliceHeight * PX_TO_PT });
    }
  } finally {
    bitmap.close();
  }
}

/** Bookmarks ("outline") pointing at the first page of each chapter, opened by default in PDF viewers. */
function addBookmarks(doc: PDFDocument, marks: { title: string; pageIndex: number }[]): void {
  if (marks.length === 0) return;
  const pages = doc.getPages();
  const outlineRef = doc.context.nextRef();
  const refs: PDFRef[] = marks.map(() => doc.context.nextRef());
  marks.forEach((mark, i) => {
    doc.context.assign(
      refs[i],
      doc.context.obj({
        Title: PDFHexString.fromText(mark.title),
        Parent: outlineRef,
        Dest: [pages[mark.pageIndex].ref, "XYZ", null, null, null],
        ...(i > 0 ? { Prev: refs[i - 1] } : {}),
        ...(i < refs.length - 1 ? { Next: refs[i + 1] } : {}),
      }),
    );
  });
  doc.context.assign(outlineRef, doc.context.obj({ Type: "Outlines", First: refs[0], Last: refs[refs.length - 1], Count: refs.length }));
  doc.catalog.set(PDFName.of("Outlines"), outlineRef);
  doc.catalog.set(PDFName.of("PageMode"), PDFName.of("UseOutlines"));
}

export async function buildChaptersPdf(
  chapters: { id: string; name: string }[],
  onProgress: (p: PdfProgress) => void,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const marks: { title: string; pageIndex: number }[] = [];

  for (const [c, chapter] of chapters.entries()) {
    const { count } = await fetchJson<{ count: number }>(`/api/chapters/${chapter.id}/pages`);
    marks.push({ title: chapter.name, pageIndex: doc.getPageCount() });
    onProgress({ chapter: c + 1, chapters: chapters.length, chapterName: chapter.name, page: 0, pages: count });

    // Download a few pages at a time, but add them to the PDF strictly in order.
    const pending: Promise<Blob>[] = [];
    for (let i = 0; i < Math.min(PARALLEL, count); i++) pending.push(fetchPage(chapter.id, i));
    for (let i = 0; i < count; i++) {
      if (signal?.aborted) throw new DOMException("Download cancelled", "AbortError");
      const blob = await pending[i];
      if (i + PARALLEL < count) pending.push(fetchPage(chapter.id, i + PARALLEL));
      await addImage(doc, blob);
      onProgress({ chapter: c + 1, chapters: chapters.length, chapterName: chapter.name, page: i + 1, pages: count });
    }
  }
  addBookmarks(doc, marks);
  return doc.save();
}

/** "Gachiakuta - Ch 1-20.pdf", like the old downloader. */
export function pdfFileName(seriesTitle: string, chapters: { name: string; number: number | null }[]): string {
  const safe = seriesTitle.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").trim() || "manga";
  const numbers = chapters.flatMap((c) => (c.number === null ? [] : [c.number]));
  let label: string;
  if (numbers.length === 0) label = chapters.length === 1 ? chapters[0].name : "Extras";
  else if (Math.min(...numbers) === Math.max(...numbers)) label = `Ch ${String(numbers[0])}`;
  else label = `Ch ${String(Math.min(...numbers))}-${String(Math.max(...numbers))}`;
  return `${safe} - ${label.replace(/[<>:"/\\|?*]/g, "")}.pdf`;
}

export function saveFile(bytes: Uint8Array, fileName: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: fileName });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
