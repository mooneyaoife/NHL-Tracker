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
SCHEDULE_KEYS = ("preseasonGames", "scheduleRelease", "scheduleDifficulty", "nextSeasonPreview", "previousSeasonStandings")
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
    return {
        "core": {key: payload.get(key) for key in CORE_KEYS if key in payload},
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
