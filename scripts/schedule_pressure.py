#!/usr/bin/env python3
"""Build compact, non-predictive schedule-pressure windows for the calendar."""

from __future__ import annotations

from bisect import bisect_right
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo


LONDON = ZoneInfo("Europe/London")
WINDOW_DAYS = 7


def _london_date(row: dict) -> str:
    start = str(row.get("startTimeUTC") or "")
    if start:
        try:
            return datetime.fromisoformat(start.replace("Z", "+00:00")).astimezone(LONDON).date().isoformat()
        except ValueError:
            pass
    return str(row.get("date") or "")


def _signals(evidence: dict) -> list[str]:
    signals = []
    if evidence.get("backToBack"):
        signals.append("Back-to-back")
    if evidence.get("fourInSix"):
        signals.append("Fourth game in six days")
    elif evidence.get("threeInFour"):
        signals.append("Third game in four days")
    if float(evidence.get("restDifferential") or 0) < 0:
        signals.append("Rest disadvantage")
    if float(evidence.get("travelKm") or 0) >= 1600:
        signals.append("Long travel")
    if float(evidence.get("timeZoneChange") or 0) >= 2:
        signals.append("Time-zone shift")
    if int(evidence.get("roadTripLength") or 0) >= 4:
        signals.append(f"Road trip game {int(evidence.get('roadTripGame') or 1)} of {int(evidence['roadTripLength'])}")
    if float(evidence.get("opponentPointsPct") or 0) >= 60:
        signals.append("Strong prior-season opponent")
    if evidence.get("unusualTiming"):
        signals.append(str(evidence["unusualTiming"]))
    if evidence.get("specialEvent"):
        signals.append(str(evidence["specialEvent"]))
    return signals[:3]


def _percentile(value: float | None, ordered: list[float]) -> int | None:
    if value is None or not ordered:
        return None
    return max(1, round(bisect_right(ordered, value) / len(ordered) * 100))


def _pressure_label(percentile: int | None) -> str:
    if percentile is None:
        return "Evidence pending"
    if percentile >= 90:
        return "Very high load"
    if percentile >= 75:
        return "High load"
    if percentile >= 50:
        return "Elevated load"
    return "Typical load"


def build_schedule_pressure(
    rows: list[dict],
    teams: list[str],
    source_season: str | None,
    as_of: date | str | None = None,
) -> dict:
    """Return one current or next seven-day schedule window per team.

    The input is the canonical paired team-game data after schedule evidence has
    been attached. Finished games are excluded. During a break or the offseason,
    the window begins with the team's next scheduled regular-season game.
    """
    if isinstance(as_of, str):
        reference = date.fromisoformat(as_of)
    else:
        reference = as_of or datetime.now(LONDON).date()
    burdens = sorted(float((row.get("schedule") or {}).get("burden")) for row in rows
        if (row.get("schedule") or {}).get("burden") is not None)
    windows = []
    for team in teams:
        upcoming = sorted((row for row in rows if row.get("team") == team and not row.get("finished")
            and _london_date(row) >= reference.isoformat()), key=lambda row: (_london_date(row), str(row.get("startTimeUTC") or ""), str(row.get("id") or "")))
        current_end = reference + timedelta(days=WINDOW_DAYS - 1)
        current = [row for row in upcoming if _london_date(row) <= current_end.isoformat()]
        if current:
            anchor, mode, selected = reference, "current", current
        elif upcoming:
            anchor = date.fromisoformat(_london_date(upcoming[0]))
            end = anchor + timedelta(days=WINDOW_DAYS - 1)
            mode, selected = "next", [row for row in upcoming if _london_date(row) <= end.isoformat()]
        else:
            windows.append({"team": team, "mode": "complete", "startDate": None, "endDate": None,
                "gameCount": 0, "averageBurden": None, "peakPercentile": None, "games": []})
            continue
        games = []
        for row in selected:
            evidence = row.get("schedule") or {}
            burden = float(evidence["burden"]) if evidence.get("burden") is not None else None
            percentile = _percentile(burden, burdens)
            games.append({
                "id": str(row.get("id") or ""), "date": _london_date(row),
                "startTimeUTC": str(row.get("startTimeUTC") or ""), "team": team,
                "opponent": str(row.get("opponent") or ""), "location": str(row.get("location") or ""),
                "burden": round(burden, 1) if burden is not None else None,
                "leaguePercentile": percentile, "label": _pressure_label(percentile),
                "signals": _signals(evidence),
            })
        measured = [game["burden"] for game in games if game["burden"] is not None]
        windows.append({"team": team, "mode": mode, "startDate": anchor.isoformat(),
            "endDate": (anchor + timedelta(days=WINDOW_DAYS - 1)).isoformat(), "gameCount": len(games),
            "averageBurden": round(sum(measured) / len(measured), 1) if measured else None,
            "peakPercentile": max((game["leaguePercentile"] for game in games if game["leaguePercentile"] is not None), default=None),
            "games": games})
    return {
        "schema": 1, "asOf": reference.isoformat(), "windowDays": WINDOW_DAYS,
        "sourceSeason": str(source_season) if source_season else None,
        "purpose": "Schedule workload context; not a result or win-probability prediction.",
        "teams": windows,
    }
