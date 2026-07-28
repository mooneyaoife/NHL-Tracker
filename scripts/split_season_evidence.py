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


def team_codes(payload: dict) -> list[str]:
    codes = set((payload.get("rosters") or {}).keys()) | set((payload.get("players") or {}).keys())
    codes.update(row.get("team") for row in payload.get("standings") or [] if row.get("team"))
    return sorted(str(code) for code in codes if code)


def team_game_library(rows: list[dict], team: str) -> list[dict]:
    return [row for row in latest_team_games(rows) if team in (row.get("away"), row.get("home"))]


def official_team_players(payload: dict, team: str) -> dict:
    identifiers = {
        str(row.get("id"))
        for row in (payload.get("players") or {}).get(team, []) + (payload.get("rosters") or {}).get(team, [])
        if row.get("id") is not None
    }
    return {
        group: [
            row for row in (payload.get("officialPlayers") or {}).get(group, [])
            if team in (row.get("teams") or []) or str(row.get("id")) in identifiers
        ]
        for group in ("skaters", "goalies")
    }


def provider_metadata(provider: dict) -> dict:
    return {
        key: value for key, value in provider.items()
        if not isinstance(value, list) and not isinstance(value, dict)
    }


def peer_evidence(payload: dict) -> dict:
    """Shared league context used by player percentiles and goalie rankings."""
    moneypuck = payload.get("moneypuck") or {}
    natural = payload.get("naturalStatTrick") or {}
    return {
        "meta": payload.get("meta") or {},
        "moneypuck": {**provider_metadata(moneypuck), "goalies": moneypuck.get("goalies") or []},
        "naturalStatTrick": {
            **provider_metadata(natural),
            "teams": natural.get("teams") or [],
            "players": natural.get("players") or [],
            "goalies": natural.get("goalies") or [],
        },
    }


def team_evidence(payload: dict, team: str) -> dict:
    """Selected-team evidence without other clubs' large player/provider arrays."""
    moneypuck = payload.get("moneypuck") or {}
    natural = payload.get("naturalStatTrick") or {}
    belongs = lambda row: row.get("team") == team
    return {
        "meta": payload.get("meta") or {},
        "standings": payload.get("standings") or [],
        "teams": {team: team_summaries(payload.get("teams") or {}).get(team, {})},
        "rosters": {team: (payload.get("rosters") or {}).get(team, [])},
        "players": {team: player_summaries(payload.get("players") or {}).get(team, [])},
        "officialPlayers": official_team_players(payload, team),
        "playerCoverage": payload.get("playerCoverage") or {},
        "specialTeams": payload.get("specialTeams") or [],
        "sources": payload.get("sources") or {},
        "gameLibrary": team_game_library(payload.get("gameLibrary") or [], team),
        "moneypuck": {
            **provider_metadata(moneypuck),
            "teams": moneypuck.get("teams") or [],
            "teamGames": [row for row in moneypuck.get("teamGames") or [] if belongs(row)],
            "skaters": [row for row in moneypuck.get("skaters") or [] if belongs(row)],
            "lines": [row for row in moneypuck.get("lines") or [] if belongs(row)],
            "specialTeamGames": [row for row in moneypuck.get("specialTeamGames") or [] if belongs(row)],
            "specialTeams": [row for row in moneypuck.get("specialTeams") or [] if belongs(row)],
        },
        "naturalStatTrick": {**provider_metadata(natural), "teams": natural.get("teams") or []},
    }


def availability_evidence(payload: dict, team: str) -> dict:
    """Lean roster, starter and line-combination evidence for the Lineups route."""
    moneypuck = payload.get("moneypuck") or {}
    belongs = lambda row: row.get("team") == team
    return {
        "meta": payload.get("meta") or {},
        "standings": payload.get("standings") or [],
        "teams": {team: team_summaries(payload.get("teams") or {}).get(team, {})},
        "rosters": {team: (payload.get("rosters") or {}).get(team, [])},
        "players": {team: player_summaries(payload.get("players") or {}).get(team, [])},
        "gameLibrary": team_game_library(payload.get("gameLibrary") or [], team),
        "moneypuck": {
            **provider_metadata(moneypuck),
            "lines": [row for row in moneypuck.get("lines") or [] if belongs(row)],
        },
    }


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
    peers = write_if_changed(SEASONS / f"{season}-peers.json", peer_evidence(payload))
    scoped_teams = {
        team: write_if_changed(SEASONS / f"{season}-team-{team}.json", team_evidence(payload, team))
        for team in team_codes(payload)
    }
    availability = {
        team: write_if_changed(SEASONS / f"{season}-availability-{team}.json", availability_evidence(payload, team))
        for team in team_codes(payload)
    }
    manifest = {
        "schema": 1,
        "season": season,
        "legacyUrl": f"data/seasons/{season}.json",
        "evidence": evidence,
        "playerGames": teams,
        "peerEvidence": peers,
        "teamEvidence": scoped_teams,
        "availabilityEvidence": availability,
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
            "teamEvidenceShards": len(manifest["teamEvidence"]),
        }, sort_keys=True))
