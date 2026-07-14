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

ROOT = Path(__file__).resolve().parents[1]
CONFIG = json.loads((ROOT / "config.json").read_text())
VERSION = "5.31.0"
SEASON = str(CONFIG["season"])
TRACKED = [str(t).upper() for t in CONFIG["teams"]]
API = "https://api-web.nhle.com/v1"
CACHE = ROOT / "data" / "cache" / "boxscores"
OUTPUT = ROOT / "site" / "data" / "tracker.json"
MP_SEASON = SEASON[:4]
MP_BASE = f"https://moneypuck.com/moneypuck/playerData/seasonSummary/{MP_SEASON}/regular"
NST_FILE = ROOT / "data" / "naturalstattrick" / f"team_{SEASON}_regular_5v5_sva.csv"
NST_PLAYER_FILE = ROOT / "data" / "naturalstattrick" / f"player_{SEASON}_regular_5v5.csv"
NST_GOALIE_FILE = ROOT / "data" / "naturalstattrick" / f"goalie_{SEASON}_regular_5v5.csv"
NST_REFRESH_FILE = ROOT / "data" / "naturalstattrick" / "naturalstattrick-refresh.json"
TEAM_NICKNAMES = {
    "ANA":"ducks","BOS":"bruins","BUF":"sabres","CAR":"hurricanes","CBJ":"blue jackets","CGY":"flames","CHI":"blackhawks","COL":"avalanche",
    "DAL":"stars","DET":"red wings","EDM":"oilers","FLA":"panthers","LAK":"kings","MIN":"wild","MTL":"canadiens","NJD":"devils","NSH":"predators",
    "NYI":"islanders","NYR":"rangers","OTT":"senators","PHI":"flyers","PIT":"penguins","SEA":"kraken","SJS":"sharks","STL":"blues","TBL":"lightning",
    "TOR":"maple leafs","UTA":"mammoth","VAN":"canucks","VGK":"golden knights","WPG":"jets","WSH":"capitals"
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


def schedule_is_published(season: str) -> tuple[bool, int]:
    """Require a substantial regular-season schedule before rolling forward."""
    games = fetch_json(f"{API}/club-schedule-season/{TRACKED[0]}/{season}").get("games", [])
    regular = [g for g in games if int(g.get("gameType") or 0) == 2 and g.get("gameDate")]
    return len(regular) >= 40, len(regular)


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
        return candidate, f"NHL published {games} regular-season games for a tracked team"
    return configured, f"Waiting for the NHL schedule ({games} regular-season games found)"


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


def load_moneypuck_team_games(previous: list[dict] | None = None) -> list[dict]:
    """Load the explicitly published team game-by-game files without scraping pages."""
    aliases = {"L.A": "LAK", "N.J": "NJD", "S.J": "SJS", "T.B": "TBL"}
    normalise_team = lambda value: aliases.get(str(value).upper(), str(value).upper())

    def one_team(team: str) -> list[dict]:
        url = f"https://moneypuck.com/moneypuck/playerData/teamGameByGame/{MP_SEASON}/regular/{team}.csv"
        raw = fetch_csv(url, attempts=1)
        if "gameId" not in raw[0]:
            raise ValueError(f"{team} game file has no gameId column")
        games = {}
        for row in raw:
            if str(row.get("situation", "all")).lower() not in {"all", "all situations"}:
                continue
            game_id = str(row.get("gameId", "")).split(".")[0]
            if not game_id:
                continue
            code = normalise_team(mp_value(row, "playerTeam", "team", "name", default=team))
            if code != team:
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
        return list(games.values())

    rows, errors = [], []
    with ThreadPoolExecutor(max_workers=min(4, len(TRACKED))) as executor:
        futures = {executor.submit(one_team, team): team for team in TRACKED}
        for future in as_completed(futures):
            try: rows.extend(future.result())
            except Exception as exc: errors.append(f"{futures[future]}: {exc}")
    if errors:
        print(f"warning: MoneyPuck team game files unavailable ({'; '.join(errors)})", file=sys.stderr)
    if not rows and previous:
        return previous
    return sorted(rows, key=lambda row: (row.get("date", ""), row.get("gameId", ""), row.get("team", "")))


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
    team_games = load_moneypuck_team_games((previous or {}).get("teamGames", []))
    return {"credit":"Data: MoneyPuck.com","updatedAt":datetime.now(timezone.utc).isoformat(),"season":SEASON,"status":"Ready","teams":teams,"skaters":skaters,"goalies":goalies,"lines":lines,"simulations":simulations,"teamGames":team_games}


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


def load_daily() -> dict:
    """Current league-wide scoreboard/schedule, including broadcasters when supplied."""
    score = fetch_json(f"{API}/score/now")
    schedule = fetch_json(f"{API}/schedule/now")
    games = []
    for game in schedule.get("gameWeek", []):
        for g in game.get("games", []):
            start_time = g.get("startTimeUTC", "")
            games.append({
                "id": g.get("id"), "date": g.get("gameDate") or (start_time[:10] if start_time else ""), "startTimeUTC": start_time,
                "state": g.get("gameState", ""), "type": g.get("gameType", 0),
                "venue": localised(g.get("venue")),
                "home": localised(g.get("homeTeam", {}).get("abbrev")).upper(),
                "away": localised(g.get("awayTeam", {}).get("abbrev")).upper(),
                "homeScore": g.get("homeTeam", {}).get("score"), "awayScore": g.get("awayTeam", {}).get("score"),
                "period": g.get("periodDescriptor", {}).get("number"),
                "broadcasts": [b.get("network") for b in g.get("tvBroadcasts", []) if b.get("network")]
            })
    return {"currentDate": score.get("currentDate"), "games": games}


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


def tracked_game_rows(games: list[dict], team_codes: list[str] | None = None) -> list[dict]:
    team_codes = team_codes or TRACKED
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
                "startTimeUTC": game.get("startTimeUTC", "")
            })
    return rows


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
    return str(game_id), {"landing": fetch_json(f"{base}/landing"),
        "pbp": fetch_json(f"{base}/play-by-play"), "box": fetch_json(f"{base}/boxscore")}


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
    """Return tracked games inside the pregame-to-postgame refresh window."""
    now = now or datetime.now(timezone.utc)
    active = []
    for game in daily.get("games", []):
        if game.get("home") not in TRACKED and game.get("away") not in TRACKED:
            continue
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


