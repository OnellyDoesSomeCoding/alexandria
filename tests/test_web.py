"""The web API against the fake site (no network)."""

import threading
import time
from urllib.parse import unquote

import pytest
from fastapi.testclient import TestClient

from conftest import CHAPTER_IDS, EXTRA_ID, SERIES_ID, SERIES_URL
from mangadl.core import download_to_pdf
from mangadl.downloader import Cancelled
from mangadl.scraper import get_chapters, get_series
from mangadl.web import create_app


@pytest.fixture
def web(tmp_path, fake_site):
    app = create_app(client=fake_site, downloads_dir=tmp_path / "downloads", work_root=tmp_path / "work", delay=0)
    return TestClient(app)


def wait_until_finished(web, job_id, timeout=15):
    deadline = time.time() + timeout
    while time.time() < deadline:
        snap = web.get(f"/api/jobs/{job_id}").json()
        if snap["state"] in ("done", "failed", "cancelled"):
            return snap
        time.sleep(0.05)
    raise AssertionError("job did not finish")


def test_page_is_served(web):
    response = web.get("/")
    assert response.status_code == 200
    assert "mangadl" in response.text


def test_load_series(web):
    data = web.post("/api/series", json={"url": SERIES_URL}).json()
    assert data["title"] == "Gachiakuta"
    assert data["has_cover"] is True
    assert [c["name"] for c in data["chapters"]] == ["Chapter 1", "Chapter 2", "Side Story", "Chapter 3"]
    assert web.get(f"/api/series/{SERIES_ID}/cover").headers["content-type"] == "image/jpeg"


def test_bad_link_is_a_400(web):
    response = web.post("/api/series", json={"url": "https://example.com/nope"})
    assert response.status_code == 400
    assert "Not a WeebCentral series link" in response.json()["detail"]


def test_select(web):
    web.post("/api/series", json={"url": SERIES_URL})
    ids = web.post("/api/select", json={"series_id": SERIES_ID, "spec": "2-3"}).json()["chapter_ids"]
    assert ids == [CHAPTER_IDS[2], CHAPTER_IDS[3]]
    with_extras = web.post("/api/select", json={"series_id": SERIES_ID, "spec": "2-3", "include_extras": True})
    assert with_extras.json()["chapter_ids"] == [CHAPTER_IDS[2], EXTRA_ID, CHAPTER_IDS[3]]
    assert web.post("/api/select", json={"series_id": SERIES_ID, "spec": "5-2"}).status_code == 400


def test_select_needs_loaded_series(web):
    assert web.post("/api/select", json={"series_id": "NOPE", "spec": "1"}).status_code == 404


def test_download_job(web, tmp_path):
    web.post("/api/series", json={"url": SERIES_URL})
    # Sent out of order on purpose: the PDF must follow reading order.
    job = web.post("/api/jobs", json={"series_id": SERIES_ID, "chapter_ids": [CHAPTER_IDS[3], CHAPTER_IDS[1]]}).json()
    assert job["filename"] == "Gachiakuta - Ch 1-3.pdf"

    snap = wait_until_finished(web, job["id"])
    assert snap["state"] == "done", snap["error"]
    assert snap["page_count"] == 4 and snap["size"] > 0

    pdf = web.get(f"/api/jobs/{job['id']}/file")
    assert pdf.status_code == 200
    assert pdf.content.startswith(b"%PDF")
    assert "Gachiakuta - Ch 1-3.pdf" in unquote(pdf.headers["content-disposition"])
    assert not (tmp_path / "work").exists()

    events = web.get(f"/api/jobs/{job['id']}/events").text
    assert '"state": "done"' in events

    assert web.delete(f"/api/jobs/{job['id']}").status_code == 409  # already finished


def test_job_needs_chapters(web):
    web.post("/api/series", json={"url": SERIES_URL})
    assert web.post("/api/jobs", json={"series_id": SERIES_ID, "chapter_ids": []}).status_code == 400


def test_cancel_stops_pipeline_and_keeps_images(tmp_path, fake_site):
    series = get_series(fake_site, SERIES_URL)
    chapters = get_chapters(fake_site, series.id)
    cancel = threading.Event()

    def on_progress(progress):
        if progress.stage == "chapter_done":
            cancel.set()  # cancel right after the first chapter

    with pytest.raises(Cancelled):
        download_to_pdf(fake_site, series, chapters, tmp_path / "out.pdf",
                        work_root=tmp_path / "work", delay=0, on_progress=on_progress, cancel=cancel)
    assert not (tmp_path / "out.pdf").exists()
    assert any((tmp_path / "work" / series.id).iterdir())  # kept for resuming


def test_pdf_is_ascending_even_if_given_descending(tmp_path, fake_site):
    import pikepdf

    series = get_series(fake_site, SERIES_URL)
    chapters = [c for c in get_chapters(fake_site, series.id) if c.number is not None]
    out = tmp_path / "out.pdf"
    download_to_pdf(fake_site, series, list(reversed(chapters)), out, work_root=tmp_path / "work", delay=0)
    with pikepdf.open(out) as pdf, pdf.open_outline() as outline:
        assert [i.title for i in outline.root] == ["Chapter 1", "Chapter 2", "Chapter 3"]
