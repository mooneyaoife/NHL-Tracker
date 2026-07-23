"""Shared server-side interpretation of NHL game states and UK-local dates."""

from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

LIVE_STATES = {"LIVE", "CRIT"}
FINAL_STATES = {"OFF", "FINAL"}
DELAYED_STATES = {"DELAYED", "DELAY"}
POSTPONED_STATES = {"POSTPONED", "PPD"}
SUSPENDED_STATES = {"SUSPENDED", "SUSP"}
CANCELLED_STATES = {"CANCELLED", "CANCELED", "CNCL"}


def _upper(value: object) -> str:
    return str(value or "").strip().upper()


def london_date(value: object) -> str:
    raw = str(value or "")
    if not raw:
        return ""
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return ""
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(ZoneInfo("Europe/London")).date().isoformat()


def normalize_game_state(game: dict) -> dict:
    raw = _upper(game.get("state") or game.get("gameState"))
    schedule = _upper(game.get("scheduleState") or game.get("gameScheduleState"))
    descriptor = game.get("periodDescriptor") or {}
    outcome = game.get("gameOutcome") or {}
    period_type = _upper(
        game.get("outcome")
        or game.get("lastPeriodType")
        or outcome.get("lastPeriodType")
        or descriptor.get("periodType")
    )
    intermission = bool((game.get("clock") or {}).get("inIntermission") or descriptor.get("inIntermission"))
    code, label = "scheduled", "Scheduled"
    if raw in CANCELLED_STATES or schedule in CANCELLED_STATES:
        code, label = "cancelled", "Cancelled"
    elif raw in POSTPONED_STATES or schedule in POSTPONED_STATES:
        code, label = "postponed", "Postponed"
    elif raw in SUSPENDED_STATES or schedule in SUSPENDED_STATES:
        code, label = "suspended", "Suspended"
    elif raw in DELAYED_STATES or schedule in DELAYED_STATES:
        code, label = "delayed", "Delayed"
    elif raw in FINAL_STATES:
        code = "final-so" if period_type == "SO" else "final-ot" if period_type == "OT" else "final"
        label = "Final/SO" if period_type == "SO" else "Final/OT" if period_type == "OT" else "Final"
    elif raw in LIVE_STATES:
        code, label = ("intermission", "Intermission") if intermission else ("live", "Live")
    elif raw == "PRE":
        code, label = "pregame", "Pregame"
    start = str(game.get("startTimeUTC") or "")
    slate = str(game.get("slateDate") or game.get("gameDate") or game.get("date") or start[:10])
    local = str(game.get("londonDate") or london_date(start) or slate)
    final = code.startswith("final")
    live = code in {"live", "intermission"}
    exception = code in {"delayed", "postponed", "suspended", "cancelled"}
    return {
        "code": code,
        "label": label,
        "raw": raw,
        "scheduleState": schedule,
        "periodType": period_type,
        "slateDate": slate,
        "londonDate": local,
        "live": live,
        "final": final,
        "completed": final or code == "cancelled",
        "active": live,
        "exception": exception,
        "scheduled": code in {"scheduled", "pregame"},
        "scoreVisible": live or final,
    }
