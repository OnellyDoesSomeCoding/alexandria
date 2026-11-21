import pytest

from mangadl.scraper import (
    Chapter,
    chapter_number,
    parse_chapter_list,
    parse_page_images,
    parse_series_title,
    parse_series_url,
    sort_chapters,
    sort_pages,
)

ID_A = "01J76XYFD97DRQQKK75FZB7PQA"
ID_B = "01J76XYFD97DRQQKK75FZB7PQB"
ID_C = "01J76XYFD97DRQQKK75FZB7PQC"

# Shaped like WeebCentral's /full-chapter-list fragment: newest first.
CHAPTER_LIST_HTML = f"""
<div x-data="{{}}" class="flex items-center">
  <a href="https://weebcentral.com/chapters/{ID_C}" class="hover:bg-base-300 flex-1 flex items-center p-2">
    <span class="grow flex items-center gap-2"><span class="">Chapter 2</span></span>
    <time datetime="2024-02-01T00:00:00Z">2/1/2024</time>
  </a>
</div>
<div x-data="{{}}" class="flex items-center">
  <a href="https://weebcentral.com/chapters/{ID_B}"><span class="grow flex items-center gap-2"><span class="">Special Episode</span></span></a>
</div>
<div x-data="{{}}" class="flex items-center">
  <a href="https://weebcentral.com/chapters/{ID_A}"><span class="grow flex items-center gap-2"><span class="">Chapter 1</span></span></a>
</div>
<a href="https://weebcentral.com/chapters/{ID_A}">duplicate link</a>
"""

IMAGES_HTML = """
<section class="flex-1 flex flex-col" x-data="{ scroll: true }">
  <img src="https://hot.planeptune.us/manga/Gachiakuta/0001-001.png" alt="Page 1">
  <img src="https://hot.planeptune.us/manga/Gachiakuta/0001-002.png" alt="Page 2">
</section>
<img src="https://weebcentral.com/static/images/brand.png" alt="logo">
"""


def test_parse_series_url():
    assert parse_series_url("https://weebcentral.com/series/01J76XYFD97DRQQKK75FZB7PQH/Gachiakuta") == (
        "01J76XYFD97DRQQKK75FZB7PQH",
        "Gachiakuta",
    )
    assert parse_series_url("https://weebcentral.com/series/01J76XYFD97DRQQKK75FZB7PQH")[1] == ""


def test_parse_series_url_rejects_other_links():
    with pytest.raises(ValueError):
        parse_series_url("https://example.com/series/01J76XYFD97DRQQKK75FZB7PQH/Gachiakuta")


@pytest.mark.parametrize(
    "name, expected",
    [("Chapter 152", 152), ("Chapter 10.5", 10.5), ("Episode 3", 3), ("Ch. 7", 7), ("12", 12),
     ("Special Episode", None), ("Extra 1", None)],
)
def test_chapter_number(name, expected):
    assert chapter_number(name) == expected


def test_chapter_list_is_ascending_and_deduplicated():
    chapters = parse_chapter_list(CHAPTER_LIST_HTML)
    assert [c.name for c in chapters] == ["Chapter 1", "Special Episode", "Chapter 2"]
    assert [c.number for c in chapters] == [1, None, 2]
    assert chapters[0].id == ID_A
    assert chapters[0].images_url.startswith(f"https://weebcentral.com/chapters/{ID_A}/images?")


def chapter_list_html(*names):
    """A newest-first /full-chapter-list fragment with the given chapter names."""
    return "".join(
        f'<a href="/chapters/01J76XYFD97DRQQKK75FZB{i:04d}"><span class="grow flex items-center gap-2">'
        f'<span class="">{name}</span><span class="hidden md:inline">Last Read</span></span></a>'
        for i, name in enumerate(names)
    )


def test_series_with_its_own_chapter_word():
    # Ichi the Witch lists "Hunt 106" ... "Hunt 1" instead of "Chapter N".
    chapters = parse_chapter_list(chapter_list_html("Hunt 3", "Hunt 2.5", "Hunt 2", "Hunt 1"))
    assert [c.number for c in chapters] == [1, 2, 2.5, 3]
    assert [c.name for c in chapters] == ["Hunt 1", "Hunt 2", "Hunt 2.5", "Hunt 3"]


