"""Parse chapter selections like "1-20", "5", "1-5,8,10-12", "100-" or "all"."""

from __future__ import annotations

import re
from dataclasses import dataclass

from .scraper import Chapter

NUMBER = r"\d+(?:\.\d+)?"
ITEM_RE = re.compile(rf"^(?:(?P<single>{NUMBER})|(?P<start>{NUMBER})?\s*-\s*(?P<end>{NUMBER})?)$")


@dataclass(frozen=True)
class Span:
    start: float | None  # None = open-ended
    end: float | None

    def __contains__(self, number: float) -> bool:
        return (self.start is None or number >= self.start) and (self.end is None or number <= self.end)


def parse_spec(spec: str) -> list[Span] | None:
    """Return the spans to select, or None for "all"."""
    spec = spec.strip().lower()
    if spec in ("all", "*"):
        return None
    spans: list[Span] = []
    for raw in spec.split(","):
        item = raw.strip()
        match = ITEM_RE.match(item)
        if not item or not match or item == "-":
            raise ValueError(f"Invalid chapter selection {raw.strip()!r}. Examples: 1-20, 5, 1-5,8,10-12, 100-, all")
        if match.group("single"):
            n = float(match.group("single"))
            spans.append(Span(n, n))
            continue
        start = float(match.group("start")) if match.group("start") else None
        end = float(match.group("end")) if match.group("end") else None
        if start is not None and end is not None and start > end:
            raise ValueError(f"Invalid range {item!r}: the start is greater than the end")
        spans.append(Span(start, end))
    return spans


def select_chapters(chapters: list[Chapter], spec: str, include_extras: bool = False) -> list[Chapter]:
    """Pick chapters (in reading order) whose number falls in the selection.

    A duplicate chapter number (for example, two scan groups) keeps its first entry.
    Unnumbered extras are included only with include_extras, and only when they sit
    between the first and last selected chapters (or anywhere, for "all").
    """
    spans = parse_spec(spec)
    picked: set[int] = set()
    seen_numbers: set[float] = set()
    for index, chapter in enumerate(chapters):
        n = chapter.number
        if n is None or n in seen_numbers:
            continue
        if spans is None or any(n in span for span in spans):
            picked.add(index)
            seen_numbers.add(n)

    if include_extras:
        if spans is None:
            lo, hi = 0, len(chapters) - 1
        elif picked:
            lo, hi = min(picked), max(picked)
        else:
            lo, hi = 0, -1
        picked.update(i for i in range(lo, hi + 1) if chapters[i].number is None)

    return [chapters[i] for i in sorted(picked)]


def format_number(n: float) -> str:
    return str(int(n)) if n == int(n) else str(n)
