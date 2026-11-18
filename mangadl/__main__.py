"""Command line: python -m mangadl <series-url> --chapters 1-20"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .client import Client, CloudflareBlockedError, FilteredNetworkError
from .core import WORK_ROOT, Progress, default_output_name, download_to_pdf
from .ranges import format_number, parse_spec, select_chapters
from .scraper import Chapter, get_chapters, get_series


def resolve_output(out: str | None, default_name: str) -> Path:
    if not out:
        return Path(default_name)
    path = Path(out)
    if path.suffix.lower() == ".pdf":
        return path
    return path / default_name


def print_chapter_list(title: str, chapters: list[Chapter]) -> None:
    print(f"{title}: {len(chapters)} chapters")
    for chapter in chapters:
        tag = "" if chapter.number is not None else "   (extra: needs --include-extras)"
        print(f"  {chapter.name}{tag}")


def print_progress(progress: Progress) -> None:
    if progress.stage == "chapter_done":
        print(f"  [{progress.chapter_index}/{progress.chapter_total}] {progress.chapter_name}: {progress.page_total} pages")
    elif progress.stage == "building":
        print("Building PDF...")


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="mangadl",
        description="Download WeebCentral chapters into one PDF with a bookmark per chapter.",
    )
    parser.add_argument("url", help="series link, e.g. https://weebcentral.com/series/<id>/<name>")
    parser.add_argument("-c", "--chapters", help='chapters to get: "1-20", "5", "1-5,8,10-12", "100-" or "all"')
    parser.add_argument("--list", action="store_true", help="print the available chapters and exit")
    parser.add_argument("--include-extras", action="store_true", help="also include unnumbered extras inside the range")
    parser.add_argument("-o", "--out", help="output .pdf file or folder (default: current folder)")
    parser.add_argument("--workers", type=int, default=4, help="parallel image downloads (default: 4)")
    parser.add_argument("--delay", type=float, default=1.0, help="seconds to wait between chapters (default: 1)")
    args = parser.parse_args(argv)
    if not args.list and not args.chapters:
        parser.error("pass --chapters (e.g. --chapters 1-20) or --list")
    if args.chapters:
        try:
            parse_spec(args.chapters)
        except ValueError as exc:
            parser.error(str(exc))
    return args


def run(args: argparse.Namespace) -> int:
    with Client() as client:
        series = get_series(client, args.url)
        chapters = get_chapters(client, series.id)
        if not chapters:
            print("No chapters found on the series page. The site layout may have changed.", file=sys.stderr)
            return 1

        if args.list:
            print_chapter_list(series.title, chapters)
            return 0

        selected = select_chapters(chapters, args.chapters, include_extras=args.include_extras)
        if not selected:
            numbers = [c.number for c in chapters if c.number is not None]
            available = f"{format_number(min(numbers))}-{format_number(max(numbers))}" if numbers else "none"
            print(f"No chapters match {args.chapters!r}. Available chapter numbers: {available}", file=sys.stderr)
            return 1

        output = resolve_output(args.out, default_output_name(series.title, selected))
        print(f"{series.title}: downloading {len(selected)} chapter(s) -> {output}")
        try:
            page_count = download_to_pdf(
                client, series, selected, output,
                workers=args.workers, delay=args.delay, on_progress=print_progress,
            )
        except (Exception, KeyboardInterrupt):
            print(f"\nStopped. Downloaded images are kept in {WORK_ROOT / series.id}; "
                  "run the same command again to resume.", file=sys.stderr)
            raise

        size_mb = output.stat().st_size / 1_048_576
        print(f"Done: {output} ({page_count} pages, {size_mb:.1f} MB)")
        return 0


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        return run(args)
    except (FilteredNetworkError, CloudflareBlockedError, ValueError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130
    except Exception as exc:  # network failures, layout changes, PDF errors
        print(f"Error ({type(exc).__name__}): {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