def daily_history(previous: dict, standings: list[dict], moneypuck: dict) -> list[dict]:
    """Append one durable league snapshot per UTC day for future trend views."""
    same_season = str(previous.get("meta", {}).get("season")) == SEASON
    history = list(previous.get("history", [])) if same_season else []
    mp_teams = {str(row.get("team", "")).upper(): row for row in moneypuck.get("teams", [])}
    team_rows = []
    for rank, standing in enumerate(standings, 1):
        code = str(standing.get("team", "")).upper()
        advanced = mp_teams.get(code, {})
        gp = compact_number(standing.get("gp"), 0) or 0
        points = compact_number(standing.get("points"), 0) or 0
        raw_xg = compact_number(advanced.get("xgPct"))
        xg_pct = raw_xg * 100 if raw_xg is not None and abs(raw_xg) <= 1 else raw_xg
        points_pct = points / (gp * 2) * 100 if gp else 0
        gd_per_game = (compact_number(standing.get("gd")) or 0) / gp if gp else 0
        power_index = (points_pct - 50) * .45 + ((xg_pct if xg_pct is not None else 50) - 50) * .45 + gd_per_game * 2.5
        team_rows.append({
            "team": code, "rank": rank, "gp": int(gp), "points": int(points),
            "gd": compact_number(standing.get("gd"), 0), "pointsPct": round(points_pct, 2),
            "xgPct": compact_number(xg_pct, 2), "powerIndex": round(power_index, 2)
        })
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


def main() -> None:
    started = time.time()
    active_season, rollover_reason = resolve_active_season()
    set_active_season(active_season)
    previous = {}
    if OUTPUT.exists():
        try: previous = json.loads(OUTPUT.read_text())
        except json.JSONDecodeError: pass
    previous_same_season = previous if previous.get("meta", {}).get("season") == SEASON else {}
    standings = load_standings(previous)
    schedules = load_schedules([r["team"] for r in standings])
    league_teams = [r["team"] for r in standings]
    rows = tracked_game_rows(schedules, league_teams)
    players = build_players(schedules)
    game_centres = load_game_centres(schedules, previous)
    daily = load_daily()
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
        moneypuck = previous_same_season.get("moneypuck") or {"credit":"Data: MoneyPuck.com","season":SEASON,"updatedAt":None,"status":"Awaiting new-season data","teams":[],"skaters":[],"goalies":[],"lines":[],"simulations":[],"teamGames":[]}
    natural_stat_trick = load_natural_stat_trick(standings)
    changes = roster_changes(previous_same_season, rosters)
    change_history = roster_change_history(previous_same_season, changes)
    history = daily_history(previous_same_season, standings, moneypuck)
    payload = {
        "meta": {"version": VERSION, "season": SEASON, "seasonMode": CONFIG.get("seasonMode", "manual"), "seasonDecision": rollover_reason, "trackedTeams": TRACKED, "updatedAt": datetime.now(timezone.utc).isoformat(), "elapsedSeconds": round(time.time()-started, 1), "scheduleGames": len(schedules), "historyDays": len(history)},
        "standings": standings, "games": rows, "teams": team_summaries(rows, league_teams), "players": players, "gameCentre": game_centres,
        "daily": daily, "rosters": rosters, "rosterChanges": changes, "rosterChangeHistory": change_history, "news": news, "transactions": transactions, "podcasts": podcasts, "videos": videos,
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
