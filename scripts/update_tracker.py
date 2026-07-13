#!/usr/bin/env python3
"""Fetch NHL data and build the static website dataset."""

from __future__ import annotations

import json
import csv
import io
import math
import os
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG = json.loads((ROOT / "config.json").read_text())
VERSION = "5.6.0"
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


def fetch_csv(url: str, attempts: int = 4) -> list[dict]:
    last_error = None
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "NHL-Tracker/3.0"})
            with urllib.request.urlopen(request, timeout=45) as response:
                return list(csv.DictReader(io.StringIO(response.read().decode("utf-8-sig"))))
        except (urllib.error.URLError, TimeoutError, UnicodeDecodeError, csv.Error) as exc:
            last_error = exc; time.sleep(min(8, 2 ** attempt))
    raise RuntimeError(f"Unable to fetch {url}: {last_error}")


def mp_value(row: dict, *names, default=""):
    for name in names:
        if row.get(name) not in (None, ""):
            value = row[name]
            try: return float(value)
            except (TypeError, ValueError): return value
    return default


def load_moneypuck() -> dict:
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
    return {"credit":"Data: MoneyPuck.com","updatedAt":datetime.now(timezone.utc).isoformat(),"season":SEASON,"status":"Ready","teams":teams,"skaters":skaters,"goalies":goalies,"lines":lines,"simulations":simulations}


def load_natural_stat_trick(standings: list[dict]) -> dict:
    """Load the user's permitted Natural Stat Trick CSV export without scraping the site."""
    if not NST_FILE.exists():
        return {"credit": "Data: NaturalStatTrick.com", "season": SEASON, "updatedAt": None, "teams": [], "players": [], "goalies": [], "status": "Awaiting CSV export"}
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
    with NST_FILE.open(newline="", encoding="utf-8-sig") as handle:
        raw_rows = list(csv.DictReader(handle))
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
    if NST_PLAYER_FILE.exists():
        with NST_PLAYER_FILE.open(newline="", encoding="utf-8-sig") as handle:
            for row in csv.DictReader(handle):
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
    if NST_GOALIE_FILE.exists():
        with NST_GOALIE_FILE.open(newline="", encoding="utf-8-sig") as handle:
            for row in csv.DictReader(handle):
                goalie_teams = [team_aliases.get(code.strip(), code.strip()) for code in row.get("Team", "").split(",") if code.strip()]
                goalies.append({"name": row.get("Player", ""), "teams": goalie_teams,
                    **{target: value(row, source) for source, target in goalie_fields.items()}})
    source_mtimes = [path.stat().st_mtime for path in (NST_FILE, NST_PLAYER_FILE, NST_GOALIE_FILE) if path.exists()]
    return {
        "credit": "Data: NaturalStatTrick.com",
        "sourceUrl": "https://www.naturalstattrick.com/teamtable.php",
        "season": SEASON,
        "seasonType": "Regular Season",
        "situation": "5v5 Score & Venue Adjusted",
        "updatedAt": datetime.fromtimestamp(max(source_mtimes), timezone.utc).isoformat(),
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


def tracked_game_rows(games: list[dict]) -> list[dict]:
    rows = []
    for game in games:
        if int(game.get("gameType", 0)) not in (2, 3):
            continue
        home = localised(game.get("homeTeam", {}).get("abbrev")).upper()
        away = localised(game.get("awayTeam", {}).get("abbrev")).upper()
        finished = str(game.get("gameState", "")).upper() in {"OFF", "FINAL"}
        for team in TRACKED:
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
    for team in TRACKED:
        old = {str(p.get("id")): p for p in old_rosters.get(team, [])}
        new = {str(p.get("id")): p for p in current.get(team, [])}
        changes[team] = {
            "added": [new[i] for i in new.keys() - old.keys()],
            "removed": [old[i] for i in old.keys() - new.keys()]
        }
    return changes


def team_summaries(rows: list[dict]) -> dict:
    output = {}
    for team in TRACKED:
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
    standings = load_standings(previous)
    schedules = load_schedules([r["team"] for r in standings])
    rows = tracked_game_rows(schedules)
    players = build_players(schedules)
    daily = load_daily()
    rosters = load_rosters([r["team"] for r in standings])
    players = enrich_players(players, rosters)
    try:
        moneypuck = load_moneypuck()
    except Exception as exc:
        print(f"warning: MoneyPuck data unavailable: {exc}", file=sys.stderr)
        moneypuck = {"credit":"Data: MoneyPuck.com","season":SEASON,"updatedAt":None,"status":"Awaiting new-season data","teams":[],"skaters":[],"goalies":[],"lines":[],"simulations":[]}
    natural_stat_trick = load_natural_stat_trick(standings)
    previous_same_season = previous if previous.get("meta", {}).get("season") == SEASON else {}
    payload = {
        "meta": {"version": VERSION, "season": SEASON, "seasonMode": CONFIG.get("seasonMode", "manual"), "seasonDecision": rollover_reason, "trackedTeams": TRACKED, "updatedAt": datetime.now(timezone.utc).isoformat(), "elapsedSeconds": round(time.time()-started, 1), "scheduleGames": len(schedules)},
        "standings": standings, "games": rows, "teams": team_summaries(rows), "players": players,
        "daily": daily, "rosters": rosters, "rosterChanges": roster_changes(previous_same_season, rosters),
        "divisionHistory": division_histories(schedules, standings), "moneypuck": moneypuck,
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
    if "--refresh-nst-only" in sys.argv:
        refresh_natural_stat_trick_only()
    else:
        main()
