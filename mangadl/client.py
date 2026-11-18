"""Shared HTTP session: browser-like headers, retries with backoff, clear errors."""

from __future__ import annotations

import ssl
import time

import httpx

BASE_URL = "https://weebcentral.com"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
RETRY_STATUS = {429, 500, 502, 503, 504}


class FilteredNetworkError(RuntimeError):
    """The TLS certificate was rejected, typically because a firewall intercepts the site."""


class CloudflareBlockedError(RuntimeError):
    """Cloudflare answered with a browser challenge instead of the page."""


def _is_cert_error(exc: BaseException) -> bool:
    seen: BaseException | None = exc
    while seen is not None:
        if isinstance(seen, ssl.SSLCertVerificationError) or "CERTIFICATE_VERIFY_FAILED" in str(seen):
            return True
        seen = seen.__cause__ or seen.__context__
    return False


def _looks_like_cloudflare_challenge(response: httpx.Response) -> bool:
    if response.status_code not in (403, 503):
        return False
    text = response.text[:5000].lower()
    return "just a moment" in text or "cf-chl" in text or "challenge-platform" in text


class Client:
    def __init__(self, retries: int = 3, timeout: float = 30.0) -> None:
        self.retries = retries
        self._http = httpx.Client(
            headers={"User-Agent": USER_AGENT, "Referer": BASE_URL + "/"},
            timeout=timeout,
            follow_redirects=True,
        )

    def get(self, url: str, **kwargs) -> httpx.Response:
        last_error: Exception | None = None
        for attempt in range(self.retries + 1):
            wait = 2.0 ** attempt
            try:
                response = self._http.get(url, **kwargs)
            except httpx.ConnectError as exc:
                if _is_cert_error(exc):
                    raise FilteredNetworkError(
                        f"The certificate check failed for {httpx.URL(url).host}. A firewall on this "
                        "network (for example a university web filter) is intercepting the connection. "
                        "Run mangadl on a different network, such as home Wi-Fi or a phone hotspot."
                    ) from exc
                last_error = exc
            except (httpx.TimeoutException, httpx.NetworkError, httpx.RemoteProtocolError) as exc:
                last_error = exc
            else:
                if _looks_like_cloudflare_challenge(response):
                    raise CloudflareBlockedError(
                        "Cloudflare returned a browser challenge instead of the page, so plain "
                        "requests are being blocked. A browser-based fetcher (Playwright) is needed."
                    )
                if response.status_code not in RETRY_STATUS:
                    response.raise_for_status()
                    return response
                last_error = RuntimeError(f"HTTP {response.status_code} for {url}")
                retry_after = response.headers.get("Retry-After", "")
                if retry_after.isdigit():
                    wait = max(wait, float(retry_after))
            if attempt < self.retries:
                time.sleep(wait)
        assert last_error is not None
        raise last_error

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "Client":
        return self

    def __exit__(self, *exc_info) -> None:
        self.close()
