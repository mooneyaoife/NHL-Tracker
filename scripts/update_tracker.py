#!/usr/bin/env python3
"""Fetch NHL data and build the static website dataset."""

from __future__ import annotations

import json
import csv
import html
import io
import math
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
CONFIG = json.loads((ROOT / "config.json").read_text())
VERSION = "5.71.0"
SEASON = str(CONFIG["season"])
TRACKED = [str(t).upper() for t in CONFIG["teams"]]
API = "https://api-web.nhle.com/v1"
STATS_API = "https://api.nhle.com/stats/rest/en"
CACHE = ROOT / "data" / "cache" / "boxscores"
OUTPUT = ROOT / "site" / "data" / "tracker.json"
CALENDAR_DIR = ROOT / "site" / "data" / "calendars"
MP_SEASON = SEASON[:4]
MP_BASE = f"https://moneypuck.com/moneypuck/playerData/seasonSummary/{MP_SEASON}/regular"
NST_FILE = ROOT / "data" / "naturalstattrick" / f"team_{SEASON}_regular_5v5_sva.csv"
NST_PLAYER_FILE = ROOT / "data" / "naturalstattrick" / f"player_{SEASON}_regular_5v5.csv"
NST_GOALIE_FILE = ROOT / "data" / "naturalstattrick" / f"goalie_{SEASON}_regular_5v5.csv"
NST_REFRESH_FILE = ROOT / "data" / "naturalstattrick" / "naturalstattrick-refresh.json"
SCHEDULE_VENUE_FILE = ROOT / "data" / "schedule_venues.json"
SCHEDULE_MODEL_VERSION = "workbook-2026-07-17"
SCHEDULE_WEIGHTS = {
    "opponentStrength": 0.28,
    "travelDistance": 0.14,
    "backToBacks": 0.10,
    "congestion": 0.10,
    "restBurden": 0.10,
    "roadFrequency": 0.07,
    "roadTripBurden": 0.08,
    "timeZoneChanges": 0.05,
    "congestedOpponentStrength": 0.05,
    "timingAndEvents": 0.03,
}
SCHEDULE_EXPECTATIONS = {
    "20262027": {"earliestDate": "2026-09-29", "latestDate": "2027-04-10"},
}
SCHEDULE_WORKBOOK_BENCHMARKS = {
    "20262027": {"SEA": 66.7, "BUF": 45.6, "VGK": 27.8},
}
TEAM_NICKNAMES = {
    "ANA":"ducks","BOS":"bruins","BUF":"sabres","CAR":"hurricanes","CBJ":"blue jackets","CGY":"flames","CHI":"blackhawks","COL":"avalanche",
    "DAL":"stars","DET":"red wings","EDM":"oilers","FLA":"panthers","LAK":"kings","MIN":"wild","MTL":"canadiens","NJD":"devils","NSH":"predators",
    "NYI":"islanders","NYR":"rangers","OTT":"senators","PHI":"flyers","PIT":"penguins","SEA":"kraken","SJS":"sharks","STL":"blues","TBL":"lightning",
    "TOR":"maple leafs","UTA":"mammoth","VAN":"canucks","VGK":"golden knights","WPG":"jets","WSH":"capitals"
}
TEAM_CALENDAR_COLOURS = {
    "ANA":"#F47A38", "BOS":"#FFB81C", "BUF":"#003087", "CAR":"#CC0000", "CBJ":"#002654", "CGY":"#D2001C", "CHI":"#CF0A2C", "COL":"#6F263D",
    "DAL":"#006847", "DET":"#CE1126", "EDM":"#FF4C00", "FLA":"#C8102E", "LAK":"#111111", "MIN":"#154734", "MTL":"#AF1E2D", "NJD":"#CE1126",
    "NSH":"#FFB81C", "NYI":"#00539B", "NYR":"#0038A8", "OTT":"#C52032", "PHI":"#F74902", "PIT":"#CFC493", "SEA":"#007A9A", "SJS":"#006D75",
    "STL":"#002F87", "TBL":"#002868", "TOR":"#003E7E", "UTA":"#71AFE5", "VAN":"#00205B", "VGK":"#B4975A", "WPG":"#041E42", "WSH":"#C8102E"
}
PODCASTS = [
    ("32 Thoughts", "Elliotte Friedman and Kyle Bukauskas", "https://feeds.simplecast.com/fYqFr5h_", "https://podcasts.apple.com/us/podcast/32-thoughts-the-podcast/id1332150124"),
    ("The Athletic Hockey Show", "The Athletic NHL staff", "https://feeds.acast.com/public/shows/6818bb89f30c20bff73c9ebc", "https://podcasts.apple.com/us/podcast/the-athletic-hockey-show/id1546282862"),
    ("The Sheet", "Jeff Marek", "https://feeds.acast.com/public/shows/672c0e761e4926b519960bc2", "https://podcasts.apple.com/us/podcast/the-sheet-with-jeff-marek/id1778349773")
]
VIDEO_CHANNELS = [
    ("NHL", "UCqFMzb-4AUf6WAIbl132QKA"),
    ("Sportsnet", "UCVhibwHk4WKw4leUt6JfRLg"),
    ("TSN", "UCXoJ8kY9zpLBEz-8saaT3ew")
]
TRANSACTIONS_FEED = "https://www.prohockeyrumors.com/transactions/feed"


def set_active_season(season: str) -> None:
    """Point every season-specific source at the selected NHL season."""
    global SEASON, MP_SEASON, MP_BASE, NST_FILE, NST_PLAYER_FILE, NST_GOALIE_FILE
    SEASON = str(season)
    MP_SEASON = SEASON[:4]
    MP_BASE = f"https://moneypuck.com/moneypuck/playerData/seasonSummary/{MP_SEASON}/regular"
    NST_FILE = ROOT / "data" / "naturalstattrick" / f"team_{SEASON}_regular_5v5_sva.csv"
    NST_PLAYER_FILE = ROOT / "data" / "naturalstattrick" / f"player_{SEASON}_regular_5v5.csv"
    NST_GOALIE_FILE = ROOT / "data" / "naturalstattrick" / f"goalie_{SEASON}_regular_5v5.csv"


def calendar_season(now: datetime | None = None) -> str:
    now = now or datetime.now(timezone.utc)
    start = now.year if now.month >= 7 else now.year - 1
    return f"{start}{start + 1}"


def regular_season_games(season: str) -> int:
    """Return the scheduled games per club for an NHL season."""
    return 84 if int(str(season)[:4]) >= 2026 else 82


def schedule_release_state(season: str, games: list[dict], previous: dict | None = None) -> dict:
    """Store a compact tracked-team schedule snapshot and describe later changes."""
    previous = previous or {}
    now = datetime.now(timezone.utc).isoformat()
    snapshot = []
    for game in games:
        if int(game.get("gameType") or 0) != 2 or game.get("id") is None:
            continue
        away = localised(game.get("awayTeam", {}).get("abbrev")).upper()
        home = localised(game.get("homeTeam", {}).get("abbrev")).upper()
        if not ({away, home} & set(TRACKED)):
            continue
        snapshot.append({
            "id": str(game["id"]), "date": str(game.get("gameDate") or ""),
            "startTimeUTC": str(game.get("startTimeUTC") or ""),
            "away": away, "home": home, "venue": localised(game.get("venue")),
        })
    snapshot.sort(key=lambda row: (row["date"], row["startTimeUTC"], row["id"]))
    current_map = {row["id"]: row for row in snapshot}
    previous_map = {str(row.get("id")): row for row in previous.get("snapshot", []) if row.get("id") is not None}
    changes = []
    if previous_map:
        for game_id, row in current_map.items():
            before = previous_map.get(game_id)
            if before is None:
                changes.append({"key": f"added:{game_id}", "kind": "added", "game": row, "detectedAt": now})
            elif (before.get("date"), before.get("startTimeUTC")) != (row["date"], row["startTimeUTC"]):
                changes.append({"key": f"changed:{game_id}:{row['startTimeUTC']}", "kind": "changed", "game": row,
                    "previousDate": before.get("date", ""), "previousStartTimeUTC": before.get("startTimeUTC", ""), "detectedAt": now})
        for game_id, row in previous_map.items():
            if game_id not in current_map:
                changes.append({"key": f"removed:{game_id}", "kind": "removed", "game": row, "detectedAt": now})
    history = changes + list(previous.get("recentChanges", []))
    unique_history = []
    seen = set()
    for change in history:
        key = change.get("key")
        if not key or key in seen:
            continue
        seen.add(key); unique_history.append(change)
    counts = {team: sum(team in {row["away"], row["home"]} for row in snapshot) for team in TRACKED}
    expected = regular_season_games(season)
    complete = bool(counts) and all(count >= expected for count in counts.values())
    return {
        "season": str(season), "capturedAt": now, "expectedGamesPerTeam": expected,
        "counts": counts, "complete": complete, "uniqueGames": len(snapshot),
        "firstSeenAt": previous.get("firstSeenAt") or (now if snapshot else None),
        "completedAt": previous.get("completedAt") or (now if complete else None),
        "lastChangedAt": now if changes else previous.get("lastChangedAt"),
        "recentChanges": unique_history[:30], "snapshot": snapshot,
    }


def next_season_preview(active_season: str, previous: dict | None = None) -> dict:
    """Watch limited opening-night announcements without rolling the active season."""
    candidate = calendar_season()
    if candidate <= str(active_season):
        return {}
    games = {}
    try:
        with ThreadPoolExecutor(max_workers=min(4, len(TRACKED))) as pool:
            futures = [pool.submit(fetch_json, f"{API}/club-schedule-season/{team}/{candidate}") for team in TRACKED]
            for future in as_completed(futures):
                for game in future.result().get("games", []):
                    if game.get("id") is not None:
                        games[str(game["id"])] = game
    except Exception as exc:
        print(f"warning: next-season preview unavailable: {exc}", file=sys.stderr)
        return previous or {}
    return schedule_release_state(candidate, list(games.values()), previous)


def schedule_is_published(season: str) -> tuple[bool, int]:
    """Require every tracked club's full regular-season schedule before rolling forward."""
    expected = regular_season_games(season)

    def regular_count(team: str) -> int:
        games = fetch_json(f"{API}/club-schedule-season/{team}/{season}").get("games", [])
        return sum(int(game.get("gameType") or 0) == 2 and bool(game.get("gameDate")) for game in games)

    with ThreadPoolExecutor(max_workers=min(4, len(TRACKED))) as pool:
        counts = list(pool.map(regular_count, TRACKED))
    minimum = min(counts, default=0)
    return bool(counts) and minimum >= expected, minimum


def resolve_active_season() -> tuple[str, str]:
    configured = str(CONFIG["season"])
    if str(CONFIG.get("seasonMode", "manual")).lower() != "auto":
        return configured, "Season is manually pinned"
    candidate = calendar_season()
    if candidate <= configured:
        return configured, "Configured season remains current"
    try:
        ready, games = schedule_is_published(candidate)
    except Exception as exc:
        print(f"warning: new-season schedule check failed: {exc}", file=sys.stderr)
        return configured, "New-season schedule could not be verified"
    if ready:
        return candidate, f"NHL published all {games} regular-season games for every tracked team"
    return configured, f"Waiting for the complete NHL schedule ({games} games found for the least-complete tracked team)"


def fetch_json(url: str, attempts: int = 4) -> dict:
    last_error = None
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "NHL-Tracker/1.0"})
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = exc
            time.sleep(min(8, 2 ** attempt))
    raise RuntimeError(f"Unable to fetch {url}: {last_error}")


def fetch_text(url: str, attempts: int = 3) -> str:
    last_error = None
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers={"Accept": "text/html,application/rss+xml", "User-Agent": "NHL-Tracker/5.20"})
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.read().decode("utf-8", errors="replace")
        except (urllib.error.URLError, TimeoutError, UnicodeDecodeError) as exc:
            last_error = exc
            time.sleep(min(4, 2 ** attempt))
    raise RuntimeError(f"Unable to fetch {url}: {last_error}")


def clean_markup(value: str) -> str:
    value = re.sub(r"<[^>]+>", " ", value or "")
    return re.sub(r"\s+", " ", html.unescape(value)).strip()


def news_category(text: str) -> str:
    text = text.casefold()
    if re.search(r"\b(trade|signs?|signed|contract|acquire|acquired|waiver|arbitration|free agent|offer sheet|hired?|named)\b", text): return "Moves"
    if re.search(r"\b(injur|surgery|out for|miss(?:es|ing)?|health|concussion)\b", text): return "Injuries"
    if re.search(r"\b(draft|prospect|development camp|rookie|world junior)\b", text): return "Prospects"
    if re.search(r"\b(analysis|outlook|reset|ranking|fantasy|projection|season preview)\b", text): return "Analysis"
    return "League"


