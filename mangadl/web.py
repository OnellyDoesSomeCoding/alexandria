"""Local web app: python -m mangadl.web  ->  http://127.0.0.1:8000

Only listens on this computer. Downloads run one at a time in a background
thread; the page follows progress over Server-Sent Events.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import queue
import threading
import uuid
import webbrowser
from dataclasses import dataclass, field
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .client import Client, CloudflareBlockedError, FilteredNetworkError
from .core import WORK_ROOT, Progress, default_output_name, download_to_pdf
from .downloader import Cancelled
from .ranges import select_chapters
from .scraper import Chapter, Series, get_chapters, get_series

STATIC_DIR = Path(__file__).parent / "static"
DOWNLOADS_DIR = Path("downloads")
FINAL_STATES = {"done", "failed", "cancelled"}


class SeriesRequest(BaseModel):
    url: str


class SelectRequest(BaseModel):
    series_id: str
    spec: str
    include_extras: bool = False


class JobRequest(BaseModel):
    series_id: str
    chapter_ids: list[str]


@dataclass
class Job:
    id: str
    series: Series
    chapters: list[Chapter]
    output: Path
    state: str = "queued"  # queued -> running -> done | failed | cancelled
    progress: Progress | None = None
    error: str | None = None
    page_count: int = 0
    cancel: threading.Event = field(default_factory=threading.Event)

    def snapshot(self) -> dict:
        p = self.progress
        return {
            "id": self.id,
            "state": self.state,
            "title": self.series.title,
            "filename": self.output.name,
            "stage": p.stage if p else None,
            "chapter_index": p.chapter_index if p else 0,
            "chapter_total": len(self.chapters),
            "chapter_name": p.chapter_name if p else None,
            "page_done": p.page_done if p else 0,
            "page_total": p.page_total if p else 0,
            "page_count": self.page_count,
            "size": self.output.stat().st_size if self.state == "done" and self.output.exists() else 0,
            "error": self.error,
        }


def _error_message(exc: Exception) -> str:
    if isinstance(exc, (FilteredNetworkError, CloudflareBlockedError, ValueError)):
        return str(exc)
    return f"{type(exc).__name__}: {exc}"


def create_app(
    client: Client | None = None,
    downloads_dir: Path = DOWNLOADS_DIR,
    work_root: Path = WORK_ROOT,
    delay: float = 1.0,
) -> FastAPI:
    app = FastAPI(title="mangadl")
    http = client or Client()
    series_cache: dict[str, tuple[Series, list[Chapter]]] = {}
    jobs: dict[str, Job] = {}
    pending: queue.Queue[Job] = queue.Queue()
    worker_started = threading.Event()

    def worker() -> None:
        while True:
            job = pending.get()
            if job.cancel.is_set():
                continue
            job.state = "running"

            def on_progress(progress: Progress, job: Job = job) -> None:
                job.progress = progress

            try:
                job.page_count = download_to_pdf(
                    http, job.series, job.chapters, job.output,
                    work_root=work_root, delay=delay, on_progress=on_progress, cancel=job.cancel,
                )
                job.state = "done"
            except Cancelled:
                job.state = "cancelled"
            except Exception as exc:  # report any failure to the page
                job.error = _error_message(exc)
                job.state = "failed"

    def ensure_worker() -> None:
        if not worker_started.is_set():
            worker_started.set()
            threading.Thread(target=worker, name="mangadl-worker", daemon=True).start()

    def cached_series(series_id: str) -> tuple[Series, list[Chapter]]:
        if series_id not in series_cache:
            raise HTTPException(404, "Unknown series. Load the series link first.")
        return series_cache[series_id]

    def get_job(job_id: str) -> Job:
        if job_id not in jobs:
            raise HTTPException(404, "Unknown download.")
        return jobs[job_id]

    @app.post("/api/series")
    def load_series(req: SeriesRequest) -> dict:
        try:
            series = get_series(http, req.url)
            chapters = get_chapters(http, series.id)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        except Exception as exc:
            raise HTTPException(502, _error_message(exc)) from exc
        if not chapters:
            raise HTTPException(502, "No chapters found on the series page. The site layout may have changed.")
        series_cache[series.id] = (series, chapters)
        return {
            "id": series.id,
            "title": series.title,
            "has_cover": series.cover_url is not None,
            "chapters": [{"id": c.id, "name": c.name, "number": c.number} for c in chapters],
        }

    @app.get("/api/series/{series_id}/cover")
    def cover(series_id: str) -> Response:
        series, _ = cached_series(series_id)
        if not series.cover_url:
            raise HTTPException(404, "No cover image.")
        try:
            image = http.get(series.cover_url)
        except Exception as exc:
            raise HTTPException(502, _error_message(exc)) from exc
        media_type = image.headers.get("content-type", "image/jpeg")
        return Response(image.content, media_type=media_type, headers={"Cache-Control": "max-age=86400"})

    @app.post("/api/select")
    def select(req: SelectRequest) -> dict:
        _, chapters = cached_series(req.series_id)
        try:
            picked = select_chapters(chapters, req.spec, include_extras=req.include_extras)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        return {"chapter_ids": [c.id for c in picked]}

    @app.post("/api/jobs")
    def start_job(req: JobRequest) -> dict:
        series, chapters = cached_series(req.series_id)
        wanted = set(req.chapter_ids)
        picked = [c for c in chapters if c.id in wanted]  # keep reading order
        if not picked:
            raise HTTPException(400, "Select at least one chapter.")
        job = Job(
            id=uuid.uuid4().hex,
            series=series,
            chapters=picked,
            output=downloads_dir / default_output_name(series.title, picked),
        )
        jobs[job.id] = job
        ensure_worker()
        pending.put(job)
        return job.snapshot()

    @app.get("/api/jobs/{job_id}")
    def job_status(job_id: str) -> dict:
        return get_job(job_id).snapshot()

    @app.get("/api/jobs/{job_id}/events")
    async def job_events(job_id: str) -> StreamingResponse:
        job = get_job(job_id)

        async def stream():
            last = None
            while True:
                snap = job.snapshot()
                if snap != last:
                    yield f"data: {json.dumps(snap)}\n\n"
                    last = snap
                if snap["state"] in FINAL_STATES:
                    return
                await asyncio.sleep(0.25)

        return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})

    @app.get("/api/jobs/{job_id}/file")
    def job_file(job_id: str) -> FileResponse:
        job = get_job(job_id)
        if job.state != "done" or not job.output.exists():
            raise HTTPException(409, "The PDF is not ready.")
        return FileResponse(job.output, media_type="application/pdf", filename=job.output.name)

    @app.delete("/api/jobs/{job_id}")
    def cancel_job(job_id: str) -> dict:
        job = get_job(job_id)
        if job.state in FINAL_STATES:
            raise HTTPException(409, "This download has already finished.")
        job.cancel.set()
        if job.state == "queued":
            job.state = "cancelled"
        return job.snapshot()

    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
    return app


def main() -> None:
    import uvicorn

    parser = argparse.ArgumentParser(prog="mangadl-web", description="Run the mangadl web app on this computer.")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-browser", action="store_true", help="don't open the browser automatically")
    args = parser.parse_args()

    url = f"http://127.0.0.1:{args.port}"
    print(f"mangadl is running at {url}  (press Ctrl+C to stop)")
    if not args.no_browser:
        threading.Timer(1.0, webbrowser.open, args=(url,)).start()
    uvicorn.run(create_app(), host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
