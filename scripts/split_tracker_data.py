#!/usr/bin/env python3
"""Write route-capability tracker artifacts without changing the legacy artifact.

The legacy tracker remains the compatibility and archive format. Current-season
browsers use these smaller files and merge them back into the same runtime shape.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "site" / "data"
SOURCE = DATA / "tracker.json"

CORE_KEYS = ("meta", "standings", "daily", "teams", "sources", "divisionHistory")
SCHEDULE_KEYS = ("preseasonGames", "scheduleRelease", "scheduleDifficulty", "schedulePressure", "nextSeasonPreview", "previousSeasonStandings")
PLAYER_KEYS = ("rosters", "players", "officialPlayers", "playerCoverage", "rosterChanges", "rosterChangeHistory", "transactions", "news", "podcasts", "videos")
ANALYTICS_KEYS = ("gameCentre", "moneypuck", "naturalStatTrick", "specialTeams", "history", "gameLibrary")

# The schedule route reconstructs the league-game shape from paired team rows.
# Live status remains in the core daily slate, so duplicated status aliases and
# derived goal difference/points need not travel with every team-game row.
GAME_KEYS = ("id", "date", "type", "team", "opponent", "location", "finished", "gf", "ga", "result", "startTimeUTC")
SCHEDULE_EVIDENCE_KEYS = ("venue", "neutral", "roadLike", "localStart", "localStartLabel", "matinee", "travelKm", "restDays", "opponentRestDays", "restDifferential", "backToBack", "threeInFour", "fourInSix", "roadTripLength", "roadTripGame", "timeZoneChange", "opponentPointsPct", "unusualTiming", "specialEvent", "burden")


def compact_games(rows: list[dict]) -> list[dict]:
    compact = []
    for row in rows:
        game = {key: row[key] for key in GAME_KEYS if key in row}
        evidence = row.get("schedule") or {}
        # Missing false/zero values retain their existing runtime meaning through
        # optional access and numeric coercion, while saving substantial transfer.
        kept = {key: evidence[key] for key in SCHEDULE_EVIDENCE_KEYS
                if key in evidence and evidence[key] not in (None, False, 0, "", [])}
        if kept:
            game["schedule"] = kept
        compact.append(game)
    return compact


def compact_game_window(payload: dict) -> list[dict]:
    """Keep only the games needed by the immediate Game Centre summary.

    The complete paired-team schedule remains in the schedule capability. Core
    carries the current slate plus a small followed-team window so opening a
    score does not download an entire season first.
    """
    rows = payload.get("games") or []
    tracked = set(payload.get("meta", {}).get("trackedTeams") or [])
    daily_ids = {str(row.get("id")) for row in payload.get("daily", {}).get("games") or [] if row.get("id") is not None}
    by_id: dict[str, dict] = {}
    for row in rows:
        game_id = str(row.get("id"))
        if game_id == "None":
            continue
        existing = by_id.get(game_id)
        # Prefer the followed-team row because its schedule evidence is the most
        # useful compact representation when only one side is retained.
        if existing is None or row.get("team") in tracked and existing.get("team") not in tracked:
            by_id[game_id] = row

    ordered = sorted(by_id.values(), key=lambda row: (row.get("startTimeUTC") or row.get("date") or "", str(row.get("id") or "")))
    followed = [row for row in ordered if row.get("team") in tracked or row.get("opponent") in tracked]
    upcoming = [row for row in followed if not row.get("finished")][:10]
    completed = [row for row in followed if row.get("finished")][-4:]
    selected_ids = daily_ids | {str(row.get("id")) for row in upcoming + completed}
    return compact_games([row for row in ordered if str(row.get("id")) in selected_ids])


def encoded(payload: dict) -> bytes:
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def write_atomic(path: Path, payload: dict) -> dict:
    body = encoded(payload)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(body)
    json.loads(temporary.read_text(encoding="utf-8"))
    temporary.replace(path)
    return {"url": f"data/{path.name}", "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}


def split_payload(payload: dict) -> dict[str, dict]:
    core = {key: payload.get(key) for key in CORE_KEYS if key in payload}
    core["games"] = compact_game_window(payload)
    return {
        "core": core,
        "schedule": {"games": compact_games(payload.get("games") or []), **{
            key: payload.get(key) for key in SCHEDULE_KEYS if key in payload}},
        "players": {key: payload.get(key) for key in PLAYER_KEYS if key in payload},
        "analytics": {key: payload.get(key) for key in ANALYTICS_KEYS if key in payload},
    }


def write_capability_artifacts(source: Path = SOURCE) -> dict:
    payload = json.loads(source.read_text(encoding="utf-8"))
    shards = split_payload(payload)
    files = {name: write_atomic(DATA / f"tracker-{name}.json", body) for name, body in shards.items()}
    manifest = {
        "schema": 1,
        "season": payload.get("meta", {}).get("season"),
        "sourceHash": payload.get("meta", {}).get("dataHash"),
        "legacyUrl": "data/tracker.json",
        "capabilities": files,
    }
    write_atomic(DATA / "tracker-manifest.json", manifest)
    return manifest


if __name__ == "__main__":
    result = write_capability_artifacts()
    print(json.dumps({name: item["bytes"] for name, item in result["capabilities"].items()}, sort_keys=True))