def test_own_chapter_word_leaves_other_extras_alone():
    chapters = parse_chapter_list(chapter_list_html("Lesson 3", "Special 1", "Lesson 2", "Lesson 1"))
    assert [(c.name, c.number) for c in chapters] == [
        ("Lesson 1", 1), ("Lesson 2", 2), ("Special 1", None), ("Lesson 3", 3),
    ]


def test_rare_word_is_not_taken_as_chapter_word():
    chapters = parse_chapter_list(chapter_list_html("Chapter 3", "Chapter 2", "Extra 1", "Chapter 1"))
    assert [c.number for c in chapters] == [1, None, 2, 3]


def test_page_images_in_order_without_site_assets():
    assert parse_page_images(IMAGES_HTML) == [
        "https://hot.planeptune.us/manga/Gachiakuta/0001-001.png",
        "https://hot.planeptune.us/manga/Gachiakuta/0001-002.png",
    ]


def test_series_title():
    assert parse_series_title("<html><h1> Gachiakuta </h1></html>", "x") == "Gachiakuta"
    assert parse_series_title("<title>Gachiakuta | Weeb Central</title>", "x") == "Gachiakuta"
    assert parse_series_title("<p>nothing</p>", "fallback") == "fallback"


# ---------- ordering ----------

def make(*names):
    return [Chapter(id=f"ID{i}", name=n, number=chapter_number(n)) for i, n in enumerate(names)]


def names(chapters):
    return [c.name for c in chapters]


def test_newest_first_list_becomes_ascending():
    assert names(sort_chapters(make("Chapter 3", "Chapter 2", "Chapter 1"))) == ["Chapter 1", "Chapter 2", "Chapter 3"]


def test_odd_entry_at_the_end_no_longer_breaks_order():
    # The old first-vs-last check saw 20 < 99 and left this newest-first list descending.
    chapters = make("Chapter 20", "Chapter 19", "Chapter 18", "Chapter 99")
    assert [c.number for c in sort_chapters(chapters)] == [18, 19, 20, 99]


def test_shuffled_list_is_sorted_with_decimals():
    chapters = make("Chapter 2", "Chapter 10", "Chapter 1", "Chapter 140.2", "Chapter 140", "Chapter 3")
    assert [c.number for c in sort_chapters(chapters)] == [1, 2, 3, 10, 140, 140.2]


def test_extras_stay_after_the_chapter_they_followed():
    newest_first = make("Chapter 3", "Side Story", "Chapter 2", "Chapter 1", "Prologue Extra")
    # Reading order: Prologue Extra (before everything), 1, 2, Side Story, 3
    assert names(sort_chapters(newest_first)) == ["Prologue Extra", "Chapter 1", "Chapter 2", "Side Story", "Chapter 3"]


def test_duplicate_numbers_keep_listed_order():
    chapters = [Chapter("A", "Chapter 1", 1.0), Chapter("B", "Chapter 1", 1.0), Chapter("C", "Chapter 2", 2.0)]
    assert [c.id for c in sort_chapters(chapters)] == ["A", "B", "C"]


def test_pages_sorted_by_filename_number():
    urls = [f"https://img.example/m/0001-{p:03d}.png" for p in (3, 1, 10, 2)]
    assert [u[-7:] for u in sort_pages(urls)] == ["001.png", "002.png", "003.png", "010.png"]


def test_pages_without_numbers_keep_site_order():
    urls = ["https://img.example/b.png", "https://img.example/a.png"]
    assert sort_pages(urls) == urls


def test_parsed_page_list_is_ascending():
    html = '<section x-data="{ scroll: true }">' + "".join(
        f'<img src="https://hot.planeptune.us/manga/X/0001-{p:03d}.png">' for p in (2, 3, 1)
    ) + "</section>"
    assert [u[-7:] for u in parse_page_images(html)] == ["001.png", "002.png", "003.png"]
