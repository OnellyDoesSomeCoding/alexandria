import pytest

from mangadl.scraper import chapter_number, parse_chapter_list, parse_page_images, parse_series_title, parse_series_url

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


def test_page_images_in_order_without_site_assets():
    assert parse_page_images(IMAGES_HTML) == [
        "https://hot.planeptune.us/manga/Gachiakuta/0001-001.png",
        "https://hot.planeptune.us/manga/Gachiakuta/0001-002.png",
    ]


def test_series_title():
    assert parse_series_title("<html><h1> Gachiakuta </h1></html>", "x") == "Gachiakuta"
    assert parse_series_title("<title>Gachiakuta | Weeb Central</title>", "x") == "Gachiakuta"
    assert parse_series_title("<p>nothing</p>", "fallback") == "fallback"
