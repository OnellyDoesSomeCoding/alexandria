"""A fake WeebCentral for tests: 3 numbered chapters plus one extra, 2 pages each."""

import io
from types import SimpleNamespace

import pytest
from PIL import Image

SERIES_ID = "01J76XYFD97DRQQKK75FZB7PQH"
SERIES_URL = f"https://weebcentral.com/series/{SERIES_ID}/Gachiakuta"
CHAPTER_IDS = {n: f"01J76XYFD97DRQQKK75FZB7P{n:02d}" for n in range(1, 4)}
EXTRA_ID = "01J76XYFD97DRQQKK75FZB7PEX"


def _jpeg() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (100, 150), "blue").save(buf, format="JPEG")
    return buf.getvalue()


class FakeSite:
    def __init__(self):
        self.calls: list[str] = []
        self.jpeg = _jpeg()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        pass

    def close(self):
        pass

    def get(self, url):
        self.calls.append(url)
        if url.endswith("/full-chapter-list"):  # newest first, like the real site
            entries = [(CHAPTER_IDS[3], "Chapter 3"), (EXTRA_ID, "Side Story"),
                       (CHAPTER_IDS[2], "Chapter 2"), (CHAPTER_IDS[1], "Chapter 1")]
            links = "".join(
                f'<a href="https://weebcentral.com/chapters/{cid}"><span class="flex"><span>{name}</span></span></a>'
                for cid, name in entries
            )
            return SimpleNamespace(text=links)
        if "/series/" in url:
            return SimpleNamespace(
                text='<meta property="og:image" content="https://img.example/cover.jpg"><h1>Gachiakuta</h1>'
            )
        if "/images?" in url:
            chapter_id = url.split("/chapters/")[1].split("/")[0]
            imgs = "".join(f'<img src="https://img.example/{chapter_id}/{p}.jpg">' for p in (1, 2))
            return SimpleNamespace(text=f'<section x-data="{{ scroll: true }}">{imgs}</section>')
        return SimpleNamespace(content=self.jpeg, headers={"content-type": "image/jpeg"})


@pytest.fixture
def fake_site():
    return FakeSite()
