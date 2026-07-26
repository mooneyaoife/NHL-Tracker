#!/usr/bin/env python3
"""Build compact, deterministic Home intelligence from the canonical tracker artifact."""

from __future__ import annotations

from collections import defaultdict
from typing import Any


FINAL_STATES = {"FINAL", "OFF"}
EXCEPTION_STATES = {"POSTPONED", "SUSPENDED", "DELAYED"}


def _text(value: Any) -> str:
    return str(value or "").strip()


def _team_game_identity(row: dict) -> tuple[str, str]:
    team, opponent = _text(row.get("team")), _text(row.get("opponent"))
    if row.get("location") == "Away":
        return team, opponent
    return opponent, team


def compact_games(tracker: dict) -> list[dict]:
    """Collapse duplicated team rows while retaining each club's schedule evidence."""
    games: dict[str, dict] = {}
    for row in tracker.get("games") or []:
        game_id = _text(row.get("id"))
        away, home = _team_game_identity(row)
        if not game_id or not away or not home:
            continue
        game = games.setdefault(game_id, {
            "id": game_id,
            "date": _text(row.get("date")),
            "londonDate": _text(row.get("londonDate")),
            "startTimeUTC": _text(row.get("startTimeUTC")),
            "type": row.get("type") or "Regular Season",
            "state": _text(row.get("state")),
            "status": _text(row.get("status")),
            "statusLabel": _text(row.get("statusLabel")) or "Scheduled",
            "scheduleState": _text(row.get("scheduleState")),
            "finished": bool(row.get("finished")),
            "away": away,
            "home": home,
            "awayScore": None,
            "homeScore": None,
            "schedule": {},
        })
        team = _text(row.get("team"))
        game["schedule"][team] = row.get("schedule") or {}
        if row.get("gf") is not None and row.get("ga") is not None:
            if row.get("location") == "Away":
                game["awayScore"], game["homeScore"] = row.get("gf"), row.get("ga")
            else:
                game["homeScore"], game["awayScore"] = row.get("gf"), row.get("ga")
    return sorted(games.values(), key=lambda game: (
        game.get("startTimeUTC") or f'{game.get("date", "")}T23:59:59Z', game["id"]))


def _signal(label: str, value: str, detail: str, kind: str) -> dict:
    return {"kind": kind, "label": label, "value": value, "detail": detail}


def game_signals(game: dict, team: str, source_season: str | None, limit: int = 3) -> list[dict]:
    """Explain canonical schedule evidence without reproducing its burden formula."""
    evidence = (game.get("schedule") or {}).get(team) or {}
    signals: list[tuple[int, dict]] = []
    rest = evidence.get("restDifferential")
    if evidence.get("specialEvent"):
        signals.append((100, _signal("Event", _text(evidence["specialEvent"]),
                                    "Official schedule event designation", "event")))
    if evidence.get("backToBack"):
        signals.append((95, _signal("Recovery", "Back-to-back",
                                    "Second game on consecutive dates", "rest")))
    if evidence.get("fourInSix"):
        signals.append((92, _signal("Congestion", "Four in six",
                                    "Fourth game in a six-day span", "congestion")))
    elif evidence.get("threeInFour"):
        signals.append((88, _signal("Congestion", "Three in four",
                                    "Third game in a four-day span", "congestion")))
    if isinstance(rest, (int, float)) and rest <= -1:
        days = abs(int(rest))
        signals.append((90, _signal("Rest", f"{days}-day deficit",
                                    "Fewer rest days than the opponent", "rest")))
    elif isinstance(rest, (int, float)) and rest >= 1:
        signals.append((76, _signal("Rest", f"+{int(rest)} day",
                                    "More rest than the opponent", "rest")))
    travel = evidence.get("travelKm")
    if isinstance(travel, (int, float)) and travel >= 1000:
        signals.append((82, _signal("Travel", f"{round(travel):,} km",
                                    "Estimated trip from the previous venue", "travel")))
    time_zones = evidence.get("timeZoneChange")
    if isinstance(time_zones, (int, float)) and time_zones >= 2:
        signals.append((80, _signal("Time zones", f"{time_zones:g} hours",
                                    "Scheduled UTC-offset change from the previous venue", "travel")))
    trip_length, trip_game = evidence.get("roadTripLength"), evidence.get("roadTripGame")
    if isinstance(trip_length, int) and trip_length >= 3:
        signals.append((72, _signal("Road trip", f"Game {trip_game} of {trip_length}",
                                    "Consecutive road-like games", "travel")))
    unusual = evidence.get("unusualTiming")
    if unusual:
        signals.append((70, _signal("Timing", _text(unusual),
                                    "Local start-time context", "timing")))
    opponent_pct = evidence.get("opponentPointsPct")
    if isinstance(opponent_pct, (int, float)) and opponent_pct > 0:
        period = f"{str(source_season)[:4]}–{str(source_season)[6:]}" if source_season and len(str(source_season)) == 8 else "prior season"
        signals.append((68, _signal("Opponent baseline", f"{opponent_pct:.1f}% PTS",
                                    f"Opponent points percentage in {period}; context, not a prediction", "opponent")))
    location = "Home" if game.get("home") == team else "Away"
    venue = _text(evidence.get("venue"))
    signals.append((20, _signal("Setting", location, venue or "Official NHL schedule", "venue")))
    ordered = sorted(enumerate(signals), key=lambda item: (-item[1][0], item[0]))
    return [signal for _, (_, signal) in ordered[:limit]]