def load_official_news(standings: list[dict], rosters: dict, previous: dict) -> dict:
    """Extract headline metadata from NHL.com's public news page; articles remain on NHL.com."""
    try:
        page = fetch_text("https://www.nhl.com/news/")
        blocks = re.findall(r'<a class="nhl-c-card-wrap[^>]*?href="([^"]+)"[^>]*>(.*?</article>)', page, flags=re.S | re.I)
        articles, seen = [], set()
        for href, block in blocks:
            title_match = re.search(r'<h3[^>]*>(.*?)</h3>', block, flags=re.S | re.I)
            if not title_match: continue
            title = clean_markup(title_match.group(1))
            summary_match = re.search(r'<div class="fa-text__body"[^>]*>\s*<p>(.*?)</p>', block, flags=re.S | re.I)
            time_match = re.search(r'<time[^>]*datetime="([^"]+)"', block, flags=re.I)
            image_match = re.search(r'<img[^>]*class="img-responsive"[^>]*src="([^"]+)"', block, flags=re.I)
            url = href if href.startswith("http") else f"https://www.nhl.com{href}"
            if url in seen: continue
            seen.add(url)
            summary = clean_markup(summary_match.group(1) if summary_match else "")
            haystack = f"{title} {summary} {url}".casefold()
            tagged = []
            for team in standings:
                code, name = team["team"], team["name"]
                nickname = TEAM_NICKNAMES.get(code, name.split()[-1]).casefold()
                team_slug = re.sub(r"[^a-z0-9]+", "-", name.casefold()).strip("-")
                player_hit = any(p.get("name", "").casefold() in haystack for p in rosters.get(code, []) if len(p.get("name", "")) > 5)
                if name.casefold() in haystack or re.search(rf"\b{re.escape(nickname)}\b", haystack) or team_slug in haystack or player_hit:
                    tagged.append(code)
            articles.append({"title": title, "summary": summary, "url": url, "image": html.unescape(image_match.group(1)) if image_match else "", "publishedAt": time_match.group(1) if time_match else "", "teams": tagged, "category": news_category(haystack), "source": "NHL.com"})
            if len(articles) >= 48: break
        return {"updatedAt": datetime.now(timezone.utc).isoformat(), "status": "Ready", "articles": articles}
    except Exception as exc:
        print(f"warning: official NHL news unavailable: {exc}", file=sys.stderr)
        return previous.get("news") or {"updatedAt": None, "status": "Temporarily unavailable", "articles": []}


def load_reported_transactions(standings: list[dict], rosters: dict, previous: dict) -> dict:
    """Load transaction headlines from a public RSS feed; every item remains explicitly secondary."""
    try:
        root = ET.fromstring(fetch_text(TRANSACTIONS_FEED))
        items = []
        for item in root.findall(".//item")[:60]:
            title = clean_markup(item.findtext("title") or "")
            url = (item.findtext("link") or "").strip()
            description = clean_markup(item.findtext("description") or "")
            categories = [clean_markup(node.text or "") for node in item.findall("category")]
            haystack = " ".join([title, description, *categories]).casefold()
            tagged = []
            for team in standings:
                code, name = team["team"], team["name"]
                nickname = TEAM_NICKNAMES.get(code, name.split()[-1]).casefold()
                player_hit = any(p.get("name", "").casefold() in haystack for p in rosters.get(code, []) if len(p.get("name", "")) > 5)
                if name.casefold() in haystack or re.search(rf"\b{re.escape(nickname)}\b", haystack) or player_hit:
                    tagged.append(code)
            published = item.findtext("pubDate") or ""
            try: published = parsedate_to_datetime(published).astimezone(timezone.utc).isoformat()
            except (TypeError, ValueError): pass
            if title and url:
                items.append({"title": title, "url": url, "publishedAt": published, "teams": tagged,
                    "source": "Pro Hockey Rumors", "status": "Reported"})
        return {"updatedAt": datetime.now(timezone.utc).isoformat(), "status": "Ready", "items": items}
    except Exception as exc:
        print(f"warning: reported transactions unavailable: {exc}", file=sys.stderr)
        return previous.get("transactions") or {"updatedAt": None, "status": "Temporarily unavailable", "items": []}


def load_podcasts(previous: dict) -> dict:
    episodes = []
    for show, host, feed, fallback in PODCASTS:
        try:
            root = ET.fromstring(fetch_text(feed))
            item = root.find(".//item")
            if item is None: continue
            link = (item.findtext("link") or fallback).strip()
            published = item.findtext("pubDate") or ""
            try: published = parsedate_to_datetime(published).astimezone(timezone.utc).isoformat()
            except (TypeError, ValueError): pass
            episodes.append({"show": show, "host": host, "title": clean_markup(item.findtext("title") or "Latest episode"), "summary": clean_markup(item.findtext("description") or "")[:280], "url": link, "publishedAt": published})
        except Exception as exc:
            print(f"warning: podcast {show} unavailable: {exc}", file=sys.stderr)
    return {"updatedAt": datetime.now(timezone.utc).isoformat(), "episodes": episodes} if episodes else previous.get("podcasts", {"updatedAt": None, "episodes": []})


def load_videos(standings: list[dict], previous: dict) -> dict:
    videos = []
    atom = {"a":"http://www.w3.org/2005/Atom", "yt":"http://www.youtube.com/xml/schemas/2015", "media":"http://search.yahoo.com/mrss/"}
    hockey_terms = re.compile(r"\b(nhl|hockey|stanley cup|free agency|trade|draft|goalie|skater)\b", re.I)
    for channel, channel_id in VIDEO_CHANNELS:
        try:
            root = ET.fromstring(fetch_text(f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"))
            for entry in root.findall("a:entry", atom):
                title = clean_markup(entry.findtext("a:title", default="", namespaces=atom))
                haystack = title.casefold()
                tagged = []
                for team in standings:
                    nickname = TEAM_NICKNAMES.get(team["team"], team["name"].split()[-1]).casefold()
                    if team["name"].casefold() in haystack or re.search(rf"\b{re.escape(nickname)}\b", haystack): tagged.append(team["team"])
                if channel != "NHL" and not hockey_terms.search(title) and not tagged: continue
                video_id = entry.findtext("yt:videoId", default="", namespaces=atom)
                thumb = entry.find("media:group/media:thumbnail", atom)
                videos.append({"channel":channel, "title":title, "url":f"https://www.youtube.com/watch?v={video_id}", "thumbnail":thumb.get("url", "") if thumb is not None else "", "publishedAt":entry.findtext("a:published", default="", namespaces=atom), "teams":tagged})
        except Exception as exc:
            print(f"warning: YouTube channel {channel} unavailable: {exc}", file=sys.stderr)
    videos.sort(key=lambda x: x.get("publishedAt", ""), reverse=True)
    return {"updatedAt": datetime.now(timezone.utc).isoformat(), "videos": videos[:18]} if videos else previous.get("videos", {"updatedAt": None, "videos": []})


def fetch_csv(url: str, attempts: int = 4) -> list[dict]:
    last_error = None
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "NHL-Tracker/3.0"})
            with urllib.request.urlopen(request, timeout=45) as response:
                text = response.read().decode("utf-8-sig")
                if text.lstrip().lower().startswith(("<!doctype html", "<html")):
                    raise ValueError("download returned an HTML page rather than CSV data")
                rows = list(csv.DictReader(io.StringIO(text)))
                if not rows or len(rows[0]) < 2:
                    raise ValueError("download did not contain a usable CSV table")
                return rows
        except (urllib.error.URLError, TimeoutError, UnicodeDecodeError, csv.Error, ValueError) as exc:
            last_error = exc; time.sleep(min(8, 2 ** attempt))
    raise RuntimeError(f"Unable to fetch {url}: {last_error}")


def mp_value(row: dict, *names, default=""):
    for name in names:
        if row.get(name) not in (None, ""):
            value = row[name]
            try: return float(value)
            except (TypeError, ValueError): return value
    return default


def load_moneypuck_team_games(previous: list[dict] | None = None, previous_special: list[dict] | None = None) -> tuple[list[dict], list[dict]]:
    """Load the explicitly published team game-by-game files without scraping pages."""
    aliases = {"L.A": "LAK", "N.J": "NJD", "S.J": "SJS", "T.B": "TBL"}
    normalise_team = lambda value: aliases.get(str(value).upper(), str(value).upper())

    def one_team(team: str) -> tuple[list[dict], list[dict]]:
        url = f"https://moneypuck.com/moneypuck/playerData/teamGameByGame/{MP_SEASON}/regular/{team}.csv"
        raw = fetch_csv(url, attempts=1)
        if "gameId" not in raw[0]:
            raise ValueError(f"{team} game file has no gameId column")
        games, special = {}, []
        for row in raw:
            game_id = str(row.get("gameId", "")).split(".")[0]
            if not game_id:
                continue
            code = normalise_team(mp_value(row, "playerTeam", "team", "name", default=team))
            if code != team:
                continue
            situation = str(row.get("situation", "all")).lower().replace(" ", "")
            if situation in {"5on4", "4on5"}:
                special.append({
                    "gameId": game_id, "team": code, "role": "powerPlay" if situation == "5on4" else "penaltyKill",
                    "opponent": normalise_team(mp_value(row, "opposingTeam")),
                    "date": str(mp_value(row, "gameDate", default="")),
                    "minutes": round(float(mp_value(row, "icetime", "iceTime", default=0) or 0) / 60, 2),
                    "xgf": mp_value(row, "xGoalsFor"), "xga": mp_value(row, "xGoalsAgainst"),
                    "gf": mp_value(row, "goalsFor"), "ga": mp_value(row, "goalsAgainst"),
                    "shotsFor": mp_value(row, "shotsOnGoalFor"), "shotsAgainst": mp_value(row, "shotsOnGoalAgainst"),
                })
                continue
            if situation not in {"all", "allsituations"}:
                continue
            games[game_id] = {
                "gameId": game_id, "team": code,
                "opponent": normalise_team(mp_value(row, "opposingTeam")),
                "date": str(mp_value(row, "gameDate", default="")),
                "homeAway": str(mp_value(row, "home_or_away", "homeAway", default="")),
                "xgf": mp_value(row, "xGoalsFor"), "xga": mp_value(row, "xGoalsAgainst"),
                "xgPct": mp_value(row, "xGoalsPercentage"),
                "gf": mp_value(row, "goalsFor"), "ga": mp_value(row, "goalsAgainst"),
                "corsiPct": mp_value(row, "corsiPercentage"),
                "fenwickPct": mp_value(row, "fenwickPercentage"),
                "shotsFor": mp_value(row, "shotsOnGoalFor"),
                "shotsAgainst": mp_value(row, "shotsOnGoalAgainst"),
                "hdFor": mp_value(row, "highDangerShotsFor"),
                "hdAgainst": mp_value(row, "highDangerShotsAgainst")
            }
        return list(games.values()), special

    rows, special_rows, errors = [], [], []
    with ThreadPoolExecutor(max_workers=min(4, len(TRACKED))) as executor:
        futures = {executor.submit(one_team, team): team for team in TRACKED}
        for future in as_completed(futures):
            try:
                team_games, team_special = future.result()
                rows.extend(team_games); special_rows.extend(team_special)
            except Exception as exc: errors.append(f"{futures[future]}: {exc}")
    if errors:
        print(f"warning: MoneyPuck team game files unavailable ({'; '.join(errors)})", file=sys.stderr)
    if not rows and previous:
        rows = previous
    if not special_rows and previous_special:
        special_rows = previous_special
    return (sorted(rows, key=lambda row: (row.get("date", ""), row.get("gameId", ""), row.get("team", ""))),
        sorted(special_rows, key=lambda row: (row.get("date", ""), row.get("gameId", ""), row.get("team", ""), row.get("role", ""))))


