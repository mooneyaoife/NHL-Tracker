#!/usr/bin/env python3
"""Small, injectable adapters for untrusted upstream HTTP responses."""

from __future__ import annotations

import csv
import io
import json
import time
import urllib.error
import urllib.request
from typing import Callable


class SourceClient:
    def __init__(self, opener: Callable = urllib.request.urlopen, sleeper: Callable = time.sleep):
        self.opener = opener
        self.sleeper = sleeper

    def _read(self, url: str, *, accept: str, user_agent: str, timeout: int,
            attempts: int, errors: tuple[type[BaseException], ...], max_delay: int) -> bytes:
        last_error = None
        for attempt in range(attempts):
            try:
                request = urllib.request.Request(url, headers={"Accept": accept, "User-Agent": user_agent})
                with self.opener(request, timeout=timeout) as response:
                    return response.read()
            except errors as exc:
                last_error = exc
                if attempt + 1 < attempts:
                    self.sleeper(min(max_delay, 2 ** attempt))
        raise RuntimeError(f"Unable to fetch {url}: {last_error}")

    def json(self, url: str, attempts: int = 4) -> dict:
        last_error = None
        for attempt in range(attempts):
            try:
                body = self._read(url, accept="application/json", user_agent="NHL-Tracker/1.0",
                    timeout=30, attempts=1,
                    errors=(urllib.error.URLError, TimeoutError), max_delay=8)
                value = json.loads(body.decode("utf-8"))
                if not isinstance(value, dict):
                    raise ValueError("JSON response must be an object")
                return value
            except (RuntimeError, UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
                last_error = exc
                if attempt + 1 < attempts:
                    self.sleeper(min(8, 2 ** attempt))
        raise RuntimeError(f"Unable to fetch {url}: {last_error}")

    def text(self, url: str, attempts: int = 3) -> str:
        body = self._read(url, accept="text/html,application/rss+xml", user_agent="NHL-Tracker/5.20",
            timeout=30, attempts=attempts,
            errors=(urllib.error.URLError, TimeoutError, UnicodeDecodeError), max_delay=4)
        return body.decode("utf-8", errors="replace")

    def csv(self, url: str, attempts: int = 4) -> list[dict]:
        last_error = None
        for attempt in range(attempts):
            try:
                body = self._read(url, accept="text/csv,*/*", user_agent="NHL-Tracker/3.0",
                    timeout=45, attempts=1,
                    errors=(urllib.error.URLError, TimeoutError), max_delay=8)
                text = body.decode("utf-8-sig")
                if text.lstrip().lower().startswith(("<!doctype html", "<html")):
                    raise ValueError("download returned an HTML page rather than CSV data")
                rows = list(csv.DictReader(io.StringIO(text)))
                if not rows or len(rows[0]) < 2:
                    raise ValueError("download did not contain a usable CSV table")
                return rows
            except (RuntimeError, UnicodeDecodeError, csv.Error, ValueError) as exc:
                last_error = exc
                if attempt + 1 < attempts:
                    self.sleeper(min(8, 2 ** attempt))
        raise RuntimeError(f"Unable to fetch {url}: {last_error}")


DEFAULT_CLIENT = SourceClient()


def fetch_json(url: str, attempts: int = 4) -> dict:
    return DEFAULT_CLIENT.json(url, attempts)


def fetch_text(url: str, attempts: int = 3) -> str:
    return DEFAULT_CLIENT.text(url, attempts)


def fetch_csv(url: str, attempts: int = 4) -> list[dict]:
    return DEFAULT_CLIENT.csv(url, attempts)
