#!/usr/bin/env python3
"""Fetch NHL data and build the static website dataset."""

from __future__ import annotations

import json
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
SEASON = str(CONFIG["season"])
TRACKED = [str(t).upper() for t in CONFIG["teams"]]
API = "https://api-web.nhle.com/v1"
CACHE = ROOT / "data" / "cache" / "boxscores"
OUTPUT = ROOT / "site" / "data" / "tracker.json"


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


def localised(value) -> str:
    if isinstance(value, dict):
        return str(value.get("default") or value.get("en") or next(iter(value.values()), ""))
    return str(value or "")


def load_schedules() -> list[dict]:
    games = {}
    for team in TRACKED:
        payload = fetch_json(f"{API}/club-schedule-season/{team}/{SEASON}")
        for game in payload.get("games", []):
            if game.get("id") is not None:
                games[str(game["id"])] = game
    return sorted(games.values(), key=lambda g: (g.get("gameDate", ""), g.get("id", 0)))


def load_standings() -> list[dict]:
    rows = fetch_json(f"{API}/standings/now").get("standings", [])
    result = []
    for row in rows:
        team = localised(row.get("teamAbbrev")).upper()
        if not team:
            continue
        result.append({
            "team": team,
            "name": localised(row.get("teamName")) or team,
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
            games.append({
                "id": g.get("id"), "date": g.get("gameDate"), "startTimeUTC": g.get("startTimeUTC", ""),
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


def team_summaries(rows: list[dict]) -> dict:
    output = {}
    for team in TRACKED:
        games = [r for r in rows if r["team"] == team and r["type"] == "Regular Season" and r["finished"]]
        games.sort(key=lambda r: r["date"] or "")
        w = sum(r["result"] == "W" for r in games); otl = sum(r["result"] == "OTL" for r in games)
        gf = sum(r["gf"] or 0 for r in games); ga = sum(r["ga"] or 0 for r in games)
        output[team] = {"gp": len(games), "w": w, "l": len(games)-w-otl, "otl": otl, "points": sum(r["points"] for r in games), "gf": gf, "ga": ga, "gd": gf-ga, "last10": games[-10:], "games": games}
    return output


def main() -> None:
    started = time.time()
    schedules = load_schedules()
    rows = tracked_game_rows(schedules)
    standings = load_standings()
    players = build_players(schedules)
    daily = load_daily()
    rosters = load_rosters([r["team"] for r in standings])
    payload = {
        "meta": {"version": "3.0.0", "season": SEASON, "trackedTeams": TRACKED, "updatedAt": datetime.now(timezone.utc).isoformat(), "elapsedSeconds": round(time.time()-started, 1), "scheduleGames": len(schedules)},
        "standings": standings, "games": rows, "teams": team_summaries(rows), "players": players,
        "daily": daily, "rosters": rosters
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temporary = OUTPUT.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload, separators=(",", ":"), ensure_ascii=False))
    json.loads(temporary.read_text())
    temporary.replace(OUTPUT)
    print(f"Updated {OUTPUT}: {len(rows)} team-game rows, {len(standings)} standings teams")


if __name__ == "__main__":
    main()