def load_moneypuck(previous: dict | None = None) -> dict:
    """Approved non-commercial CSV downloads. Displayed data must credit MoneyPuck.com."""
    teams_raw = fetch_csv(f"{MP_BASE}/teams.csv")
    skaters_raw = fetch_csv(f"{MP_BASE}/skaters.csv")
    goalies_raw = fetch_csv(f"{MP_BASE}/goalies.csv")
    lines_raw = fetch_csv(f"{MP_BASE}/lines.csv")
    simulations = fetch_csv("https://moneypuck.com/moneypuck/simulations/simulations_recent.csv")
    situation = lambda r: str(r.get("situation", "all")).lower() in {"all", "all situations"}
    teams = [{"team": mp_value(r,"team"), "games":mp_value(r,"games_played","gamesPlayed"),
        "xgPct":mp_value(r,"xGoalsPercentage"), "corsiPct":mp_value(r,"corsiPercentage"),
        "fenwickPct":mp_value(r,"fenwickPercentage"), "xgf":mp_value(r,"xGoalsFor"),
        "xga":mp_value(r,"xGoalsAgainst"), "gf":mp_value(r,"goalsFor"), "ga":mp_value(r,"goalsAgainst"),
        "hdFor":mp_value(r,"highDangerShotsFor"), "hdAgainst":mp_value(r,"highDangerShotsAgainst")}
        for r in teams_raw if situation(r)]
    special_teams = [{"team":mp_value(r,"team"), "role":"powerPlay" if str(r.get("situation", "")).lower().replace(" ", "")=="5on4" else "penaltyKill",
        "minutes":round(float(mp_value(r,"icetime","iceTime",default=0) or 0)/60,1),
        "xgf":mp_value(r,"xGoalsFor"), "xga":mp_value(r,"xGoalsAgainst"),
        "gf":mp_value(r,"goalsFor"), "ga":mp_value(r,"goalsAgainst"),
        "shotsFor":mp_value(r,"shotsOnGoalFor"), "shotsAgainst":mp_value(r,"shotsOnGoalAgainst"),
        "hdFor":mp_value(r,"highDangerShotsFor"), "hdAgainst":mp_value(r,"highDangerShotsAgainst")}
        for r in teams_raw if str(r.get("situation", "")).lower().replace(" ", "") in {"5on4", "4on5"}]
    skaters = [{"id":str(r.get("playerId", "")).split(".")[0],"name":mp_value(r,"name"),"team":mp_value(r,"team"),"position":mp_value(r,"position"),
        "games":mp_value(r,"games_played"),"minutes":round(float(mp_value(r,"icetime",default=0) or 0)/60,1),
        "goals":mp_value(r,"I_F_goals","goals"),"assists":mp_value(r,"I_F_primaryAssists",default=0)+mp_value(r,"I_F_secondaryAssists",default=0),
        "points":mp_value(r,"I_F_points"),"xGoals":mp_value(r,"I_F_xGoals"),"goalsAboveExpected":mp_value(r,"I_F_goalsAboveExpected"),
        "onIceXgPct":mp_value(r,"onIce_xGoalsPercentage"),"relativeXgPct":mp_value(r,"onIce_xGoalsPercentage",default=0)-mp_value(r,"offIce_xGoalsPercentage",default=0),
        "corsiPct":mp_value(r,"onIce_corsiPercentage"),"fenwickPct":mp_value(r,"onIce_fenwickPercentage"),"highDanger":mp_value(r,"I_F_highDangerShots")}
        for r in skaters_raw if situation(r)]
    goalies = [{"id":str(r.get("playerId", "")).split(".")[0],"name":mp_value(r,"name"),"team":mp_value(r,"team"),"games":mp_value(r,"games_played"),
        "minutes":round(float(mp_value(r,"icetime",default=0) or 0)/60,1),"shots":mp_value(r,"shotsOnGoal","unblocked_shot_attempts"),
        "goalsAgainst":mp_value(r,"goals"),"xGoalsAgainst":mp_value(r,"xGoals"),"gsax":mp_value(r,"xGoals",default=0)-mp_value(r,"goals",default=0),
        "savePct":mp_value(r,"savePercentage"),"expectedSavePct":mp_value(r,"xSavePercentage"),
        "savePctAboveExpected":mp_value(r,"savePercentage",default=0)-mp_value(r,"xSavePercentage",default=0),
        "reboundsAboveExpected":mp_value(r,"rebounds",default=0)-mp_value(r,"xRebounds",default=0)}
        for r in goalies_raw if situation(r)]
    lines = [{"team":mp_value(r,"team"),"name":mp_value(r,"name","lineName"),"type":mp_value(r,"position","lineType"),
        "minutes":round(float(mp_value(r,"icetime",default=0) or 0)/60,1),"xgPct":mp_value(r,"xGoalsPercentage"),
        "corsiPct":mp_value(r,"corsiPercentage"),"fenwickPct":mp_value(r,"fenwickPercentage"),
        "gf":mp_value(r,"goalsFor"),"ga":mp_value(r,"goalsAgainst")}
        for r in lines_raw if str(r.get("situation", "5on5")).lower() in {"all", "all situations", "5on5", "5 on 5"}
        and float(mp_value(r,"icetime",default=0) or 0)>=300]
    team_games, special_team_games = load_moneypuck_team_games((previous or {}).get("teamGames", []), (previous or {}).get("specialTeamGames", []))
    return {"credit":"Data: MoneyPuck.com","updatedAt":datetime.now(timezone.utc).isoformat(),"season":SEASON,"status":"Ready","teams":teams,"specialTeams":special_teams,"skaters":skaters,"goalies":goalies,"lines":lines,"simulations":simulations,"teamGames":team_games,"specialTeamGames":special_team_games}


def load_natural_stat_trick(standings: list[dict]) -> dict:
    """Load the user's permitted Natural Stat Trick CSV export without scraping the site."""
    refresh = {}
    if NST_REFRESH_FILE.exists():
        try:
            candidate = json.loads(NST_REFRESH_FILE.read_text(encoding="utf-8"))
            if candidate.get("format") == "nhl-tracker-nst-refresh-v1" and str(candidate.get("season")) == SEASON:
                refresh = candidate
        except (OSError, json.JSONDecodeError):
            refresh = {}
    team_csv, player_csv, goalie_csv = (refresh.get(key, "") for key in ("teamCsv", "playerCsv", "goalieCsv"))
    if not team_csv and not NST_FILE.exists():
        return {"credit": "Data: NaturalStatTrick.com", "season": SEASON, "updatedAt": None, "teams": [], "players": [], "goalies": [], "status": "Awaiting CSV export"}
    def rows_from(text: str, path: Path) -> list[dict]:
        if text:
            return list(csv.DictReader(io.StringIO(text.lstrip("\ufeff"))))
        with path.open(newline="", encoding="utf-8-sig") as handle:
            return list(csv.DictReader(handle))
    code_by_name = {row["name"]: row["team"] for row in standings}
    code_by_name.update({"Montreal Canadiens": "MTL", "St Louis Blues": "STL"})
    def value(row, name):
        raw = row.get(name, "")
        try:
            number = float(raw)
            if not math.isfinite(number):
                return None
            return int(number) if number.is_integer() else number
        except (TypeError, ValueError):
            return raw
    fields = {
        "GP":"gp", "TOI":"toi", "W":"w", "L":"l", "OTL":"otl", "Points":"points",
        "CF":"cf", "CA":"ca", "CF%":"cfPct", "FF":"ff", "FA":"fa", "FF%":"ffPct",
        "SF":"sf", "SA":"sa", "SF%":"sfPct", "GF":"gf", "GA":"ga", "GF%":"gfPct",
        "xGF":"xgf", "xGA":"xga", "xGF%":"xgPct", "SCF":"scf", "SCA":"sca",
        "SCF%":"scPct", "HDCF":"hdcf", "HDCA":"hdca", "HDCF%":"hdPct",
        "MDCF":"mdcf", "MDCA":"mdca", "MDCF%":"mdPct", "LDCF":"ldcf", "LDCA":"ldca", "LDCF%":"ldPct",
        "HDSH%":"hdShPct", "HDSV%":"hdSvPct", "MDSH%":"mdShPct", "MDSV%":"mdSvPct",
        "LDSH%":"ldShPct", "LDSV%":"ldSvPct", "SH%":"shPct", "SV%":"svPct", "PDO":"pdo"
    }
    raw_rows = rows_from(team_csv, NST_FILE)
    teams = []
    for row in raw_rows:
        name = row.get("Team", "")
        code = code_by_name.get(name)
        if not code:
            continue
        teams.append({"team": code, "name": name, **{target: value(row, source) for source, target in fields.items()}})
    player_fields = {
        "GP":"gp", "TOI":"toi", "Goals":"goals", "Total Assists":"assists", "First Assists":"firstAssists",
        "Second Assists":"secondAssists", "Total Points":"points",
        "IPP":"ipp", "Shots":"shots", "SH%":"shPct", "ixG":"ixg", "iCF":"icf", "iFF":"iff",
        "iSCF":"iscf", "iHDCF":"ihdcf", "Rush Attempts":"rushAttempts", "Rebounds Created":"rebounds",
        "PIM":"pim", "Total Penalties":"totalPenalties", "Penalties Drawn":"penaltiesDrawn",
        "Giveaways":"giveaways", "Takeaways":"takeaways",
        "Hits":"hits", "Shots Blocked":"shotsBlocked", "Faceoffs Won":"faceoffsWon",
        "Faceoffs Lost":"faceoffsLost", "Faceoffs %":"faceoffsPct"
    }
    team_aliases = {"T.B":"TBL", "S.J":"SJS", "L.A":"LAK", "N.J":"NJD"}
    players = []
    if player_csv or NST_PLAYER_FILE.exists():
        for row in rows_from(player_csv, NST_PLAYER_FILE):
            player_teams = [team_aliases.get(code.strip(), code.strip()) for code in row.get("Team", "").split(",") if code.strip()]
            players.append({"name": row.get("Player", ""), "teams": player_teams, "position": row.get("Position", ""),
                **{target: value(row, source) for source, target in player_fields.items()}})
    goalie_fields = {
        "GP":"gp", "TOI":"toi", "Shots Against":"shotsAgainst", "Saves":"saves",
        "Goals Against":"goalsAgainst", "SV%":"savePct", "GAA":"gaa", "GSAA":"gsaa",
        "xG Against":"xGoalsAgainst", "HD Shots Against":"hdShotsAgainst", "HD Saves":"hdSaves",
        "HD Goals Against":"hdGoalsAgainst", "HDSV%":"hdSavePct", "HDGSAA":"hdGsaa",
        "MD Shots Against":"mdShotsAgainst", "MDSV%":"mdSavePct", "MDGSAA":"mdGsaa",
        "LD Shots Against":"ldShotsAgainst", "LDSV%":"ldSavePct", "LDGSAA":"ldGsaa",
        "Rush Attempts Against":"rushAgainst", "Rebound Attempts Against":"reboundAgainst",
        "Avg. Shot Distance":"avgShotDistance", "Avg. Goal Distance":"avgGoalDistance"
    }
    goalies = []
    if goalie_csv or NST_GOALIE_FILE.exists():
        for row in rows_from(goalie_csv, NST_GOALIE_FILE):
            goalie_teams = [team_aliases.get(code.strip(), code.strip()) for code in row.get("Team", "").split(",") if code.strip()]
            goalies.append({"name": row.get("Player", ""), "teams": goalie_teams,
                **{target: value(row, source) for source, target in goalie_fields.items()}})
    source_mtimes = [path.stat().st_mtime for path in (NST_FILE, NST_PLAYER_FILE, NST_GOALIE_FILE) if path.exists()]
    updated_at = refresh.get("preparedAt") or (datetime.fromtimestamp(max(source_mtimes), timezone.utc).isoformat() if source_mtimes else datetime.now(timezone.utc).isoformat())
    return {
        "credit": "Data: NaturalStatTrick.com",
        "sourceUrl": "https://www.naturalstattrick.com/teamtable.php",
        "season": SEASON,
        "seasonType": "Regular Season",
        "situation": "5v5 Score & Venue Adjusted",
        "updatedAt": updated_at,
        "teams": teams,
        "players": players,
        "goalies": goalies,
    }


def localised(value) -> str:
    if isinstance(value, dict):
        return str(value.get("default") or value.get("en") or next(iter(value.values()), ""))
    return str(value or "")


def normalise_venue_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").casefold()).strip()


def load_schedule_venues() -> dict:
    """Load the analyst-maintained arena coordinates and time zones used by the workbook."""
    payload = json.loads(SCHEDULE_VENUE_FILE.read_text())
    required = {"name", "latitude", "longitude", "timeZone"}
    malformed = [row.get("name", "unnamed venue") for row in payload.get("venues", []) if not required <= row.keys()]
    if malformed:
        raise RuntimeError(f"Schedule venue reference is incomplete: {', '.join(malformed)}")
    payload["byName"] = {normalise_venue_name(row["name"]): row for row in payload.get("venues", [])}
    aliases = {
        "amalie arena": "Benchmark International Arena",
        "bell centre": "Centre Bell",
        "sap center": "SAP Center at San Jose",
        "wells fargo center": "Xfinity Mobile Arena",
        "xcel energy center": "Grand Casino Arena",
    }
    for alias, canonical in aliases.items():
        match = payload["byName"].get(normalise_venue_name(canonical))
        if match:
            payload["byName"][normalise_venue_name(alias)] = match
    return payload


