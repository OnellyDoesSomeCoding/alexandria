# mangadl

Downloads chapters from weebcentral.com and bundles them into one PDF with a bookmark per chapter.
It requests the site's chapter-list and page-image data directly, so no reader page or ads are loaded.

## Setup

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -e ".[dev]"
```

## Web app

Double-click `start.bat` (it sets everything up the first time), or run:

```powershell
.venv\Scripts\python -m mangadl.web            # opens http://127.0.0.1:8000
.venv\Scripts\python -m mangadl.web --port 8080 --no-browser
```

Paste a series link, pick chapters (type a range like `1-20`, tick boxes, or shift-click a run),
then Download PDF and Save PDF when it finishes. Finished PDFs are also kept in `downloads/`.
The app only listens on this computer. Close the window (or press Ctrl+C) to stop it.

## Command line

```powershell
# See which chapters exist
.venv\Scripts\python -m mangadl "https://weebcentral.com/series/01J76XYFD97DRQQKK75FZB7PQH/Gachiakuta" --list

# Download chapters 1-20 into "Gachiakuta - Ch 1-20.pdf"
.venv\Scripts\python -m mangadl "https://weebcentral.com/series/01J76XYFD97DRQQKK75FZB7PQH/Gachiakuta" --chapters 1-20
```

| Option | Meaning |
|---|---|
| `--chapters 1-20` | Also `5`, `1-5,8,10-12`, `100-` (100 to latest), `all`. Decimal chapters (10.5) inside a range are included. |
| `--include-extras` | Include unnumbered extras/specials that sit inside the range. |
| `-o PATH` | Output `.pdf` file or folder. |
| `--workers 4` | Parallel image downloads. |
| `--delay 1` | Seconds between chapters (be polite to the site). |

Images are downloaded to `.mangadl-tmp/` and deleted once the PDF is built. If a run stops
partway, they are kept; run the same command again to resume.

## Networks that filter the site

Some networks (for example university firewalls) intercept weebcentral.com. mangadl then stops with
a certificate error message. Run it on a different network, such as home Wi-Fi or a phone hotspot.

## Tests

```powershell
.venv\Scripts\python -m pytest
```
