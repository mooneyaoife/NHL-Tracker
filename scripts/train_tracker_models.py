#!/usr/bin/env python3
"""Incrementally collect official NHL shot features and fit Tracker xG.

The collector deliberately works in bounded batches. A model is published only
after it clears minimum game, shot and goal counts; otherwise the last trained
model is preserved and the public status remains ``collecting``.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import random
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TRACKER = ROOT / "site" / "data" / "tracker.json"
OUTPUT = ROOT / "site" / "data" / "tracker-models.json"
CACHE_DIR = ROOT / "data" / "cache" / "models"
API = "https://api-web.nhle.com/v1"
SHOT_TYPES = ("wrist", "snap", "slap", "backhand", "tip-in", "deflected", "wrap-around", "other")
FEATURES = ("distance", "angle", "rebound", "power_play", "short_handed", "empty_net", *[f"shot_type_{name}" for name in SHOT_TYPES[:-1]])
MIN_GAMES, MIN_SHOTS, MIN_GOALS = 350, 20_000, 600


def fetch_json(url: str) -> dict:
    request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "NHL-Tracker-Model/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def seconds(value: str) -> int:
    try:
        minute, second = value.split(":", 1)
        return int(minute) * 60 + int(second)
    except (AttributeError, ValueError):
        return 0


def shot_type(value: str) -> str:
    value = str(value or "other").lower()
    return value if value in SHOT_TYPES else "other"


def extract_game(game_id: str, pbp: dict) -> list[dict]:
    away_id = str(pbp.get("awayTeam", {}).get("id") or "")
    home_id = str(pbp.get("homeTeam", {}).get("id") or "")
    previous: dict[tuple[int, str], dict] = {}
    rows = []
    for play in pbp.get("plays", []):
        event = play.get("typeDescKey")
        if event not in {"goal", "shot-on-goal", "missed-shot"}:
            continue
        detail = play.get("details") or {}
        try:
            x, y = float(detail["xCoord"]), float(detail["yCoord"])
        except (KeyError, TypeError, ValueError):
            continue
        period = int((play.get("periodDescriptor") or {}).get("number") or 0)
        owner = str(detail.get("eventOwnerTeamId") or "")
        elapsed = seconds(play.get("timeInPeriod", ""))
        prior = previous.get((period, owner))
        rebound = int(bool(prior and 0 <= elapsed - prior["elapsed"] <= 3))
        situation = str(play.get("situationCode") or "")
        away_skaters = int(situation[1]) if len(situation) == 4 and situation[1].isdigit() else 5
        home_skaters = int(situation[2]) if len(situation) == 4 and situation[2].isdigit() else 5
        own_skaters, opp_skaters = (away_skaters, home_skaters) if owner == away_id else (home_skaters, away_skaters)
        opponent_goalie = situation[3] if owner == away_id and len(situation) == 4 else situation[0] if len(situation) == 4 else ""
        distance = math.hypot(89 - abs(x), y)
        angle = math.degrees(math.atan2(abs(y), max(1, 89 - abs(x))))
        kind = shot_type(detail.get("shotType"))
        row = {"game": str(game_id), "goal": int(event == "goal"), "distance": round(distance, 4), "angle": round(angle, 4),
            "rebound": rebound, "power_play": int(own_skaters > opp_skaters), "short_handed": int(own_skaters < opp_skaters),
            "empty_net": int(opponent_goalie == "0") if opponent_goalie else int(event == "goal" and not detail.get("goalieInNetId")), "shot_type": kind}
        rows.append(row)
        previous[(period, owner)] = {"elapsed": elapsed}
    return rows


def game_ids(payload: dict) -> list[str]:
    ids = {str(row.get("id")) for row in payload.get("games", []) if row.get("finished") and row.get("type") == "Regular Season" and row.get("id")}
    return sorted(ids)


def league_game_ids(payload: dict, allow_fetch: bool) -> list[str]:
    """Discover completed regular-season game IDs for the whole league."""
    ids = set(game_ids(payload))
    if not allow_fetch:
        return sorted(ids)
    season = str(payload.get("meta", {}).get("season") or "")
    teams = sorted({str(row.get("team")) for row in payload.get("standings", []) if row.get("team")})
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(fetch_json, f"{API}/club-schedule-season/{team}/{season}"): team for team in teams}
        for future in as_completed(futures):
            team = futures[future]
            try:
                for game in future.result().get("games", []):
                    if game.get("gameType") == 2 and game.get("gameState") in {"OFF", "FINAL"} and game.get("id"):
                        ids.add(str(game["id"]))
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, KeyError) as exc:
                print(f"warning: schedule discovery {team}: {exc}")
    return sorted(ids)


def read_cache(path: Path) -> list[dict]:
    if not path.exists():
        return []
    rows = []
    for line in path.read_text().splitlines():
        try: rows.append(json.loads(line))
        except json.JSONDecodeError: continue
    return rows


def write_cache(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    rows.sort(key=lambda row: (row["game"], row["distance"], row["angle"], row["goal"]))
    temporary = path.with_suffix(".tmp")
    temporary.write_text("".join(json.dumps(row, separators=(",", ":")) + "\n" for row in rows))
    temporary.replace(path)


def vector(row: dict) -> list[float]:
    base = [float(row[name]) for name in FEATURES[:6]]
    base.extend(1.0 if row.get("shot_type") == name else 0.0 for name in SHOT_TYPES[:-1])
    return base


def sigmoid(value: float) -> float:
    if value >= 0:
        z = math.exp(-min(value, 35)); return 1 / (1 + z)
    z = math.exp(max(value, -35)); return z / (1 + z)


def auc(rows: list[tuple[float, int]]) -> float:
    ranked = sorted(rows)
    positives = sum(label for _, label in ranked); negatives = len(ranked) - positives
    if not positives or not negatives: return 0.5
    rank_sum = sum(index for index, (_, label) in enumerate(ranked, 1) if label)
    return (rank_sum - positives * (positives + 1) / 2) / (positives * negatives)


def train(rows: list[dict]) -> dict:
    train_rows, validation_rows = [], []
    for row in rows:
        bucket = int(hashlib.sha1(row["game"].encode()).hexdigest()[:4], 16) % 5
        (validation_rows if bucket == 0 else train_rows).append(row)
    raw = [vector(row) for row in train_rows]
    means = [sum(values[i] for values in raw) / len(raw) for i in range(len(FEATURES))]
    scales = [max(1e-6, math.sqrt(sum((values[i] - means[i]) ** 2 for values in raw) / len(raw))) for i in range(len(FEATURES))]
    standardized = [[(values[i] - means[i]) / scales[i] for i in range(len(FEATURES))] for values in raw]
    labels = [row["goal"] for row in train_rows]
    intercept = math.log((sum(labels) + 1) / (len(labels) - sum(labels) + 1)); weights = [0.0] * len(FEATURES)
    rate, penalty = 0.08, 0.02
    order = list(range(len(labels))); random.Random(42).shuffle(order)
    for epoch in range(260):
        grad_b = 0.0; grad = [0.0] * len(weights)
        for index in order:
            x, label = standardized[index], labels[index]
            error = sigmoid(intercept + sum(w * value for w, value in zip(weights, x))) - label
            grad_b += error
            for i, value in enumerate(x): grad[i] += error * value
        step = rate / math.sqrt(epoch + 1); count = len(labels)
        intercept -= step * grad_b / count
        for i in range(len(weights)): weights[i] -= step * (grad[i] / count + penalty * weights[i])
    predictions = []
    for row in validation_rows:
        values = vector(row); x = [(values[i] - means[i]) / scales[i] for i in range(len(FEATURES))]
        predictions.append((sigmoid(intercept + sum(w * value for w, value in zip(weights, x))), row["goal"]))
    brier = sum((probability - label) ** 2 for probability, label in predictions) / max(1, len(predictions))
    log_loss = -sum(label * math.log(max(probability, 1e-9)) + (1 - label) * math.log(max(1 - probability, 1e-9)) for probability, label in predictions) / max(1, len(predictions))
    return {"status": "ready", "modelVersion": 1, "trainedAt": datetime.now(timezone.utc).isoformat(), "features": list(FEATURES),
        "means": [round(value, 8) for value in means], "scales": [round(value, 8) for value in scales], "coefficients": [round(value, 8) for value in weights],
        "intercept": round(intercept, 8), "metrics": {"validationShots": len(predictions), "brier": round(brier, 5), "logLoss": round(log_loss, 5), "auc": round(auc(predictions), 4)}}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-games", type=int, default=int(os.environ.get("MAX_MODEL_GAMES", "180")))
    parser.add_argument("--no-fetch", action="store_true")
    args = parser.parse_args()
    payload = json.loads(TRACKER.read_text()); season = str(payload.get("meta", {}).get("season"))
    path = CACHE_DIR / f"shot_features_{season}.jsonl"; rows = read_cache(path); cached = {row["game"] for row in rows}
    all_games = league_game_ids(payload, not args.no_fetch)
    eligible_games = set(all_games)
    # Seed from rich regular-season game snapshots already retained by the tracker.
    for game, detail in payload.get("gameCentre", {}).items():
        if game in eligible_games and game not in cached and (detail.get("pbp") or {}).get("plays"):
            rows.extend(extract_game(game, detail["pbp"])); cached.add(game)
    missing = [game for game in all_games if game not in cached][:0 if args.no_fetch else args.max_games]
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = {pool.submit(fetch_json, f"{API}/gamecenter/{game}/play-by-play"): game for game in missing}
        for future in as_completed(futures):
            game = futures[future]
            try:
                rows.extend(extract_game(game, future.result())); cached.add(game)
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, KeyError) as exc:
                print(f"warning: model game {game}: {exc}")
    write_cache(path, rows)
    games = len({row["game"] for row in rows}); shots = len(rows); goals = sum(row["goal"] for row in rows)
    previous = json.loads(OUTPUT.read_text()) if OUTPUT.exists() else {}
    eligible = games >= MIN_GAMES and shots >= MIN_SHOTS and goals >= MIN_GOALS
    model = train(rows) if eligible else previous.get("shotModel", {}) if previous.get("season") == season and previous.get("shotModel", {}).get("status") == "ready" else {"status": "collecting"}
    model.update({"trainingGames": games, "trainingShots": shots, "trainingGoals": goals, "minimumGames": MIN_GAMES, "minimumShots": MIN_SHOTS,
        "collectionProgress": round(min(games / MIN_GAMES, shots / MIN_SHOTS, goals / MIN_GOALS) * 100, 1), "remainingGames": max(0, len(all_games) - games)})
    result = {"version": 1, "season": season, "updatedAt": datetime.now(timezone.utc).isoformat(), "credit": "Original NHL Tracker model trained from official NHL play-by-play", "shotModel": model}
    OUTPUT.parent.mkdir(parents=True, exist_ok=True); OUTPUT.write_text(json.dumps(result, separators=(",", ":")))
    print(f"Tracker xG: {model['status']} · {games} games · {shots} shots · {goals} goals")


if __name__ == "__main__":
    main()
