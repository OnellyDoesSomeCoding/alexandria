"""Read series info, chapter lists and page image URLs from weebcentral.com.

The site loads these pieces as HTML fragments (htmx), so we request the fragments
directly and never touch the ad-laden reader page:

  /series/{id}/{slug}                    -> series title
  /series/{id}/full-chapter-list         -> one <a href=".../chapters/{chapterId}"> per chapter
  /chapters/{chapterId}/images?...       -> the page <img> tags, in reading order
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

from .client import BASE_URL, Client

SERIES_URL_RE = re.compile(r"^https?://(?:www\.)?weebcentral\.com/series/([0-9A-Za-z]{26})(?:/([^/?#]*))?", re.I)
CHAPTER_HREF_RE = re.compile(r"/chapters/([0-9A-Za-z]{26})")
CHAPTER_NUMBER_RE = re.compile(r"\b(?:chapter|episode|ch\.?|ep\.?)\s*(\d+(?:\.\d+)?)", re.I)
BARE_NUMBER_RE = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*$")
# A series' own chapter word, like "Hunt 106" or "Lesson 5": one word, then the number.
LABELLED_NUMBER_RE = re.compile(r"^\s*([A-Za-z]+)\.?\s*#?(\d+(?:\.\d+)?)\b")
PAGE_NUMBER_RE = re.compile(r"(\d+)\.[A-Za-z0-9]+$")  # trailing number in the filename


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


def chapter_number(name: str, label: str | None = None) -> float | None:
    """The chapter number in a name, or None for an unnumbered extra.

    `label` is the series' own word for a chapter (see series_chapter_label), so
    "Hunt 12" counts as chapter 12 when label is "hunt".
    """
    match = CHAPTER_NUMBER_RE.search(name) or BARE_NUMBER_RE.match(name)
    if match:
        return float(match.group(1))
    if label:
        labelled = LABELLED_NUMBER_RE.match(name)
        if labelled and labelled.group(1).lower() == label:
            return float(labelled.group(2))
    return None


def series_chapter_label(names: list[str]) -> str | None:
    """Find the word a series uses instead of "Chapter" ("Hunt 106", "Lesson 5").

    Only used when at least half the chapters start with that same word and a
    number, so occasional "Special 1"-style extras don't get numbered.
    """
    unnumbered = [n for n in names if chapter_number(n) is None]
    counts = Counter(
        m.group(1).lower() for m in map(LABELLED_NUMBER_RE.match, unnumbered) if m
    )
    if not counts:
        return None
    label, count = counts.most_common(1)[0]
    return label if count >= 2 and count * 2 >= len(names) else None


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


def sort_chapters(chapters: list[Chapter]) -> list[Chapter]:
    """Sort chapters ascending by number, whatever order the site listed them in.

    Unnumbered extras stay right after the numbered chapter they followed in reading
    order. Entries with the same number keep their listed order.
    """
    numbers = [c.number for c in chapters if c.number is not None]
    descending_pairs = sum(a > b for a, b in zip(numbers, numbers[1:]))
    ascending_pairs = sum(a < b for a, b in zip(numbers, numbers[1:]))
    oriented = list(reversed(chapters)) if descending_pairs > ascending_pairs else list(chapters)

    keyed = []
    anchor = float("-inf")
    for position, chapter in enumerate(oriented):
        if chapter.number is not None:
            anchor = chapter.number
            keyed.append(((chapter.number, 0, position), chapter))
        else:
            keyed.append(((anchor, 1, position), chapter))
    keyed.sort(key=lambda pair: pair[0])
    return [chapter for _, chapter in keyed]


def parse_chapter_list(html: str) -> list[Chapter]:
    """Return chapters in ascending (reading) order."""
    soup = BeautifulSoup(html, "html.parser")
    entries: list[tuple[str, str]] = []
    seen: set[str] = set()
    for anchor in soup.select('a[href*="/chapters/"]'):
        match = CHAPTER_HREF_RE.search(anchor.get("href", ""))
        if not match or match.group(1).upper() in seen:
            continue
        chapter_id = match.group(1).upper()
        seen.add(chapter_id)
        entries.append((chapter_id, _chapter_name(anchor)))
    label = series_chapter_label([name for _, name in entries])
    chapters = [Chapter(id=cid, name=name, number=chapter_number(name, label)) for cid, name in entries]
    return sort_chapters(chapters)


def sort_pages(urls: list[str]) -> list[str]:
    """Sort page URLs by the page number at the end of the filename (0001-002.png -> 2).

    If any filename lacks a number, or two share one, the site's order is kept.
    """
    numbers = []
    for url in urls:
        match = PAGE_NUMBER_RE.search(urlparse(url).path)
        if not match:
            return urls
        numbers.append(int(match.group(1)))
    if len(set(numbers)) != len(numbers):
        return urls
    return [url for _, url in sorted(zip(numbers, urls))]


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
    return sort_pages(urls)


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
