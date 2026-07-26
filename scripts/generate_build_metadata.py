#!/usr/bin/env python3
"""Describe the exact code and committed data used by a deployable site artifact."""

from __future__ import annotations

import hashlib
import html
import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from home_intelligence import build_home_intelligence

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "site"


def digest(path: Path) -> str:
    return f"sha256:{hashlib.sha256(path.read_bytes()).hexdigest()}"


def commit() -> str:
    supplied = str(os.environ.get("GITHUB_SHA") or "").strip()
    if supplied:
        return supplied
    result = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True,
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=False)
    return result.stdout.strip() or "unknown"


def season_label(value: object) -> str:
    season = str(value or "")
    return f"{season[:4]}–{season[6:]}" if len(season) == 8 else "Current season"


def london_game_time(value: object) -> str:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed.astimezone(ZoneInfo("Europe/London")).strftime("%a %-d %b · %H:%M UK")
    except (TypeError, ValueError):
        return "Start time TBC"


def watch_next_fragment(watch: dict, team_names: dict[str, str], updated_at: object) -> str:
    safe = lambda value: html.escape(str(value or ""), quote=True)
    rows = watch.get("leagueBriefs") or []
    if not rows:
        return ('<div class="watch-next-empty"><strong>No upcoming games in this season</strong>'
                '<span>The published schedule has no future matchup to brief.</span>'
                '<a href="#schedule" data-watch-page="schedule">Open Schedule →</a></div>')
    hero, supporting = rows[0], rows[1:3]
    name = lambda code: team_names.get(code) or code
    signals = "".join(
        f'<div class="watch-next-signal"><span>{safe(row.get("label"))}</span>'
        f'<strong>{safe(row.get("value"))}</strong><small>{safe(row.get("detail"))}</small></div>'
        for row in hero.get("signals") or [])
    support = "".join(
        f'<a class="watch-next-row" href="?game={safe(row.get("id"))}#games" data-watch-game="{safe(row.get("id"))}">'
        f'<span>{safe(row.get("statusLabel"))} · {safe(london_game_time(row.get("startTimeUTC")))}</span>'
        f'<strong>{safe(name(row.get("away")))} at {safe(name(row.get("home")))}</strong>'
        f'<small>{safe((row.get("signals") or [{}])[0].get("value") or "Open matchup evidence")}</small><b>→</b></a>'
        for row in supporting
    )
    try:
        updated = datetime.fromisoformat(str(updated_at).replace("Z", "+00:00")).strftime("%-d %b")
    except (TypeError, ValueError):
        updated = "latest artifact"
    return (
        '<article class="watch-next-hero" data-watch-mode="league">'
        '<header><div><span class="section-kicker">League watch</span>'
        f'<h3>{safe(name(hero.get("away")))} at {safe(name(hero.get("home")))}</h3>'
        f'<p>{safe(london_game_time(hero.get("startTimeUTC")))} · {safe(hero.get("venue") or "Venue TBC")}</p></div>'
        f'<b class="watch-next-state state-{safe(hero.get("status"))}">{safe(hero.get("statusLabel"))}</b></header>'
        f'<div class="watch-next-signals" aria-label="Three things to know">{signals}</div>'
        '<footer>'
        f'<a class="watch-next-open" href="?game={safe(hero.get("id"))}#games" data-watch-game="{safe(hero.get("id"))}">Open Game Centre →</a>'
        f'<span>{safe(season_label(watch.get("sourceSeason")))} opponent evidence · updated {safe(updated)} · UK time</span></footer>'
        '<details class="watch-next-method"><summary>How to read this brief</summary>'
        f'<p>{safe(watch.get("methodology", {}).get("inputs"))}. {safe(watch.get("methodology", {}).get("limitations"))}.</p>'
        '<small>Schedule burden is context, not a result or win-probability forecast.</small></details></article>'
        f'<div class="watch-next-support" aria-label="More games to watch">{support}</div>'
    )