def parse_utc(value: str) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def venue_offset_hours(venue: dict | None, when: datetime | None) -> float:
    if not venue or not when:
        return 0.0
    try:
        offset = when.astimezone(ZoneInfo(venue["timeZone"])).utcoffset()
        return round((offset.total_seconds() if offset else 0) / 3600, 2)
    except (KeyError, ValueError):
        return 0.0


def scheduled_offset_hours(value) -> float | None:
    match = re.fullmatch(r"([+-]?)(\d{1,2})(?::?(\d{2}))?", str(value or "").strip())
    if not match:
        return None
    sign = -1 if match.group(1) == "-" else 1
    return sign * (int(match.group(2)) + int(match.group(3) or 0) / 60)


def haversine_km(origin: dict | None, destination: dict | None, radius: float = 6371) -> float:
    if not origin or not destination:
        return 0.0
    lat1, lon1 = math.radians(float(origin["latitude"])), math.radians(float(origin["longitude"]))
    lat2, lon2 = math.radians(float(destination["latitude"])), math.radians(float(destination["longitude"]))
    dlat, dlon = lat2 - lat1, lon2 - lon1
    value = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return radius * 2 * math.asin(min(1, math.sqrt(value)))


def standings_points_percentage(rows: list[dict]) -> dict[str, float]:
    output = {}
    for row in rows or []:
        games = int(row.get("gp") or 0)
        if row.get("team") and games:
            output[str(row["team"]).upper()] = float(row.get("points") or 0) / (games * 2)
    return output


def schedule_game_identity(game: dict) -> tuple[str, str, str]:
    return (
        str(game.get("id") or ""),
        localised(game.get("awayTeam", {}).get("abbrev")).upper(),
        localised(game.get("homeTeam", {}).get("abbrev")).upper(),
    )


