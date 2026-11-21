import pytest

from mangadl.ranges import format_number, parse_spec, select_chapters
from mangadl.scraper import Chapter


def ch(n, name=None):
    label = name or (f"Chapter {format_number(n)}" if n is not None else "Extra")
    return Chapter(id=f"ID{label}", name=label, number=n)


CHAPTERS = [ch(1), ch(2), ch(3), ch(None, "Side Story"), ch(4), ch(4.5), ch(5), ch(10), ch(11), ch(12)]


def numbers(selected):
    return [c.number for c in selected]


def test_simple_range():
    assert numbers(select_chapters(CHAPTERS, "1-3")) == [1, 2, 3]


def test_range_includes_decimals_inside():
    assert numbers(select_chapters(CHAPTERS, "4-5")) == [4, 4.5, 5]


def test_single_number_is_exact():
    assert numbers(select_chapters(CHAPTERS, "4")) == [4]


def test_mixed_list_keeps_reading_order():
    assert numbers(select_chapters(CHAPTERS, "10-12,1,3")) == [1, 3, 10, 11, 12]


def test_open_ended():
    assert numbers(select_chapters(CHAPTERS, "10-")) == [10, 11, 12]
    assert numbers(select_chapters(CHAPTERS, "-2")) == [1, 2]


def test_all():
    assert len(select_chapters(CHAPTERS, "all")) == 9
    assert len(select_chapters(CHAPTERS, "all", include_extras=True)) == 10


def test_extras_only_inside_range():
    assert numbers(select_chapters(CHAPTERS, "1-5", include_extras=True)) == [1, 2, 3, None, 4, 4.5, 5]
    assert numbers(select_chapters(CHAPTERS, "10-12", include_extras=True)) == [10, 11, 12]


def test_duplicate_numbers_keep_first():
    chapters = [Chapter("A", "Chapter 1", 1.0), Chapter("B", "Chapter 1", 1.0), Chapter("C", "Chapter 2", 2.0)]
    assert [c.id for c in select_chapters(chapters, "1-2")] == ["A", "C"]


def test_no_match_returns_empty():
    assert select_chapters(CHAPTERS, "50-60") == []


def test_stray_commas_are_ignored():
    # The web page applies the range as you type, so "1-3," must not be an error.
    assert numbers(select_chapters(CHAPTERS, "1-3,")) == [1, 2, 3]
    assert numbers(select_chapters(CHAPTERS, "1,,3")) == [1, 3]


@pytest.mark.parametrize("bad", ["", " ", ",", " , ", "abc", "5-2", "1-2-3", "-", "1,abc"])
def test_invalid_specs(bad):
    with pytest.raises(ValueError):
        parse_spec(bad)
