"""Download a chapter's page images into a working folder, several at a time.

Files already present from an interrupted run are skipped, so re-running resumes.
"""

from __future__ import annotations

import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path, PurePosixPath
from urllib.parse import urlparse

from .client import Client

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"}


class Cancelled(Exception):
    """The user cancelled the download."""


def _extension(url: str) -> str:
    suffix = PurePosixPath(urlparse(url).path).suffix.lower()
    return suffix if suffix in IMAGE_EXTENSIONS else ".jpg"


def _download_one(client: Client, url: str, target: Path) -> Path:
    if target.exists() and target.stat().st_size > 0:
        return target
    data = client.get(url).content
    if not data:
        raise RuntimeError(f"Empty image response: {url}")
    partial = target.with_name(target.name + ".part")
    partial.write_bytes(data)
    partial.replace(target)  # only complete files get the final name
    return target


def download_pages(
    client: Client,
    page_urls: list[str],
    dest: Path,
    workers: int = 4,
    on_page: Callable[[int, int], None] | None = None,
    cancel: threading.Event | None = None,
) -> list[Path]:
    """Download pages to dest/001.jpg, dest/002.png, ... and return the paths in order.

    on_page(done, total) is called after each page finishes.
    """
    dest.mkdir(parents=True, exist_ok=True)
    targets = [dest / f"{i:03d}{_extension(url)}" for i, url in enumerate(page_urls, start=1)]
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        futures = [pool.submit(_download_one, client, url, target) for url, target in zip(page_urls, targets)]
        try:
            for done, future in enumerate(as_completed(futures), start=1):
                future.result()
                if on_page:
                    on_page(done, len(targets))
                if cancel is not None and cancel.is_set():
                    raise Cancelled()
        except BaseException:
            for future in futures:
                future.cancel()
            raise
    return targets