def schedule_reconciliation(games: list[dict], rows: list[dict], teams: list[str], venues: dict,
        standings_strength: dict[str, float], season: str) -> dict:
    """Reproduce the workbook Data Quality sheet and make a published schedule fail closed."""
    regular = [game for game in games if int(game.get("gameType") or 0) == 2]
    ids = [str(game.get("id") or "") for game in regular]
    unique_games = len(set(ids))
    expected_per_team = regular_season_games(season)
    expected_games = len(teams) * expected_per_team // 2
    counts = defaultdict(int); home = defaultdict(int); away = defaultdict(int)
    for row in rows:
        counts[row["team"]] += 1
        if row.get("officialHome"):
            home[row["team"]] += 1
        else:
            away[row["team"]] += 1
    dates = sorted(str(game.get("gameDate") or "") for game in regular if game.get("gameDate"))
    expectations = SCHEDULE_EXPECTATIONS.get(str(season), {})
    missing_venues = sorted({row["venue"] for row in rows if row.get("venueMissing")})
    missing_standings = sorted(set(teams) - set(standings_strength))
    checks = []

    def check(name: str, actual, expected, passed: bool | None = None):
        checks.append({"name": name, "actual": actual, "expected": expected,
            "status": "pass" if (actual == expected if passed is None else passed) else "fail"})

    check("Unique regular-season games", unique_games, expected_games)
    check("Duplicate game IDs", len(ids) - unique_games, 0)
    check("Team-game rows", len(rows), len(teams) * expected_per_team)
    check("League teams", len(teams), 32)
    check("Games per team", min(counts.values(), default=0), expected_per_team,
        bool(teams) and all(counts[team] == expected_per_team for team in teams))
    check("Home assignments per team", min(home.values(), default=0), expected_per_team // 2,
        bool(teams) and all(home[team] == expected_per_team // 2 for team in teams))
    check("Away assignments per team", min(away.values(), default=0), expected_per_team // 2,
        bool(teams) and all(away[team] == expected_per_team // 2 for team in teams))
    if expectations.get("earliestDate"):
        check("Earliest game date", dates[0] if dates else None, expectations["earliestDate"])
    if expectations.get("latestDate"):
        check("Latest game date", dates[-1] if dates else None, expectations["latestDate"])
    check("Missing venue coordinates", len(missing_venues), 0)
    check("Missing previous standings", len(missing_standings), 0)
    check("Methodology weights", round(sum(SCHEDULE_WEIGHTS.values()), 6), 1.0)
    complete = unique_games >= expected_games
    failures = [row for row in checks if row["status"] == "fail"]
    result = {"status": "pass" if complete and not failures else "fail" if complete else "pending",
        "enforced": complete, "checks": checks, "failures": len(failures),
        "missingVenues": missing_venues, "missingStandings": missing_standings}
    if complete and failures:
        detail = "; ".join(f"{row['name']}: {row['actual']} (expected {row['expected']})" for row in failures)
        raise RuntimeError(f"Schedule reconciliation failed: {detail}")
    return result


def build_schedule_model(games: list[dict], teams: list[str], previous_standings: list[dict], season: str) -> tuple[dict, dict]:
    """Port the workbook's venue-aware schedule model into one canonical team-game dataset."""
    venue_reference = load_schedule_venues()
    venue_by_name = venue_reference["byName"]
    home_venues = {team: venue_by_name.get(normalise_venue_name(name))
        for team, name in venue_reference.get("homeVenues", {}).items()}
    strength = standings_points_percentage(previous_standings)
    team_rows = defaultdict(list)
    regular = [game for game in games if int(game.get("gameType") or 0) == 2]
    for game in regular:
        game_id, away, home = schedule_game_identity(game)
        if not game_id or not away or not home:
            continue
        venue_name = localised(game.get("venue"))
        venue = venue_by_name.get(normalise_venue_name(venue_name))
        neutral = bool(game.get("neutralSite")) or bool(venue and venue.get("neutral"))
        start = parse_utc(str(game.get("startTimeUTC") or ""))
        game_date = str(game.get("gameDate") or (start.date().isoformat() if start else ""))
        local_start = start.astimezone(ZoneInfo(venue["timeZone"])) if start and venue else None
        matinee = bool(local_start and local_start.hour < 17)
        unusual = None
        if matinee:
            unusual = "Matinee"
        elif venue and venue.get("timeZone", "").startswith("Europe/"):
            unusual = "International start"
        elif local_start and (local_start.hour + local_start.minute / 60) >= 21:
            unusual = "Late local start"
        for team, opponent, official_home in ((away, home, False), (home, away, True)):
            team_rows[team].append({
                "id": game_id, "team": team, "opponent": opponent, "date": game_date,
                "startTimeUTC": str(game.get("startTimeUTC") or ""), "start": start,
                "venue": venue_name, "venueData": venue, "venueMissing": venue is None,
                "officialHome": official_home, "neutral": neutral,
                "roadLike": neutral or not official_home,
                "localStart": local_start.isoformat() if local_start else None,
                "localStartLabel": local_start.strftime("%-I:%M %p") if local_start else None,
                "matinee": matinee, "scheduledOffset": scheduled_offset_hours(game.get("venueUTCOffset")),
                "unusualTiming": unusual, "specialEvent": venue.get("specialEvent") if venue else None,
                "opponentPointsPct": strength.get(opponent),
            })
    earth_radius = float(venue_reference.get("earthRadiusKm") or 6371)
    for team, rows in team_rows.items():
        rows.sort(key=lambda row: (row["date"], row["startTimeUTC"], row["id"]))
        prior_date = None
        prior_venue = home_venues.get(team)
        prior_offset = venue_offset_hours(prior_venue, rows[0]["start"]) if rows else 0
        for index, row in enumerate(rows):
            row["gameNumber"] = index + 1
            current_date = datetime.fromisoformat(row["date"]).date() if row["date"] else None
            row["restDays"] = 0 if prior_date is None or current_date is None else max(0, (current_date - prior_date).days - 1)
            row["backToBack"] = index > 0 and row["restDays"] == 0
            row["threeInFour"] = index >= 2 and (current_date - datetime.fromisoformat(rows[index - 2]["date"]).date()).days <= 3
            row["fourInSix"] = index >= 3 and (current_date - datetime.fromisoformat(rows[index - 3]["date"]).date()).days <= 5
            row["travelKm"] = haversine_km(prior_venue, row["venueData"], earth_radius)
            current_offset = row["scheduledOffset"] if row["scheduledOffset"] is not None else venue_offset_hours(row["venueData"], row["start"])
            row["timeZoneChange"] = abs(current_offset - prior_offset)
            row["utcOffset"] = current_offset
            prior_date = current_date
            prior_venue = row["venueData"] or prior_venue
            prior_offset = current_offset
        start = 0
        while start < len(rows):
            road_like = rows[start]["roadLike"]
            end = start + 1
            while end < len(rows) and rows[end]["roadLike"] == road_like:
                end += 1
            length = end - start
            for position, row in enumerate(rows[start:end], 1):
                row["segmentLength"] = length
                row["segmentGame"] = position
            start = end
    by_game_team = {(row["id"], row["team"]): row for rows in team_rows.values() for row in rows}
    for rows in team_rows.values():
        for row in rows:
            opponent = by_game_team.get((row["id"], row["opponent"]), {})
            row["opponentRestDays"] = int(opponent.get("restDays") or 0)
            row["restDifferential"] = (0 if row["gameNumber"] == 1 or opponent.get("gameNumber") == 1
                else row["restDays"] - row["opponentRestDays"])
            row["burden"] = (
                45 * float(row.get("opponentPointsPct") or 0)
                + 9 * int(row["roadLike"])
                + 9 * int(row["backToBack"])
                + 5 * int(row["threeInFour"])
                + 7 * int(row["fourInSix"])
                + 5 * max(0, -row["restDifferential"])
                + 7 * min(row["travelKm"] / 2500, 1)
                + 3 * min(row["timeZoneChange"] / 3, 1)
                + 2 * int(bool(row["unusualTiming"]))
                + 2 * int(bool(row["specialEvent"]))
            )
    summaries = []
    factor_names = list(SCHEDULE_WEIGHTS)
    for team in teams:
        rows = team_rows.get(team, [])
        congested = [row for row in rows if row["backToBack"] or row["threeInFour"] or row["fourInSix"]]
        road = [row for row in rows if row["roadLike"]]
        opponent_values = [row["opponentPointsPct"] for row in rows if row.get("opponentPointsPct") is not None]
        congested_values = [row["opponentPointsPct"] for row in congested if row.get("opponentPointsPct") is not None]
        rest_disadvantage_days = sum(max(0, -row["restDifferential"]) for row in rows)
        rest_advantage_days = sum(max(0, row["restDifferential"]) for row in rows)
        max_road_trip = max((row["segmentLength"] for row in road), default=0)
        long_road_games = sum(1 for row in road if row["segmentLength"] >= 4)
        spring_road_games = sum(1 for row in road if row["date"][5:7] in {"03", "04"})
        raw = {
            "opponentStrength": sum(opponent_values) / len(opponent_values) * 100 if opponent_values else 0,
            "travelDistance": sum(row["travelKm"] for row in rows),
            "backToBacks": sum(row["backToBack"] for row in rows),
            "congestion": sum(row["backToBack"] + .75 * row["threeInFour"] + row["fourInSix"] for row in rows),
            "restBurden": rest_disadvantage_days + .5 * sum(row["restDifferential"] < 0 for row in rows) - .25 * rest_advantage_days,
            "roadFrequency": len(road),
            "roadTripBurden": long_road_games + 2 * max_road_trip + spring_road_games,
            "timeZoneChanges": sum(row["timeZoneChange"] for row in rows),
            "congestedOpponentStrength": sum(congested_values) / len(congested_values) * 100 if congested_values else 0,
            "timingAndEvents": sum(bool(row["unusualTiming"]) for row in rows) + sum(bool(row["specialEvent"]) for row in rows) + .25 * spring_road_games,
        }
        windows = []
        for index in range(max(0, len(rows) - 5)):
            group = rows[index:index + 6]
            windows.append({"startDate": group[0]["date"], "endDate": group[-1]["date"],
                "averageBurden": round(sum(row["burden"] for row in group) / 6, 1),
                "opponents": [row["opponent"] for row in group]})
        summaries.append({"team": team, "raw": raw, "games": len(rows),
            "travelKm": round(raw["travelDistance"]), "backToBacks": int(raw["backToBacks"]),
            "threeInFour": sum(row["threeInFour"] for row in rows), "fourInSix": sum(row["fourInSix"] for row in rows),
            "restAdvantages": sum(row["restDifferential"] > 0 for row in rows),
            "restDisadvantages": sum(row["restDifferential"] < 0 for row in rows),
            "maxRoadTrip": max_road_trip, "roadLikeGames": len(road),
            "timeZoneHours": round(raw["timeZoneChanges"], 1),
            "easiestStretch": min(windows, key=lambda row: row["averageBurden"]) if windows else None,
            "hardestStretch": max(windows, key=lambda row: row["averageBurden"]) if windows else None})
    ranges = {name: (min((row["raw"][name] for row in summaries), default=0),
        max((row["raw"][name] for row in summaries), default=0)) for name in factor_names}
    for summary in summaries:
        summary["normalised"] = {}
        summary["contributions"] = {}
        for name in factor_names:
            low, high = ranges[name]
            value = .5 if high == low else (summary["raw"][name] - low) / (high - low)
            summary["normalised"][name] = round(value, 4)
            summary["contributions"][name] = round(value * SCHEDULE_WEIGHTS[name] * 100, 2)
        summary["score"] = round(sum(summary["normalised"][name] * SCHEDULE_WEIGHTS[name] for name in factor_names) * 100, 1)
    ordered = sorted(summaries, key=lambda row: (-row["score"], row["team"]))
    for rank, summary in enumerate(ordered, 1):
        summary["rank"] = rank
    reconciliation_rows = []
    for rows in team_rows.values():
        reconciliation_rows.extend(rows)
    reconciliation = schedule_reconciliation(regular, reconciliation_rows, teams, venue_reference, strength, season)
    summary_by_team = {row["team"]: row for row in summaries}
    benchmark = [{"team": team, "expected": expected, "actual": summary_by_team.get(team, {}).get("score"),
        "delta": round(summary_by_team.get(team, {}).get("score", 0) - expected, 1),
        "status": "pass" if abs(summary_by_team.get(team, {}).get("score", 0) - expected) <= .1 else "review"}
        for team, expected in SCHEDULE_WORKBOOK_BENCHMARKS.get(str(season), {}).items()]
    evidence = {}
    for rows in team_rows.values():
        for row in rows:
            evidence[(row["id"], row["team"])] = {
                "venue": row["venue"], "neutral": row["neutral"], "roadLike": row["roadLike"],
                "localStart": row["localStart"], "localStartLabel": row["localStartLabel"], "matinee": row["matinee"],
                "travelKm": round(row["travelKm"]), "restDays": row["restDays"],
                "opponentRestDays": row["opponentRestDays"], "restDifferential": row["restDifferential"],
                "backToBack": row["backToBack"], "threeInFour": row["threeInFour"], "fourInSix": row["fourInSix"],
                "roadTripLength": row["segmentLength"] if row["roadLike"] else 0,
                "roadTripGame": row["segmentGame"] if row["roadLike"] else 0,
                "timeZoneChange": row["timeZoneChange"], "opponentPointsPct": round(float(row.get("opponentPointsPct") or 0) * 100, 1),
                "unusualTiming": row["unusualTiming"], "specialEvent": row["specialEvent"], "burden": round(row["burden"], 1),
            }
    model = {
        "version": SCHEDULE_MODEL_VERSION, "season": str(season), "sourceSeason": str(int(str(season)[:4]) - 1) + str(season)[:4],
        "venueReference": {"source": venue_reference.get("source"), "accessedAt": venue_reference.get("accessedAt"),
            "venueCount": len(venue_reference.get("venues", [])), "earthRadiusKm": earth_radius},
        "weights": SCHEDULE_WEIGHTS, "teams": sorted(summaries, key=lambda row: row["rank"]),
        "reconciliation": reconciliation, "benchmarkComparison": benchmark,
    }
    return model, evidence


def load_schedules(team_codes: list[str]) -> list[dict]:
    """Load league schedules in parallel so division race histories are complete."""
    games = {}
    def one(team):
        return fetch_json(f"{API}/club-schedule-season/{team}/{SEASON}").get("games", [])
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(one, team): team for team in team_codes}
        for future in as_completed(futures):
            try:
                team_games = future.result()
            except Exception as exc:
                print(f"warning: schedule {futures[future]}: {exc}", file=sys.stderr)
                continue
            for game in team_games:
                if game.get("id") is not None:
                    games[str(game["id"])] = game
    return sorted(games.values(), key=lambda g: (g.get("gameDate") or str(g.get("startTimeUTC", ""))[:10], g.get("id", 0)))


def load_standings(previous: dict | None = None) -> list[dict]:
    rows = fetch_json(f"{API}/standings/now").get("standings", [])
    season_rows = [row for row in rows if str(row.get("seasonId", "")) == SEASON]
    if any(row.get("seasonId") for row in rows):
        rows = season_rows
    if not rows and previous and previous.get("standings"):
        # During the summer the NHL may still return last season's final table.
        # Keep team identities/divisions, but never present those totals as new-season results.
        return [{**row, "gp": 0, "w": 0, "l": 0, "otl": 0, "points": 0,
            "rw": 0, "gf": 0, "ga": 0, "gd": 0, "divisionRank": 0,
            "wildcardRank": 0, "streak": ""} for row in previous["standings"]]
    result = []
    for row in rows:
        team = localised(row.get("teamAbbrev")).upper()
        if not team:
            continue
        result.append({
            "team": team,
            "name": localised(row.get("teamName")) or team,
            "logo": f"https://assets.nhle.com/logos/nhl/svg/{team}_light.svg",
            "conference": localised(row.get("conferenceName")),
            "division": localised(row.get("divisionName")),
            "gp": row.get("gamesPlayed", 0), "w": row.get("wins", 0),
            "l": row.get("losses", 0), "otl": row.get("otLosses", 0),
            "points": row.get("points", 0), "rw": row.get("regulationWins", 0),
            "gf": row.get("goalFor", 0), "ga": row.get("goalAgainst", 0),
            "gd": row.get("goalDifferential", 0),
            "divisionRank": row.get("divisionSequence", 0),
            "wildcardRank": row.get("wildcardSequence", 0),
            "streak": f"{row.get('streakCode', '')}{row.get('streakCount', '')}"
        })
    return sorted(result, key=lambda r: (-r["points"], -r["rw"], -r["gd"]))


def load_special_teams(standings: list[dict], previous: list[dict] | None = None) -> list[dict]:
    """Load league-wide power-play and penalty-kill results from the official NHL summary report."""
    url = (f"{STATS_API}/team/summary?isAggregate=false&isGame=false&start=0&limit=50"
        f"&cayenneExp=seasonId={SEASON}%20and%20gameTypeId=2")
    raw = fetch_json(url).get("data", [])
    code_by_name = {row["name"].casefold(): row["team"] for row in standings}

    def value(row: dict, *names, default=0):
        for name in names:
            if row.get(name) not in (None, ""):
                return row[name]
        return default

    def percentage(row: dict, *names) -> float:
        try: number = float(value(row, *names))
        except (TypeError, ValueError): return 0.0
        return round(number * 100 if abs(number) <= 1.5 else number, 2)

    result = []
    for row in raw:
        abbreviation = str(value(row, "teamAbbrevs", "teamAbbrev", default="")).split(",")[0].strip().upper()
        name = str(value(row, "teamFullName", "teamName", default="")).strip()
        code = abbreviation if any(team["team"] == abbreviation for team in standings) else code_by_name.get(name.casefold(), "")
        if not code:
            continue
        result.append({
            "team": code, "name": name or next((team["name"] for team in standings if team["team"] == code), code),
            "gp": int(value(row, "gamesPlayed", default=0) or 0),
            "ppPct": percentage(row, "powerPlayPct"), "pkPct": percentage(row, "penaltyKillPct"),
            "ppNetPct": percentage(row, "powerPlayNetPct"), "pkNetPct": percentage(row, "penaltyKillNetPct"),
            "ppGoals": int(value(row, "powerPlayGoalsFor", "powerPlayGoals", default=0) or 0),
            "ppOpportunities": int(value(row, "powerPlayOpportunities", default=0) or 0),
            "ppGoalsAgainst": int(value(row, "powerPlayGoalsAgainst", default=0) or 0),
            "timesShorthanded": int(value(row, "timesShorthanded", default=0) or 0),
            "shGoalsFor": int(value(row, "shorthandedGoalsFor", default=0) or 0),
            "shGoalsAgainst": int(value(row, "shorthandedGoalsAgainst", default=0) or 0),
        })
    if not result:
        return previous or []
    pp_order = {row["team"]: index + 1 for index, row in enumerate(sorted(result, key=lambda item: -item["ppPct"]))}
    pk_order = {row["team"]: index + 1 for index, row in enumerate(sorted(result, key=lambda item: -item["pkPct"]))}
    for row in result:
        row["ppRank"] = pp_order[row["team"]]; row["pkRank"] = pk_order[row["team"]]
    return sorted(result, key=lambda row: row["team"])


def select_daily_slate(games: list[dict], requested_date: str | None) -> tuple[str | None, list[dict]]:
    """Select one authoritative NHL date from the multi-date schedule window."""
    dates = sorted({str(game.get("date") or "") for game in games if game.get("date")})
    if not dates:
        return requested_date, []
    if requested_date in dates:
        selected_date = requested_date
    elif requested_date:
        future_dates = [date for date in dates if date >= requested_date]
        selected_date = future_dates[0] if future_dates else dates[-1]
    else:
        selected_date = dates[0]
    return selected_date, [game for game in games if game.get("date") == selected_date]


def load_daily() -> dict:
    """One league-wide NHL slate, including broadcasters when supplied."""
    score = fetch_json(f"{API}/score/now")
    schedule = fetch_json(f"{API}/schedule/now")
    games = []
    for game in schedule.get("gameWeek", []):
        slate_date = game.get("date")
        for g in game.get("games", []):
            start_time = g.get("startTimeUTC", "")
            games.append({
                "id": g.get("id"), "date": g.get("gameDate") or slate_date or (start_time[:10] if start_time else ""), "startTimeUTC": start_time,
                "state": g.get("gameState", ""), "type": g.get("gameType", 0),
                "venue": localised(g.get("venue")),
                "home": localised(g.get("homeTeam", {}).get("abbrev")).upper(),
                "away": localised(g.get("awayTeam", {}).get("abbrev")).upper(),
                "homeScore": g.get("homeTeam", {}).get("score"), "awayScore": g.get("awayTeam", {}).get("score"),
                "period": g.get("periodDescriptor", {}).get("number"),
                "broadcasts": [b.get("network") for b in g.get("tvBroadcasts", []) if b.get("network")]
            })
    requested_date = score.get("currentDate")
    selected_date, slate = select_daily_slate(games, requested_date)
    return {"currentDate": selected_date, "requestedDate": requested_date,
        "fallback": bool(selected_date and requested_date and selected_date != requested_date), "games": slate}


def load_rosters(team_codes: list[str]) -> dict:
    def one(team):
        data = fetch_json(f"{API}/roster/{team}/current")
        rows = []
        for group in ("forwards", "defensemen", "goalies"):
            for p in data.get(group, []):
                rows.append({"id": str(p.get("id")), "team": team,
                    "name": f"{localised(p.get('firstName'))} {localised(p.get('lastName'))}".strip(),
                    "position": p.get("positionCode", ""), "number": p.get("sweaterNumber"),
                    "shoots": p.get("shootsCatches", ""), "birthDate": p.get("birthDate", ""),
                    "country": p.get("birthCountry", ""), "heightCm": p.get("heightInCentimeters"),
                    "weightKg": p.get("weightInKilograms"), "headshot": p.get("headshot", "")})
        return team, rows
    output = {}
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(one, t) for t in team_codes]
        for future in as_completed(futures):
            try:
                team, rows = future.result(); output[team] = rows
            except Exception as exc:
                print(f"warning: roster: {exc}", file=sys.stderr)
    return output


def tracked_game_rows(games: list[dict], team_codes: list[str] | None = None,
        schedule_evidence: dict[tuple[str, str], dict] | None = None) -> list[dict]:
    team_codes = team_codes or TRACKED
    schedule_evidence = schedule_evidence or {}
    rows = []
    for game in games:
        if int(game.get("gameType", 0)) not in (2, 3):
            continue
        home = localised(game.get("homeTeam", {}).get("abbrev")).upper()
        away = localised(game.get("awayTeam", {}).get("abbrev")).upper()
        finished = str(game.get("gameState", "")).upper() in {"OFF", "FINAL"}
        for team in team_codes:
            if team not in {home, away}:
                continue
            is_home = team == home
            gf = game.get("homeTeam", {}).get("score") if is_home else game.get("awayTeam", {}).get("score")
            ga = game.get("awayTeam", {}).get("score") if is_home else game.get("homeTeam", {}).get("score")
            gf = int(gf or 0); ga = int(ga or 0)
            period = str(game.get("gameOutcome", {}).get("lastPeriodType", "REG"))
            result, points = "—", 0
            if finished:
                if gf > ga: result, points = "W", 2
                elif period in {"OT", "SO"}: result, points = "OTL", 1
                else: result = "L"
            rows.append({
                "id": game.get("id"), "date": game.get("gameDate"), "type": "Playoffs" if int(game.get("gameType", 0)) == 3 else "Regular Season",
                "team": team, "opponent": away if is_home else home, "location": "Home" if is_home else "Away",
                "finished": finished, "gf": gf if finished else None, "ga": ga if finished else None,
                "gd": gf - ga if finished else None, "result": result, "points": points,
                "startTimeUTC": game.get("startTimeUTC", ""),
                **({"schedule": schedule_evidence[(str(game.get("id")), team)]}
                    if (str(game.get("id")), team) in schedule_evidence else {})
            })
    return rows


def preseason_schedule_rows(games: list[dict]) -> list[dict]:
    """Expose preseason games for schedules without mixing them into standings rows."""
    rows = []
    for game in games:
        if int(game.get("gameType") or 0) != 1 or game.get("id") is None:
            continue
        home = localised(game.get("homeTeam", {}).get("abbrev")).upper()
        away = localised(game.get("awayTeam", {}).get("abbrev")).upper()
        state = str(game.get("gameState") or "").upper()
        finished = state in {"OFF", "FINAL"}
        rows.append({
            "id": str(game["id"]), "date": str(game.get("gameDate") or ""),
            "startTimeUTC": str(game.get("startTimeUTC") or ""), "type": "Preseason", "state": state or "FUT",
            "away": away, "home": home, "venue": localised(game.get("venue")),
            "awayScore": game.get("awayTeam", {}).get("score") if finished else None,
            "homeScore": game.get("homeTeam", {}).get("score") if finished else None,
            "broadcasts": [row.get("network") for row in game.get("tvBroadcasts", []) if row.get("network")],
        })
    return sorted(rows, key=lambda row: (row["date"], row["startTimeUTC"], row["id"]))


def boxscore(game_id: int) -> dict:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"{game_id}.json"
    if path.exists():
        try:
            return json.loads(path.read_text())
        except json.JSONDecodeError:
            pass
    payload = fetch_json(f"{API}/gamecenter/{game_id}/boxscore")
    path.write_text(json.dumps(payload, separators=(",", ":")))
    return payload


def fetch_game_centre(game_id: str) -> tuple[str, dict]:
    base = f"{API}/gamecenter/{game_id}"
    detail = {"landing": fetch_json(f"{base}/landing"),
        "pbp": fetch_json(f"{base}/play-by-play"), "box": fetch_json(f"{base}/boxscore")}
    try:
        detail["rightRail"] = fetch_json(f"{base}/right-rail")
    except Exception as exc:
        # This report is often absent until game day. Keep the core game snapshot usable.
        print(f"warning: game report {game_id}: {exc}", file=sys.stderr)
    return str(game_id), detail


def load_game_centres(games: list[dict], previous: dict | None = None) -> dict:
    """Capture rich NHL Game Centre data for the most useful recent and upcoming tracked games."""
    tracked = [g for g in games if localised(g.get("homeTeam", {}).get("abbrev")).upper() in TRACKED
        or localised(g.get("awayTeam", {}).get("abbrev")).upper() in TRACKED]
    finished = [g for g in tracked if str(g.get("gameState", "")).upper() in {"OFF", "FINAL"}][-6:]
    upcoming = [g for g in tracked if str(g.get("gameState", "")).upper() not in {"OFF", "FINAL"}][:4]
    selected = {str(g["id"]): g for g in [*finished, *upcoming] if g.get("id") is not None}
    prior = (previous or {}).get("gameCentre", {})
    output = {}
    with ThreadPoolExecutor(max_workers=5) as pool:
        futures = {pool.submit(fetch_game_centre, game_id): game_id for game_id in selected}
        for future in as_completed(futures):
            game_id = futures[future]
            try:
                key, detail = future.result(); output[key] = detail
            except Exception as exc:
                print(f"warning: game centre {game_id}: {exc}", file=sys.stderr)
                if game_id in prior:
                    output[game_id] = prior[game_id]
    return output


def active_game_ids(daily: dict, now: datetime | None = None) -> list[str]:
    """Return every NHL game inside the pregame-to-postgame refresh window."""
    now = now or datetime.now(timezone.utc)
    active = []
    for game in daily.get("games", []):
        state = str(game.get("state", "")).upper()
        try:
            start = datetime.fromisoformat(str(game.get("startTimeUTC", "")).replace("Z", "+00:00"))
        except ValueError:
            start = None
        if state in {"LIVE", "CRIT"} or start and start - timedelta(minutes=90) <= now <= start + timedelta(hours=6):
            active.append(str(game["id"]))
    return active


def action_output(name: str, value: str) -> None:
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(f"{name}={value}\n")


def refresh_live_games_only() -> None:
    """Refresh current tracked games without rebuilding or committing the full archive."""
    started = time.time()
    if not OUTPUT.exists():
        raise RuntimeError("Run the full tracker update before using the live-game updater")
    payload = json.loads(OUTPUT.read_text())
    set_active_season(str(payload.get("meta", {}).get("season") or CONFIG["season"]))
    daily = load_daily()
    game_ids = active_game_ids(daily)
    action_output("active", "true" if game_ids else "false")
    action_output("games", ",".join(game_ids))
    if not game_ids:
        print("No tracked game is inside the live refresh window")
        return
    details = dict(payload.get("gameCentre", {}))
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(fetch_game_centre, game_id): game_id for game_id in game_ids}
        for future in as_completed(futures):
            game_id = futures[future]
            try:
                key, detail = future.result(); details[key] = detail
            except Exception as exc:
                print(f"warning: live game centre {game_id}: {exc}", file=sys.stderr)
    now = datetime.now(timezone.utc).isoformat()
    payload["daily"] = daily
    payload["gameCentre"] = details
    payload.setdefault("meta", {}).update({"version": VERSION, "updatedAt": now,
        "liveGameUpdateAt": now, "elapsedSeconds": round(time.time() - started, 1)})
    temporary = OUTPUT.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload, separators=(",", ":"), ensure_ascii=False))
    json.loads(temporary.read_text())
    temporary.replace(OUTPUT)
    print(f"Refreshed {len(game_ids)} active tracked game(s)")


