#!/usr/bin/env python3
"""Build compact, on-demand evidence files from a legacy season archive."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEASONS = ROOT / "site" / "data" / "seasons"


def encoded(payload: dict) -> bytes:
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def write_if_changed(path: Path, payload: dict) -> dict:
    body = encoded(payload)
    if not path.exists() or path.read_bytes() != body:
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_bytes(body)
        json.loads(temporary.read_text(encoding="utf-8"))
        temporary.replace(path)
    return {
        "url": f"data/seasons/{path.name}",
        "bytes": len(body),
        "sha256": hashlib.sha256(body).hexdigest(),
    }


def player_summaries(players: dict) -> dict:
    return {
        team: [{key: value for key, value in row.items() if key != "games"} for row in rows]
        for team, rows in players.items()
    }


def team_summaries(teams: dict) -> dict:
    return {
        team: {key: value for key, value in row.items() if key != "games"}
        for team, row in teams.items()
    }


def latest_team_games(rows: list[dict]) -> list[dict]:
    """Retain one recent game per team for starter/availability evidence."""
    latest: dict[str, dict] = {}
    for row in rows:
        marker = row.get("startTimeUTC") or row.get("date") or ""
        for team in (row.get("away"), row.get("home")):
            if team and (team not in latest or marker > latest[team][0]):
                latest[team] = (marker, row)
    keys = (
        "id", "date", "type", "startTimeUTC", "away", "home", "awayScore",
        "homeScore", "winner", "outcome", "venue", "goalies", "xg", "officialUrl",
    )
    unique: dict[str, dict] = {}
    for _, row in latest.values():
        unique[str(row.get("id"))] = {key: row[key] for key in keys if key in row}
    return sorted(unique.values(), key=lambda row: (row.get("startTimeUTC") or row.get("date") or "", str(row.get("id") or "")))


def player_game_shards(players: dict) -> dict[str, dict[str, list[dict]]]:
    """Index full player logs by every team affiliation, including traded players."""
    shards: dict[str, dict[str, list[dict]]] = {}
    for stored_team, rows in players.items():
        for row in rows:
            games = row.get("games") or []
            if not games:
                continue
            affiliations = set(row.get("teams") or []) | {stored_team}
            for team in affiliations:
                shards.setdefault(str(team), {})[str(row.get("id"))] = games
    return shards


def compact_evidence(payload: dict) -> dict:
    keep = (
        "meta", "standings", "rosters", "officialPlayers", "playerCoverage",
        "moneypuck", "naturalStatTrick", "specialTeams", "sources",
    )
    result = {key: payload.get(key) for key in keep if key in payload}
    result["teams"] = team_summaries(payload.get("teams") or {})
    result["players"] = player_summaries(payload.get("players") or {})
    result["gameLibrary"] = latest_team_games(payload.get("gameLibrary") or [])
    return result


def write_season_evidence(source: Path) -> dict:
    payload = json.loads(source.read_text(encoding="utf-8"))
    season = str(payload.get("meta", {}).get("season") or source.stem)
    evidence = write_if_changed(SEASONS / f"{season}-evidence.json", compact_evidence(payload))
    teams = {
        team: write_if_changed(SEASONS / f"{season}-players-{team}.json", {
            "schema": 1, "season": season, "team": team, "games": games,
        })
        for team, games in sorted(player_game_shards(payload.get("players") or {}).items())
    }
    manifest = {
        "schema": 1,
        "season": season,
        "legacyUrl": f"data/seasons/{season}.json",
        "evidence": evidence,
        "playerGames": teams,
    }
    write_if_changed(SEASONS / f"{season}-manifest.json", manifest)
    return manifest


if __name__ == "__main__":
    for archive in sorted(SEASONS.glob("[0-9]" * 8 + ".json")):
        manifest = write_season_evidence(archive)
        print(json.dumps({
            "season": manifest["season"],
            "evidenceBytes": manifest["evidence"]["bytes"],
            "teamShards": len(manifest["playerGames"]),
        }, sort_keys=True))
