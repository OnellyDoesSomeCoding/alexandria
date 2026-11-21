"""The download -> PDF pipeline shared by the command line and the web app."""

from __future__ import annotations

import re
import shutil
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from .client import Client
from .downloader import Cancelled, download_pages
from .pdf import build_pdf
from .ranges import format_number
from .scraper import Chapter, Series, get_page_urls, sort_chapters

WORK_ROOT = Path(".mangadl-tmp")


@dataclass(frozen=True)
class Progress:
    stage: str  # "pages" (a page finished), "chapter_done", or "building"
    chapter_index: int  # 1-based
    chapter_total: int
    chapter_name: str
    page_done: int = 0
    page_total: int = 0


def safe_filename(name: str) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", name).strip().rstrip(". ")
    return cleaned or "manga"


def default_output_name(title: str, chapters: list[Chapter]) -> str:
    numbers = [c.number for c in chapters if c.number is not None]
    if not numbers:
        label = "Extras"
    elif min(numbers) == max(numbers):
        label = f"Ch {format_number(numbers[0])}"
    else:
        label = f"Ch {format_number(min(numbers))}-{format_number(max(numbers))}"
    return f"{safe_filename(title)} - {label}.pdf"


def download_to_pdf(
    client: Client,
    series: Series,
    chapters: list[Chapter],
    output: Path,
    *,
    work_root: Path = WORK_ROOT,
    workers: int = 4,
    delay: float = 1.0,
    on_progress: Callable[[Progress], None] | None = None,
    cancel: threading.Event | None = None,
) -> int:
    """Download the chapters and write one bookmarked PDF. Returns the page count.

    Images live in work_root/<series id>/ and are deleted only after the PDF is
    written, so a failed or cancelled run can be resumed by running it again.
    Raises Cancelled if the cancel event is set.
    """
    notify = on_progress or (lambda progress: None)
    chapters = sort_chapters(chapters)  # the PDF is always in ascending chapter order
    work_dir = work_root / series.id
    total = len(chapters)
    downloaded: list[tuple[str, list[Path]]] = []

    for i, chapter in enumerate(chapters, start=1):
        if cancel is not None and cancel.is_set():
            raise Cancelled()
        notify(Progress("pages", i, total, chapter.name))
        page_urls = get_page_urls(client, chapter)
        if not page_urls:
            raise RuntimeError(f"No page images found for {chapter.name}. The site layout may have changed.")

        def on_page(done: int, count: int, i: int = i, name: str = chapter.name) -> None:
            notify(Progress("pages", i, total, name, done, count))

        images = download_pages(client, page_urls, work_dir / chapter.id, workers=workers, on_page=on_page, cancel=cancel)
        downloaded.append((chapter.name, images))
        notify(Progress("chapter_done", i, total, chapter.name, len(images), len(images)))

        if i < total and delay > 0:
            if cancel is not None:
                if cancel.wait(delay):
                    raise Cancelled()
            else:
                time.sleep(delay)

    notify(Progress("building", total, total, chapters[-1].name if chapters else ""))
    page_count = build_pdf(downloaded, output)

    shutil.rmtree(work_dir, ignore_errors=True)
    if work_root.exists() and not any(work_root.iterdir()):
        work_root.rmdir()
    return page_count
