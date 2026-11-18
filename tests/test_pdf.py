import pikepdf
from PIL import Image

from mangadl.pdf import MAX_PAGE_PX, build_pdf, normalize_image


def make(path, mode="RGB", size=(200, 300), fmt=None):
    color = (200, 50, 50, 128) if mode == "RGBA" else "red"
    Image.new(mode, size, color).save(path, format=fmt)
    return path


def test_jpeg_and_plain_png_are_embedded_unchanged(tmp_path):
    jpg = make(tmp_path / "a.jpg")
    png = make(tmp_path / "b.png")
    assert normalize_image(jpg) == [jpg]
    assert normalize_image(png) == [png]


def test_webp_and_transparent_png_are_converted(tmp_path):
    webp = make(tmp_path / "c.webp", fmt="WEBP")
    rgba = make(tmp_path / "d.png", mode="RGBA")
    [webp_out] = normalize_image(webp)
    [rgba_out] = normalize_image(rgba)
    assert webp_out.suffix == ".jpg"
    with Image.open(rgba_out) as im:
        assert im.mode == "RGB"


def test_very_tall_image_is_split(tmp_path):
    tall = make(tmp_path / "e.png", size=(100, MAX_PAGE_PX + 500))
    assert len(normalize_image(tall)) == 2


def test_build_pdf_pages_and_bookmarks(tmp_path):
    ch1 = [make(tmp_path / "1-1.jpg"), make(tmp_path / "1-2.png")]
    ch2 = [make(tmp_path / "2-1.webp", fmt="WEBP"), make(tmp_path / "2-2.png", mode="RGBA"), make(tmp_path / "2-3.jpg")]
    out = tmp_path / "out" / "book.pdf"

    assert build_pdf([("Chapter 1", ch1), ("Chapter 2", ch2)], out) == 5
    assert not (tmp_path / "out" / "book.pdf.part").exists()

    with pikepdf.open(out) as pdf:
        assert len(pdf.pages) == 5
        with pdf.open_outline() as outline:
            titles = [item.title for item in outline.root]
            targets = [pdf.pages.index(pikepdf.Page(item.destination[0])) for item in outline.root]
    assert titles == ["Chapter 1", "Chapter 2"]
    assert targets == [0, 2]
