"""Turn downloaded page images into one PDF with a bookmark per chapter.

JPEG and plain PNG pages are embedded as-is (no re-compression). Other formats
(WebP, transparent PNG, ...) are converted first, and pages taller than the PDF
size limit are split into several pages.
"""

from __future__ import annotations

from pathlib import Path

import img2pdf
import pikepdf
from PIL import Image

DPI = 96
MAX_PAGE_PT = 14400  # PDF viewers' maximum page dimension (200 inches)
MAX_PAGE_PX = MAX_PAGE_PT * DPI // 72  # 19200 px at 96 dpi


def _flatten(im: Image.Image) -> Image.Image:
    has_alpha = im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)
    if has_alpha:
        rgba = im.convert("RGBA")
        background = Image.new("RGB", rgba.size, "white")
        background.paste(rgba, mask=rgba.getchannel("A"))
        return background
    if im.mode not in ("RGB", "L"):
        return im.convert("RGB")
    return im


def normalize_image(path: Path) -> list[Path]:
    """Return image file(s) that img2pdf can embed, converting or splitting if needed."""
    with Image.open(path) as im:
        fmt = im.format
        width, height = im.size
        embeddable = (fmt == "JPEG" and im.mode in ("RGB", "L", "CMYK")) or (fmt == "PNG" and im.mode in ("RGB", "L"))
        if embeddable and height <= MAX_PAGE_PX and width <= MAX_PAGE_PX:
            return [path]

        flat = _flatten(im)
        lossy_source = fmt in ("JPEG", "WEBP")
        suffix, options = (".jpg", {"quality": 92}) if lossy_source else (".png", {})
        outputs: list[Path] = []
        for part, top in enumerate(range(0, height, MAX_PAGE_PX), start=1):
            piece = flat.crop((0, top, width, min(top + MAX_PAGE_PX, height)))
            out = path.with_name(f"{path.stem}_norm{part}{suffix}")
            piece.save(out, **options)
            outputs.append(out)
        return outputs


def build_pdf(chapters: list[tuple[str, list[Path]]], output: Path) -> int:
    """Write the PDF for (bookmark title, page images) pairs. Returns the page count."""
    pages: list[str] = []
    bookmarks: list[tuple[str, int]] = []
    for title, images in chapters:
        bookmarks.append((title, len(pages)))
        for image in images:
            pages.extend(str(p) for p in normalize_image(image))
    if not pages:
        raise ValueError("No pages to put in the PDF")

    output.parent.mkdir(parents=True, exist_ok=True)
    draft = output.with_name(output.name + ".part")
    layout = img2pdf.get_fixed_dpi_layout_fun((DPI, DPI))
    draft.write_bytes(img2pdf.convert(pages, layout_fun=layout))

    with pikepdf.open(draft) as pdf:
        with pdf.open_outline() as outline:
            for title, page_index in bookmarks:
                outline.root.append(pikepdf.OutlineItem(title, page_index))
        pdf.Root.PageMode = pikepdf.Name.UseOutlines
        pdf.save(output)
    draft.unlink()
    return len(pages)