def build_players(games: list[dict]) -> dict:
    completed = [g for g in games if int(g.get("gameType", 0)) == 2 and str(g.get("gameState", "")).upper() in {"OFF", "FINAL"}]
    relevant = [g for g in completed if localised(g.get("homeTeam", {}).get("abbrev")).upper() in TRACKED or localised(g.get("awayTeam", {}).get("abbrev")).upper() in TRACKED]
    boxes = {}
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(boxscore, int(g["id"])): g for g in relevant}
        for future in as_completed(futures):
            game = futures[future]
            try:
                boxes[str(game["id"])] = future.result()
            except Exception as exc:
                print(f"warning: boxscore {game['id']}: {exc}", file=sys.stderr)

    players = {team: {} for team in TRACKED}
    for game in relevant:
        data = boxes.get(str(game["id"]), {})
        home = localised(game.get("homeTeam", {}).get("abbrev")).upper()
        away = localised(game.get("awayTeam", {}).get("abbrev")).upper()
        stats = data.get("playerByGameStats", {})
        for side, team in (("homeTeam", home), ("awayTeam", away)):
            if team not in players:
                continue
            opponent = away if side == "homeTeam" else home
            for group in ("forwards", "defense", "goalies"):
                for p in stats.get(side, {}).get(group, []) or []:
                    pid = str(p.get("playerId") or localised(p.get("name")))
                    name = localised(p.get("name")) or " ".join(filter(None, [localised(p.get("firstName")), localised(p.get("lastName"))]))
                    entry = players[team].setdefault(pid, {"id": pid, "name": name, "position": p.get("position") or ("G" if group == "goalies" else ""), "games": []})
                    entry["games"].append({
                        "date": game.get("gameDate"), "opponent": opponent, "location": "Home" if side == "homeTeam" else "Away",
                        "goals": p.get("goals", 0), "assists": p.get("assists", 0), "points": p.get("points", 0),
                        "shots": p.get("sog", 0), "hits": p.get("hits", 0), "toi": p.get("toi", ""),
                        "saves": p.get("saves", 0), "shotsAgainst": p.get("shotsAgainst", 0), "savePct": p.get("savePctg", 0)
                    })
    output = {}
    for team, team_players in players.items():
        output[team] = []
        for p in team_players.values():
            p["games"].sort(key=lambda x: x["date"] or "")
            p["totals"] = {
                "gp": len(p["games"]), "goals": sum(x["goals"] or 0 for x in p["games"]),
                "assists": sum(x["assists"] or 0 for x in p["games"]), "points": sum(x["points"] or 0 for x in p["games"]),
                "shots": sum(x["shots"] or 0 for x in p["games"]), "saves": sum(x["saves"] or 0 for x in p["games"])
            }
            output[team].append(p)
        output[team].sort(key=lambda p: (-p["totals"]["points"], p["name"]))
    return output


def enrich_players(players: dict, rosters: dict) -> dict:
    """Replace boxscore abbreviations with roster names and add official headshots."""
    roster_by_id = {str(p.get("id")): p for rows in rosters.values() for p in rows}
    for rows in players.values():
        for player in rows:
            roster = roster_by_id.get(str(player.get("id")))
            if roster:
                player["name"] = roster.get("name") or player.get("name")
                player["headshot"] = roster.get("headshot", "")
    return players