def home_fragments(season: object, evidence_season: object, rows: list[dict], team_form: dict) -> dict[str, str]:
    safe = lambda value: html.escape(str(value), quote=True)
    signed = lambda value: f"+{value}" if (value or 0) > 0 else str(value or 0)
    cards = []
    performance = []
    form_rows = []
    for index, row in enumerate(rows):
        rate = (row.get("points", 0) / (row.get("gp", 0) * 2) * 100) if row.get("gp") else 0
        detail = f'{row.get("w", 0)}-{row.get("l", 0)}-{row.get("otl", 0)} · {signed(row.get("gd"))} goal difference · {rate:.1f} PTS%'
        performance_detail = f'{row.get("w", 0)}-{row.get("l", 0)}-{row.get("otl", 0)} · {row.get("points", 0)} PTS · {signed(row.get("gd"))} GD'
        cards.append(f'<article style="--delay:{index * 55}ms"><img src="https://assets.nhle.com/logos/nhl/svg/{safe(row.get("team"))}_light.svg" alt=""><div><span>{safe(row.get("name") or row.get("team"))}</span><strong>{safe(row.get("points", 0))}</strong><small>{safe(season_label(evidence_season))} points</small><p>{safe(detail)}</p></div><i class="season-state-meter"><b style="width:{max(5, min(95, rate))}%"></b></i></article>')
        performance.append(f'<div class="rank-row" role="listitem"><strong>{safe(row.get("team"))}</strong><span>{safe(performance_detail)}</span></div>')
        games = team_form.get(row.get("team"), [])
        pills = "".join(f'<span class="pill {safe(game.get("result"))}">{safe(game.get("result"))}</span>' for game in games)
        form_rows.append(f'<div class="rank-row dashboard-form-row"><strong>{safe(row.get("team"))}</strong><div class="form">{pills or "No games yet"}</div></div>')
    has_form = any(team_form.get(row.get("team")) for row in rows)
    return {
        "season-state-teams": "".join(cards),
        "dashboard-points": "".join(performance) or '<p class="notice">Followed-team standings are updating.</p>',
        "recent-form": "".join(form_rows) if has_form else f'<p class="notice">{safe(season_label(season))} form begins after completed games.</p>',
        "home-saved-players": '<div class="home-empty-state"><strong>Saved players are ready</strong><span>Open player analysis to view and manage your watchlist.</span></div>',
        "home-pinned-analytics": '<button type="button" class="home-pin" data-shell-page="league"><span>Team Rankings</span><small>League-wide performance categories</small><b>→</b></button><button type="button" class="home-pin" data-shell-page="playoffs"><span>Playoff Path</span><small>Forecasts and postseason routes</small><b>→</b></button><button type="button" class="home-pin" data-shell-page="schedule"><span>Season Shape</span><small>Density, rest and difficulty</small><b>→</b></button>',
    }


def main() -> None:
    tracker_path = SITE / "data" / "tracker.json"
    tracker = json.loads(tracker_path.read_text())
    metadata = {
        "schema": 1,
        "sourceCommit": commit(),
        "artifactGeneratedAt": datetime.now(timezone.utc).isoformat(),
        "dataGeneratedAt": tracker.get("meta", {}).get("updatedAt"),
        "dataHash": digest(tracker_path),
        "season": tracker.get("meta", {}).get("season"),
        "version": tracker.get("meta", {}).get("version"),
        "freshness": tracker.get("meta", {}).get("freshness") or {
            "status": "static", "lastSuccessfulAt": tracker.get("meta", {}).get("updatedAt")},
    }
    tracked_teams = tracker.get("meta", {}).get("trackedTeams", [])
    tracked = set(tracked_teams)
    current_standings = tracker.get("standings", [])
    current_started = any((row.get("gp") or 0) > 0 for row in current_standings)
    evidence_standings = current_standings if current_started else tracker.get("previousSeasonStandings", [])
    current_season = str(metadata["season"] or "")
    previous_season = (f"{int(current_season[:4]) - 1}{int(current_season[4:]) - 1}"
                       if len(current_season) == 8 and current_season.isdigit() else None)
    evidence_rows = [row for row in evidence_standings if row.get("team") in tracked]
    team_form = {team: tracker.get("teams", {}).get(team, {}).get("last10", []) for team in tracked_teams}
    intelligence = build_home_intelligence(tracker)
    team_names = {row.get("team"): row.get("name") for row in tracker.get("standings", []) if row.get("team")}
    fragments = home_fragments(metadata["season"], metadata["season"] if current_started else previous_season,
                               evidence_rows, team_form)
    fragments["today-games"] = watch_next_fragment(intelligence["watchNext"], team_names, metadata["dataGeneratedAt"])
    home = {
        "schema": 3,
        "sourceCommit": metadata["sourceCommit"],
        "dataGeneratedAt": metadata["dataGeneratedAt"],
        "season": metadata["season"],
        "version": metadata["version"],
        "trackedTeams": tracked_teams,
        "teams": team_names,
        "daily": tracker.get("daily", {"games": []}),
        "freshness": metadata["freshness"],
        "standingsEvidence": {
            "season": metadata["season"] if current_started else previous_season,
            "current": current_started,
            "rows": evidence_rows,
        },
        "teamForm": team_form,
        "scheduledGames": {
            team: sum(1 for game in tracker.get("games", [])
                      if game.get("team") == team and not game.get("finished"))
            for team in tracked_teams
        },
        "snapshotHtml": fragments,
        **intelligence,
    }
    for path, payload in ((SITE / "build-meta.json", metadata), (SITE / "data" / "home.json", home)):
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        temporary.replace(path)
    print(f"Generated site/build-meta.json for {metadata['sourceCommit']}")


if __name__ == "__main__":
    main()