def _game_status(game: dict) -> str:
    values = {_text(game.get(key)).upper() for key in ("state", "status", "scheduleState")}
    if values & EXCEPTION_STATES:
        return "exception"
    if game.get("finished") or values & FINAL_STATES:
        return "final"
    if values & {"LIVE", "CRIT", "IN_PROGRESS"}:
        return "live"
    return "scheduled"


def game_brief(game: dict, team: str, source_season: str | None) -> dict:
    evidence = (game.get("schedule") or {}).get(team) or {}
    return {
        "id": game["id"],
        "focusTeam": team,
        "opponent": game["home"] if game["away"] == team else game["away"],
        "away": game["away"],
        "home": game["home"],
        "startTimeUTC": game.get("startTimeUTC"),
        "londonDate": game.get("londonDate") or game.get("date"),
        "status": _game_status(game),
        "statusLabel": game.get("statusLabel") or "Scheduled",
        "location": "Home" if game["home"] == team else "Away",
        "venue": evidence.get("venue"),
        "burden": evidence.get("burden"),
        "signals": game_signals(game, team, source_season),
    }


def watch_next(tracker: dict, games: list[dict]) -> dict:
    model = tracker.get("scheduleDifficulty") or {}
    source_season = _text(model.get("sourceSeason")) or None
    current_season = _text(tracker.get("meta", {}).get("season"))
    upcoming = [game for game in games if _game_status(game) != "final"]
    by_team: dict[str, list[dict]] = defaultdict(list)
    for game in upcoming:
        by_team[game["away"]].append(game)
        by_team[game["home"]].append(game)
    team_briefs = {
        team: game_brief(rows[0], team, source_season)
        for team, rows in sorted(by_team.items()) if rows
    }
    league = []
    for game in upcoming[:6]:
        focus = game["home"]
        league.append(game_brief(game, focus, source_season))
    return {
        "schema": 1,
        "season": current_season,
        "sourceSeason": source_season,
        "teamBriefs": team_briefs,
        "leagueBriefs": league,
        "methodology": {
            "purpose": "Pregame schedule context, not a result prediction",
            "inputs": "Official NHL schedule, prior-season opponent points percentage, travel, rest, congestion, road sequence, time-zone and event flags",
            "limitations": "Does not include injuries, projected goalies, current form or lineup changes",
        },
    }


def continuity_snapshot(tracker: dict, games: list[dict]) -> dict:
    """Emit a bounded schema-3-compatible base for the existing visit briefing."""
    by_team: dict[str, list[dict]] = defaultdict(list)
    for game in games:
        by_team[game["away"]].append(game)
        by_team[game["home"]].append(game)
    selected_ids: set[str] = set()
    for rows in by_team.values():
        finals = [row for row in rows if _game_status(row) == "final"][-2:]
        upcoming = [row for row in rows if _game_status(row) != "final"][:2]
        selected_ids.update(row["id"] for row in finals + upcoming)
    finished, upcoming = {}, {}
    for game in games:
        if game["id"] not in selected_ids:
            continue
        row = {key: game.get(key) for key in (
            "id", "date", "startTimeUTC", "type", "away", "home", "awayScore", "homeScore")}
        row["focusTeams"] = [game["away"], game["home"]]
        (finished if _game_status(game) == "final" else upcoming)[game["id"]] = row
    roster = {}
    history = sorted(tracker.get("rosterChangeHistory") or [], key=lambda row: _text(row.get("detectedAt")), reverse=True)[:48]
    for row in history:
        player = row.get("player") or {}
        key = f'{_text(row.get("team"))}|{_text(row.get("direction"))}|{_text(player.get("id") or player.get("name"))}|{_text(row.get("detectedAt"))}'
        roster[key] = {
            "key": key, "team": row.get("team"), "direction": row.get("direction"),
            "name": player.get("name") or "Roster update", "detectedAt": row.get("detectedAt") or "",
        }
    release = tracker.get("scheduleRelease") or {}
    changes = {}
    for index, change in enumerate((release.get("recentChanges") or [])[:24]):
        key = _text(change.get("key")) or f"change-{index}"
        changes[key] = change
    meta = tracker.get("meta") or {}
    return {
        "schema": 3,
        "season": _text(meta.get("season")),
        "capturedAt": meta.get("updatedAt"),
        "updatedAt": meta.get("updatedAt"),
        "finished": finished,
        "upcoming": upcoming,
        "roster": roster,
        "schedule": {
            "activeSeason": release.get("season") or meta.get("season"),
            "complete": bool(release.get("complete")),
            "completedAt": release.get("completedAt"),
            "changes": changes,
        },
    }


def build_home_intelligence(tracker: dict) -> dict:
    games = compact_games(tracker)
    return {
        "watchNext": watch_next(tracker, games),
        "continuity": continuity_snapshot(tracker, games),
    }