def build_game_library(games: list[dict], rosters: dict, moneypuck: dict, previous: dict | None = None,
        schedule_evidence: dict[tuple[str, str], dict] | None = None) -> list[dict]:
    """Store a compact, durable summary for every completed tracked game."""
    schedule_evidence = schedule_evidence or {}
    completed = [g for g in games if int(g.get("gameType", 0)) in (2, 3)
        and str(g.get("gameState", "")).upper() in {"OFF", "FINAL"}]
    relevant = [g for g in completed if localised(g.get("homeTeam", {}).get("abbrev")).upper() in TRACKED
        or localised(g.get("awayTeam", {}).get("abbrev")).upper() in TRACKED]
    roster_by_id = {str(p.get("id")): p for rows in rosters.values() for p in rows}
    prior = {str(row.get("id")): row for row in (previous or {}).get("gameLibrary", [])}
    mp_rows = {}
    for row in moneypuck.get("teamGames", []):
        game_id = str(row.get("gameId", "")).split(".")[0]
        team = str(row.get("team", "")).upper()
        if game_id and team:
            mp_rows[(game_id, team)] = row

    output = []
    for game in relevant:
        game_id = str(game.get("id"))
        away = localised(game.get("awayTeam", {}).get("abbrev")).upper()
        home = localised(game.get("homeTeam", {}).get("abbrev")).upper()
        try:
            data = boxscore(int(game_id))
        except Exception as exc:
            print(f"warning: game library {game_id}: {exc}", file=sys.stderr)
            if game_id in prior:
                output.append(prior[game_id])
                continue
            data = {}
        stats = data.get("playerByGameStats", {})
        all_skaters, goalies, team_stats = [], [], {}
        for side, team in (("awayTeam", away), ("homeTeam", home)):
            side_stats = stats.get(side, {}) or {}
            skaters = [*(side_stats.get("forwards", []) or []), *(side_stats.get("defense", []) or [])]
            for player in skaters:
                roster = roster_by_id.get(str(player.get("playerId")), {})
                all_skaters.append({
                    "id": str(player.get("playerId", "")), "team": team,
                    "name": roster.get("name") or localised(player.get("name")) or "Unknown player",
                    "goals": int(player.get("goals") or 0), "assists": int(player.get("assists") or 0),
                    "points": int(player.get("points") or 0), "shots": int(player.get("sog") or 0),
                    "toi": player.get("toi") or "", "position": player.get("position") or "",
                    "plusMinus": int(player.get("plusMinus") or 0), "hits": int(player.get("hits") or 0),
                    "blocks": int(player.get("blockedShots") or 0), "takeaways": int(player.get("takeaways") or 0),
                    "giveaways": int(player.get("giveaways") or 0), "pim": int(player.get("pim") or 0)
                })
            for player in side_stats.get("goalies", []) or []:
                roster = roster_by_id.get(str(player.get("playerId")), {})
                goalies.append({
                    "id": str(player.get("playerId", "")), "team": team,
                    "name": roster.get("name") or localised(player.get("name")) or "Unknown goalie",
                    "saves": int(player.get("saves") or 0), "shotsAgainst": int(player.get("shotsAgainst") or 0),
                    "savePct": compact_number(player.get("savePctg"), 3), "toi": player.get("toi") or ""
                })
            club = data.get(side, {}) or game.get(side, {}) or {}
            team_stats[team] = {
                "goals": int(club.get("score") or 0), "shots": int(club.get("sog") or 0),
                "hits": sum(int(p.get("hits") or 0) for p in skaters),
                "pim": sum(int(p.get("pim") or 0) for p in skaters),
                "blocks": sum(int(p.get("blockedShots") or 0) for p in skaters),
                "ppg": sum(int(p.get("powerPlayGoals") or 0) for p in skaters)
            }
        all_skaters.sort(key=lambda p: (-p["points"], -p["goals"], -p["shots"], p["name"]))
        goalies.sort(key=lambda p: (-p["saves"], p["name"]))
        away_score = team_stats.get(away, {}).get("goals", int(game.get("awayTeam", {}).get("score") or 0))
        home_score = team_stats.get(home, {}).get("goals", int(game.get("homeTeam", {}).get("score") or 0))
        period = str((data.get("gameOutcome") or game.get("gameOutcome") or {}).get("lastPeriodType", "REG"))
        mp_away, mp_home = mp_rows.get((game_id, away)), mp_rows.get((game_id, home))
        output.append({
            "id": game_id, "date": data.get("gameDate") or game.get("gameDate"),
            "type": "Playoffs" if int(game.get("gameType", 0)) == 3 else "Regular Season",
            "startTimeUTC": data.get("startTimeUTC") or game.get("startTimeUTC", ""),
            "away": away, "home": home, "awayScore": away_score, "homeScore": home_score,
            "winner": away if away_score > home_score else home, "outcome": period,
            "venue": localised(data.get("venue")) or localised(game.get("venue")),
            "teams": team_stats, "players": all_skaters, "leaders": all_skaters[:3], "goalies": goalies,
            "xg": {away: compact_number(mp_away.get("xgf") if mp_away else mp_home.get("xga") if mp_home else None, 2),
                   home: compact_number(mp_home.get("xgf") if mp_home else mp_away.get("xga") if mp_away else None, 2)},
            "schedule": {team: schedule_evidence[(game_id, team)] for team in (away, home)
                if (game_id, team) in schedule_evidence},
            "officialUrl": f"https://www.nhl.com/gamecenter/{away.lower()}-vs-{home.lower()}/{str(data.get('gameDate') or game.get('gameDate') or '').replace('-', '/')}/{game_id}"
        })
    return sorted(output, key=lambda row: (row.get("date") or "", row.get("id") or ""))


def division_histories(games: list[dict], standings: list[dict]) -> dict:
    """Build cumulative points by calendar date for every division team."""
    divisions = defaultdict(list)
    for row in standings:
        divisions[row.get("division", "")].append(row["team"])
    wanted = {team for teams in divisions.values() for team in teams}
    events = defaultdict(list)
    for game in games:
        if int(game.get("gameType", 0)) != 2 or str(game.get("gameState", "")).upper() not in {"OFF", "FINAL"}:
            continue
        home = localised(game.get("homeTeam", {}).get("abbrev")).upper()
        away = localised(game.get("awayTeam", {}).get("abbrev")).upper()
        if home not in wanted or away not in wanted:
            continue
        hs = int(game.get("homeTeam", {}).get("score") or 0)
        aws = int(game.get("awayTeam", {}).get("score") or 0)
        period = str(game.get("gameOutcome", {}).get("lastPeriodType", "REG"))
        home_points = 2 if hs > aws else (1 if period in {"OT", "SO"} else 0)
        away_points = 2 if aws > hs else (1 if period in {"OT", "SO"} else 0)
        date = game.get("gameDate") or str(game.get("startTimeUTC", ""))[:10]
        events[home].append((date, home_points))
        events[away].append((date, away_points))
    output = {}
    for division, team_codes in divisions.items():
        series = {}
        for team in team_codes:
            total = 0
            rows = []
            for date, points in sorted(events.get(team, [])):
                total += points
                rows.append({"date": date, "points": total})
            series[team] = rows
        output[division] = series
    return output


def roster_changes(previous: dict, current: dict) -> dict:
    changes = {}
    old_rosters = previous.get("rosters", {}) if previous else {}
    for team in current:
        old = {str(p.get("id")): p for p in old_rosters.get(team, [])}
        new = {str(p.get("id")): p for p in current.get(team, [])}
        changes[team] = {
            "added": [new[i] for i in new.keys() - old.keys()],
            "removed": [old[i] for i in old.keys() - new.keys()]
        }
    return changes


def roster_change_history(previous: dict, changes: dict) -> list[dict]:
    """Keep detected roster events useful after the next automatic update."""
    history = list(previous.get("rosterChangeHistory", [])) if previous else []
    if previous and previous.get("rosters"):
        detected = datetime.now(timezone.utc).isoformat()
        existing = {(x.get("team"), x.get("direction"), str(x.get("player", {}).get("id")), str(x.get("detectedAt", ""))[:10]) for x in history}
        for team, change in changes.items():
            for direction, key in (("Added", "added"), ("Departed", "removed")):
                for player in change.get(key, []):
                    identity = (team, direction, str(player.get("id")), detected[:10])
                    if identity not in existing:
                        history.append({"team": team, "direction": direction, "player": player, "detectedAt": detected})
                        existing.add(identity)
    cutoff = datetime.now(timezone.utc) - timedelta(days=180)
    def current(item: dict) -> bool:
        try: return datetime.fromisoformat(str(item.get("detectedAt", "")).replace("Z", "+00:00")) >= cutoff
        except ValueError: return False
    return sorted((x for x in history if current(x)), key=lambda x: x.get("detectedAt", ""), reverse=True)[:240]


def compact_number(value, digits: int = 3):
    """Keep historical snapshots small while preserving useful chart precision."""
    try:
        number = float(value)
        return round(number, digits) if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None


def daily_history(previous: dict, standings: list[dict], moneypuck: dict, special_teams: list[dict] | None = None) -> list[dict]:
    """Append one durable league snapshot per UTC day for future trend views."""
    same_season = str(previous.get("meta", {}).get("season")) == SEASON
    history = list(previous.get("history", [])) if same_season else []
    mp_teams = {str(row.get("team", "")).upper(): row for row in moneypuck.get("teams", [])}
    special_by_team = {str(row.get("team", "")).upper(): row for row in (special_teams or [])}

    def percentage(value):
        number = compact_number(value)
        return number * 100 if number is not None and abs(number) <= 1 else number

    team_rows = []
    for rank, standing in enumerate(standings, 1):
        code = str(standing.get("team", "")).upper()
        advanced = mp_teams.get(code, {})
        special = special_by_team.get(code, {})
        gp = compact_number(standing.get("gp"), 0) or 0
        points = compact_number(standing.get("points"), 0) or 0
        model_games = compact_number(advanced.get("games")) or gp or 1
        xg_pct = percentage(advanced.get("xgPct"))
        corsi_pct = percentage(advanced.get("corsiPct"))
        hd_for, hd_against = compact_number(advanced.get("hdFor")), compact_number(advanced.get("hdAgainst"))
        high_danger = hd_for / (hd_for + hd_against) * 100 if hd_for is not None and hd_against is not None and hd_for + hd_against else None
        points_pct = points / (gp * 2) * 100 if gp else 0
        gd_per_game = (compact_number(standing.get("gd")) or 0) / gp if gp else 0
        gf_per_game = (compact_number(standing.get("gf")) or 0) / gp if gp else 0
        ga_per_game = (compact_number(standing.get("ga")) or 0) / gp if gp else 0
        xgf = compact_number(advanced.get("xgf")); xga = compact_number(advanced.get("xga"))
        model_gf = compact_number(advanced.get("gf")); model_ga = compact_number(advanced.get("ga"))
        xgf_per_game = xgf / model_games if xgf is not None else None
        xga_per_game = xga / model_games if xga is not None else None
        finishing = (model_gf - xgf) / model_games if model_gf is not None and xgf is not None else None
        goaltending = (xga - model_ga) / model_games if xga is not None and model_ga is not None else None
        pp_pct, pk_pct = compact_number(special.get("ppPct")), compact_number(special.get("pkPct"))
        special_index = pp_pct + pk_pct - 100 if pp_pct is not None and pk_pct is not None else None
        process = (xg_pct + corsi_pct + high_danger) / 3 if xg_pct is not None and corsi_pct is not None and high_danger is not None else None
        power_index = (points_pct - 50) * .45 + ((xg_pct if xg_pct is not None else 50) - 50) * .45 + gd_per_game * 2.5
        team_rows.append({
            "team": code, "rank": rank, "gp": int(gp), "points": int(points),
            "gd": compact_number(standing.get("gd"), 0), "pointsPct": round(points_pct, 2),
            "xgPct": compact_number(xg_pct, 2), "corsiPct": compact_number(corsi_pct, 2),
            "highDanger": compact_number(high_danger, 2), "powerIndex": round(power_index, 2),
            "gfPerGame": compact_number(gf_per_game, 3), "gaPerGame": compact_number(ga_per_game, 3),
            "xgfPerGame": compact_number(xgf_per_game, 3), "xgaPerGame": compact_number(xga_per_game, 3),
            "finishing": compact_number(finishing, 3), "goaltending": compact_number(goaltending, 3),
            "ppPct": compact_number(pp_pct, 2), "pkPct": compact_number(pk_pct, 2),
            "specialIndex": compact_number(special_index, 2), "process": compact_number(process, 2),
            "ranks": {}
        })
    categories = {
        "overall": ("powerIndex", True), "results": ("pointsPct", True),
        "process": ("process", True), "attack": ("gfPerGame", True),
        "defence": ("gaPerGame", False), "special": ("specialIndex", True),
        "finishing": ("finishing", True), "goaltending": ("goaltending", True)
    }
    for category, (field, higher) in categories.items():
        eligible = [row for row in team_rows if row.get(field) is not None]
        eligible.sort(key=lambda row: ((-row[field]) if higher else row[field], row["team"]))
        for category_rank, row in enumerate(eligible, 1):
            row["ranks"][category] = category_rank
    forecasts = []
    for row in moneypuck.get("simulations", []):
        if str(row.get("scenerio", row.get("scenario", "ALL"))).upper() not in {"ALL", ""}:
            continue
        code = str(row.get("teamCode", row.get("team", ""))).upper()
        if not code:
            continue
        forecasts.append({
            "team": code, "makePlayoffs": compact_number(row.get("madePlayoffs", row.get("makePlayoffs"))),
            "round2": compact_number(row.get("round2")), "round3": compact_number(row.get("round3")),
            "final": compact_number(row.get("round4", row.get("makeFinal"))),
            "cup": compact_number(row.get("wonCup", row.get("winCup"))),
            "projectedPoints": compact_number(row.get("points", row.get("averagePoints")), 1)
        })
    now = datetime.now(timezone.utc)
    snapshot = {"date": now.date().isoformat(), "updatedAt": now.isoformat(), "teams": team_rows, "forecasts": forecasts}
    history = [row for row in history if row.get("date") != snapshot["date"]]
    history.append(snapshot)
    return sorted(history, key=lambda row: row.get("date", ""))[-500:]


def team_summaries(rows: list[dict], team_codes: list[str] | None = None) -> dict:
    team_codes = team_codes or TRACKED
    output = {}
    for team in team_codes:
        games = [r for r in rows if r["team"] == team and r["type"] == "Regular Season" and r["finished"]]
        games.sort(key=lambda r: r["date"] or "")
        w = sum(r["result"] == "W" for r in games); otl = sum(r["result"] == "OTL" for r in games)
        gf = sum(r["gf"] or 0 for r in games); ga = sum(r["ga"] or 0 for r in games)
        output[team] = {"gp": len(games), "w": w, "l": len(games)-w-otl, "otl": otl, "points": sum(r["points"] for r in games), "gf": gf, "ga": ga, "gd": gf-ga, "last10": games[-10:], "games": games}
    return output


