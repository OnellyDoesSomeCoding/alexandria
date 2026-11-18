"""Read series info, chapter lists and page image URLs from weebcentral.com.

The site loads these pieces as HTML fragments (htmx), so we request the fragments
directly and never touch the ad-laden reader page:

  /series/{id}/{slug}                    -> series title
  /series/{id}/full-chapter-list         -> one <a href=".../chapters/{chapterId}"> per chapter
  /chapters/{chapterId}/images?...       -> the page <img> tags, in reading order
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

from .client import BASE_URL, Client

SERIES_URL_RE = re.compile(r"^https?://(?:www\.)?weebcentral\.com/series/([0-9A-Za-z]{26})(?:/([^/?#]*))?", re.I)
CHAPTER_HREF_RE = re.compile(r"/chapters/([0-9A-Za-z]{26})")
CHAPTER_NUMBER_RE = re.compile(r"\b(?:chapter|episode|ch\.?|ep\.?)\s*(\d+(?:\.\d+)?)", re.I)
BARE_NUMBER_RE = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*$")


@dataclass(frozen=True)
class Series:
    id: str
    slug: str
    title: str
    cover_url: str | None = None


@dataclass(frozen=True)
class Chapter:
    id: str
    name: str
    number: float | None  # None for unnumbered extras/specials

    @property
    def images_url(self) -> str:
        return f"{BASE_URL}/chapters/{self.id}/images?is_prev=False&current_page=1&reading_style=long_strip"


def parse_series_url(url: str) -> tuple[str, str]:
    match = SERIES_URL_RE.match(url.strip())
    if not match:
        raise ValueError(
            "Not a WeebCentral series link. Expected something like "
            "https://weebcentral.com/series/01J76XYFD97DRQQKK75FZB7PQH/Gachiakuta"
        )
    return match.group(1).upper(), match.group(2) or ""


def chapter_number(name: str) -> float | None:
    match = CHAPTER_NUMBER_RE.search(name) or BARE_NUMBER_RE.match(name)
    return float(match.group(1)) if match else None


def parse_series_title(html: str, fallback: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    h1 = soup.select_one("h1")
    if h1 and h1.get_text(strip=True):
        return h1.get_text(" ", strip=True)
    og = soup.select_one('meta[property="og:title"]')
    if og and og.get("content"):
        return og["content"].split("|")[0].strip()
    if soup.title and soup.title.string:
        return soup.title.string.split("|")[0].strip()
    return fallback


def parse_series_cover(html: str, base_url: str = BASE_URL) -> str | None:
    soup = BeautifulSoup(html, "html.parser")
    og = soup.select_one('meta[property="og:image"]')
    if og and og.get("content"):
        return urljoin(base_url, og["content"])
    img = soup.select_one('img[alt*="cover" i], picture img')
    if img and img.get("src"):
        return urljoin(base_url, img["src"])
    return None


def _chapter_name(anchor) -> str:
    preferred = anchor.select_one("span.flex > span")
    if preferred and preferred.get_text(strip=True):
        return preferred.get_text(" ", strip=True)
    for span in anchor.find_all("span"):
        text = span.get_text(" ", strip=True)
        if CHAPTER_NUMBER_RE.search(text):
            return text
    return anchor.get_text(" ", strip=True)[:80]


def parse_chapter_list(html: str) -> list[Chapter]:
    """Return chapters in ascending (reading) order."""
    soup = BeautifulSoup(html, "html.parser")
    chapters: list[Chapter] = []
    seen: set[str] = set()
    for anchor in soup.select('a[href*="/chapters/"]'):
        match = CHAPTER_HREF_RE.search(anchor.get("href", ""))
        if not match or match.group(1).upper() in seen:
            continue
        chapter_id = match.group(1).upper()
        seen.add(chapter_id)
        name = _chapter_name(anchor)
        chapters.append(Chapter(id=chapter_id, name=name, number=chapter_number(name)))

    numbers = [c.number for c in chapters if c.number is not None]
    if len(numbers) >= 2 and numbers[0] > numbers[-1]:  # site lists newest first
        chapters.reverse()
    return chapters


def parse_page_images(html: str, base_url: str = BASE_URL) -> list[str]:
    soup = BeautifulSoup(html, "html.parser")
    images = soup.select("section[x-data~=scroll] > img") or soup.select("img")
    site_host = urlparse(BASE_URL).hostname
    urls: list[str] = []
    for img in images:
        src = img.get("src") or img.get("data-src") or ""
        if not src or src.startswith("data:"):
            continue
        absolute = urljoin(base_url, src)
        if urlparse(absolute).hostname == site_host:  # logos, icons, placeholders
            continue
        if absolute not in urls:
            urls.append(absolute)
    return urls


def get_series(client: Client, url: str) -> Series:
    series_id, slug = parse_series_url(url)
    html = client.get(f"{BASE_URL}/series/{series_id}/{slug}").text
    fallback = slug.replace("-", " ").strip() or series_id
    return Series(id=series_id, slug=slug, title=parse_series_title(html, fallback), cover_url=parse_series_cover(html))


def get_chapters(client: Client, series_id: str) -> list[Chapter]:
    html = client.get(f"{BASE_URL}/series/{series_id}/full-chapter-list").text
    return parse_chapter_list(html)


def get_page_urls(client: Client, chapter: Chapter) -> list[str]:
    html = client.get(chapter.images_url).text
    return parse_page_images(html)
