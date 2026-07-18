#!/usr/bin/env python3
"""Backfill one stored season with complete official NHL player histories."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import update_tracker


def rebuild(season: str) -> Path:
    archive_path = update_tracker.OUTPUT.parent / "seasons" / f"{season}.json"
    if not archive_path.exists():
        raise FileNotFoundError(f"Season archive does not exist: {archive_path}")
    archive = json.loads(archive_path.read_text())
    if str(archive.get("meta", {}).get("season")) != season:
        raise RuntimeError("Archive season does not match the requested season")

    update_tracker.set_active_season(season)
    standings = archive.get("standings", [])
    team_codes = [row["team"] for row in standings]
    rosters = archive.get("rosters", {})
    schedules = update_tracker.load_schedules(team_codes)
    official = update_tracker.load_official_players(archive.get("officialPlayers", {}))
    players = update_tracker.enrich_players(
        update_tracker.build_players(schedules, team_codes, official), rosters
    )
    natural_stat_trick = update_tracker.load_natural_stat_trick(standings, rosters)
    coverage = update_tracker.player_data_coverage(
        rosters, players, official, archive.get("moneypuck", {}), natural_stat_trick
    )

    official_ids = {
        str(row["id"])
        for row in [*official.get("skaters", []), *official.get("goalies", [])]
    }
    stored_ids = {
        str(row["id"])
        for rows in players.values()
        for row in rows
    }
    if not official_ids or official_ids - stored_ids:
        missing = sorted(official_ids - stored_ids)[:10]
        raise RuntimeError(f"Official player reconciliation failed; missing IDs: {missing}")
    if len(players) != len(team_codes):
        raise RuntimeError("Player archive does not contain every NHL team")
    stored_by_id = {
        str(player.get("id")): player
        for rows in players.values()
        for player in rows
    }
    official_by_id = {
        str(player.get("id")): player
        for player in [*official.get("skaters", []), *official.get("goalies", [])]
    }
    failures = []
    for player_id, player in stored_by_id.items():
        if any(update_tracker.toi_seconds(game.get("toi")) <= 0 for game in player.get("games", [])):
            failures.append(f"{player.get('name')}: zero-minute appearance")
        expected = int(official_by_id.get(player_id, {}).get("totals", {}).get("gp") or 0)
        if len(player.get("games", [])) != expected:
            failures.append(f"{player.get('name')}: {len(player.get('games', []))} logs / {expected} GP")
    if failures:
        raise RuntimeError("Official player reconciliation failed; " + "; ".join(failures[:10]))

    archive["players"] = players
    archive["officialPlayers"] = official
    archive["naturalStatTrick"] = natural_stat_trick
    archive["playerCoverage"] = coverage
    archive.setdefault("meta", {}).update({
        "version": update_tracker.VERSION,
        "playerDataRebuiltAt": datetime.now(timezone.utc).isoformat(),
    })
    temporary = archive_path.with_suffix(".tmp")
    temporary.write_text(json.dumps(archive, separators=(",", ":"), ensure_ascii=False))
    json.loads(temporary.read_text())
    temporary.replace(archive_path)
    return archive_path


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("season", help="NHL season ID, for example 20252026")
    args = parser.parse_args()
    result = rebuild(str(args.season))
    print(f"Rebuilt player archive: {result}")