def write_season_index(current_season: str) -> None:
    season_dir = OUTPUT.parent / "seasons"
    entries = []
    for path in sorted(season_dir.glob("[0-9]" * 8 + ".json"), reverse=True):
        try:
            data = json.loads(path.read_text())
            season = str(data.get("meta", {}).get("season") or path.stem)
            entries.append({"season": season, "label": f"{season[:4]}–{season[6:]}",
                "updatedAt": data.get("meta", {}).get("updatedAt"), "current": season == current_season})
        except (json.JSONDecodeError, OSError):
            continue
    (season_dir / "index.json").write_text(json.dumps({"current": current_season, "seasons": entries}, separators=(",", ":")))


def ical_escape(value: object) -> str:
    """Escape plain text for an iCalendar property value."""
    return str(value or "").replace("\\", "\\\\").replace("\r", "").replace("\n", "\\n").replace(",", "\\,").replace(";", "\\;")


def ical_fold(line: str) -> list[str]:
    """Fold long iCalendar lines so subscription clients can read them reliably."""
    parts = []
    while len(line.encode("utf-8")) > 73:
        cut = min(73, len(line))
        while cut > 1 and len(line[:cut].encode("utf-8")) > 73:
            cut -= 1
        parts.append(line[:cut])
        line = " " + line[cut:]
    parts.append(line)
    return parts


def calendar_feed(name: str, games: list[dict], team_names: dict[str, str], colour: str = "#142640") -> str:
    generated = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//NHL Tracker//Team Calendar//EN",
        "CALSCALE:GREGORIAN", "METHOD:PUBLISH", f"X-WR-CALNAME:{ical_escape(name)}",
        "X-WR-TIMEZONE:Europe/London", f"X-APPLE-CALENDAR-COLOR:{colour}", f"COLOR:{colour}",
        "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H"]
    for game in games:
        game_id = str(game.get("id") or "")
        away_code = localised(game.get("awayTeam", {}).get("abbrev")).upper()
        home_code = localised(game.get("homeTeam", {}).get("abbrev")).upper()
        if not game_id or not away_code or not home_code:
            continue
        away, home = team_names.get(away_code, away_code), team_names.get(home_code, home_code)
        state = str(game.get("gameState") or "").upper()
        finished = state in {"OFF", "FINAL"}
        away_score, home_score = game.get("awayTeam", {}).get("score"), game.get("homeTeam", {}).get("score")
        summary = f"{away} at {home}"
        if finished and away_score is not None and home_score is not None:
            summary = f"Final: {away} {away_score} - {home_score} {home}"
        game_type = {1: "Preseason", 2: "Regular season", 3: "Playoffs"}.get(int(game.get("gameType") or 0), "NHL game")
        venue = localised(game.get("venue"))
        tracker_url = f"https://mooneyaoife.github.io/NHL-Tracker/?game={game_id}#games"
        description = f"{game_type}. Times display in your calendar's local time. Open the NHL Tracker Game Centre for scores, analytics and game details."
        event = ["BEGIN:VEVENT", f"UID:nhl-{game_id}@mooneyaoife.github.io", f"DTSTAMP:{generated}"]
        start_raw = str(game.get("startTimeUTC") or "")
        try:
            start = datetime.fromisoformat(start_raw.replace("Z", "+00:00")).astimezone(timezone.utc)
            event.extend([f"DTSTART:{start.strftime('%Y%m%dT%H%M%SZ')}", f"DTEND:{(start + timedelta(hours=3)).strftime('%Y%m%dT%H%M%SZ')}"])
        except ValueError:
            date = str(game.get("gameDate") or "").replace("-", "")
            if len(date) == 8:
                next_date = (datetime.strptime(date, "%Y%m%d") + timedelta(days=1)).strftime("%Y%m%d")
                event.extend([f"DTSTART;VALUE=DATE:{date}", f"DTEND;VALUE=DATE:{next_date}"])
        event.extend([f"SUMMARY:{ical_escape(summary)}", f"DESCRIPTION:{ical_escape(description)}",
            f"LOCATION:{ical_escape(venue)}", f"URL;VALUE=URI:{tracker_url}"])
        if str(game.get("gameScheduleState") or "").upper() in {"PPD", "CANCELLED"}:
            event.append("STATUS:CANCELLED")
        event.append("END:VEVENT")
        lines.extend(event)
    lines.append("END:VCALENDAR")
    return "\r\n".join(part for line in lines for part in ical_fold(line)) + "\r\n"


def write_calendar_feeds(schedules: list[dict], standings: list[dict]) -> None:
    """Publish one stable subscription URL per NHL team plus a league-wide feed."""
    CALENDAR_DIR.mkdir(parents=True, exist_ok=True)
    team_names = {row["team"]: row["name"] for row in standings}
    eligible = [game for game in schedules if int(game.get("gameType") or 0) in {1, 2, 3}]
    for team, name in team_names.items():
        games = [game for game in eligible if team in {
            localised(game.get("awayTeam", {}).get("abbrev")).upper(),
            localised(game.get("homeTeam", {}).get("abbrev")).upper()}]
        colour = TEAM_CALENDAR_COLOURS.get(team, "#142640")
        (CALENDAR_DIR / f"{team}.ics").write_text(calendar_feed(f"{name} - NHL Tracker", games, team_names, colour), encoding="utf-8", newline="")
    (CALENDAR_DIR / "NHL.ics").write_text(calendar_feed("NHL Schedule - NHL Tracker", eligible, team_names), encoding="utf-8", newline="")


def main() -> None:
    started = time.time()
    active_season, rollover_reason = resolve_active_season()
    set_active_season(active_season)
    previous = {}
    if OUTPUT.exists():
        try: previous = json.loads(OUTPUT.read_text())
        except json.JSONDecodeError: pass
    previous_same_season = previous if previous.get("meta", {}).get("season") == SEASON else {}
    preview = next_season_preview(SEASON, previous.get("nextSeasonPreview"))
    # Old standings may provide team identities during the summer, but
    # load_standings always zeroes their results before using them here.
    standings = load_standings(previous)
    try:
        special_teams = load_special_teams(standings, previous_same_season.get("specialTeams", []))
    except Exception as exc:
        print(f"warning: official special-teams data unavailable: {exc}", file=sys.stderr)
        special_teams = previous_same_season.get("specialTeams", [])
    schedules = load_schedules([r["team"] for r in standings])
    league_teams = [r["team"] for r in standings]
    previous_standings = (previous.get("standings", []) if previous.get("meta", {}).get("season") != SEASON
        else previous.get("previousSeasonStandings", []))
    schedule_difficulty, schedule_evidence = build_schedule_model(schedules, league_teams, previous_standings, SEASON)
    rows = tracked_game_rows(schedules, league_teams, schedule_evidence)
    preseason = preseason_schedule_rows(schedules)
    players = build_players(schedules)
    game_centres = load_game_centres(schedules, previous_same_season)
    daily = load_daily()
    for game in daily.get("games", []):
        game_id = str(game.get("id") or "")
        game["schedule"] = {team: schedule_evidence[(game_id, team)] for team in (game.get("away"), game.get("home"))
            if (game_id, team) in schedule_evidence}
    rosters = load_rosters([r["team"] for r in standings])
    players = enrich_players(players, rosters)
    news = load_official_news(standings, rosters, previous)
    transactions = load_reported_transactions(standings, rosters, previous)
    podcasts = load_podcasts(previous)
    videos = load_videos(standings, previous)
    try:
        moneypuck = load_moneypuck(previous_same_season.get("moneypuck", {}))
    except Exception as exc:
        print(f"warning: MoneyPuck data unavailable: {exc}", file=sys.stderr)
        moneypuck = previous_same_season.get("moneypuck") or {"credit":"Data: MoneyPuck.com","season":SEASON,"updatedAt":None,"status":"Awaiting new-season data","teams":[],"specialTeams":[],"skaters":[],"goalies":[],"lines":[],"simulations":[],"teamGames":[],"specialTeamGames":[]}
    game_library = build_game_library(schedules, rosters, moneypuck, previous_same_season, schedule_evidence)
    natural_stat_trick = load_natural_stat_trick(standings)
    changes = roster_changes(previous_same_season, rosters)
    change_history = roster_change_history(previous_same_season, changes)
    history = daily_history(previous_same_season, standings, moneypuck, special_teams)
    schedule_release = schedule_release_state(SEASON, schedules, previous_same_season.get("scheduleRelease"))
    payload = {
        "meta": {"version": VERSION, "season": SEASON, "seasonMode": CONFIG.get("seasonMode", "manual"), "seasonDecision": rollover_reason, "gamesPerTeam": regular_season_games(SEASON), "trackedTeams": TRACKED, "updatedAt": datetime.now(timezone.utc).isoformat(), "elapsedSeconds": round(time.time()-started, 1), "scheduleGames": len(schedules), "historyDays": len(history)},
        "standings": standings, "specialTeams": special_teams, "games": rows, "preseasonGames": preseason, "teams": team_summaries(rows, league_teams), "players": players, "gameCentre": game_centres,
        "previousSeasonStandings": previous_standings,
        "scheduleRelease": schedule_release, "nextSeasonPreview": preview,
        "scheduleDifficulty": schedule_difficulty,
        "daily": daily, "rosters": rosters, "rosterChanges": changes, "rosterChangeHistory": change_history, "news": news, "transactions": transactions, "podcasts": podcasts, "videos": videos,
        "gameLibrary": game_library,
        "divisionHistory": division_histories(schedules, standings), "history": history, "moneypuck": moneypuck,
        "naturalStatTrick": natural_stat_trick,
        "sources": {
            "nhl": {"status": "Ready", "season": SEASON, "updatedAt": datetime.now(timezone.utc).isoformat()},
            "moneypuck": {"status": moneypuck.get("status", "Ready"), "season": moneypuck.get("season", SEASON), "updatedAt": moneypuck.get("updatedAt")},
            "naturalStatTrick": {"status": natural_stat_trick.get("status", "Ready"), "season": natural_stat_trick.get("season", SEASON), "updatedAt": natural_stat_trick.get("updatedAt")}
        }
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temporary = OUTPUT.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload, separators=(",", ":"), ensure_ascii=False))
    json.loads(temporary.read_text())
    temporary.replace(OUTPUT)
    archive = OUTPUT.parent / "seasons" / f"{SEASON}.json"
    archive.parent.mkdir(parents=True, exist_ok=True)
    archive.write_text(json.dumps(payload, separators=(",", ":"), ensure_ascii=False))
    write_season_index(SEASON)
    write_calendar_feeds(schedules, standings)
    model_update = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "train_tracker_models.py"), "--max-games", "45"],
        check=False,
    )
    if model_update.returncode:
        print("warning: Tracker model collection did not complete; the previous model remains available", file=sys.stderr)
    print(f"Updated {OUTPUT}: {len(rows)} team-game rows, {len(standings)} standings teams")


def refresh_natural_stat_trick_only() -> None:
    """Refresh the manual Natural Stat Trick import without refetching the NHL or MoneyPuck."""
    if not OUTPUT.exists():
        raise RuntimeError("Run the full tracker update before importing Natural Stat Trick data")
    payload = json.loads(OUTPUT.read_text())
    set_active_season(str(payload.get("meta", {}).get("season") or CONFIG["season"]))
    payload.setdefault("meta", {})["version"] = VERSION
    payload["naturalStatTrick"] = load_natural_stat_trick(payload.get("standings", []))
    nst = payload["naturalStatTrick"]
    payload.setdefault("sources", {})["naturalStatTrick"] = {
        "status": nst.get("status", "Ready"), "season": nst.get("season", SEASON),
        "updatedAt": nst.get("updatedAt")
    }
    OUTPUT.write_text(json.dumps(payload, separators=(",", ":"), ensure_ascii=False))
    archive = OUTPUT.parent / "seasons" / f"{SEASON}.json"
    archive.parent.mkdir(parents=True, exist_ok=True)
    archive.write_text(json.dumps(payload, separators=(",", ":"), ensure_ascii=False))
    write_season_index(SEASON)
    print(f"Imported {len(payload['naturalStatTrick']['teams'])} Natural Stat Trick teams")


if __name__ == "__main__":
    if "--live-only" in sys.argv:
        refresh_live_games_only()
    elif "--refresh-nst-only" in sys.argv:
        refresh_natural_stat_trick_only()
    else:
        main()
