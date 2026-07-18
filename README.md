# NHL Tracker

A personal NHL companion for scores, schedules, game context, team and player analysis, league reporting and reference material. The interface favours followed teams while keeping the full league available. It does not include betting odds.

## Product

- **Home** — a personal command desk for Tonight, the season, saved players and pinned analysis
- **Tonight** — every NHL game in UK time, with followed teams first and expandable matchup evidence
- **Season** — calendar, schedule shape, key dates, demanding stretches and playoff context
- **Game Centre** — pregame briefing, official live or final reporting, lineups, shot maps and a searchable game library
- **Teams and Players** — results, form, expected goals, special teams, player impact, goaltending and game logs
- **League** — standings, rankings, trends, power index, playoff forecasts and comparison tools
- **Movement** — official news, transactions, contracts, cap links, rosters, podcasts and video
- **Workspace** — followed teams, saved players, saved analytical views, display preferences and installation
- **Reference** — sourced definitions, formulas, interpretations and cautions for statistics used by the tracker

The site supports light and dark themes, keyboard navigation, reduced motion, responsive layouts and installation as a progressive web app.

## Data

The scheduled updater combines official NHL data with approved MoneyPuck downloads. Natural Stat Trick CSV imports remain manual and are handled through the in-site refresh helper. PuckPedia contract and cap actions open the current live source rather than storing a duplicate.

Automatic season rollover waits for a substantial new regular-season schedule, preserves completed seasons under `site/data/seasons/`, and uses the latest complete season as context while current-season samples are empty.

## Run locally

```bash
python scripts/update_tracker.py
python -m http.server 8000 --directory site
```

Open `http://localhost:8000`.

To inspect the existing generated site without refreshing external data, run only the second command.

## Validate

```bash
python -m py_compile scripts/update_tracker.py scripts/train_tracker_models.py
python -m unittest discover -s tests -p "test_*.py"
node --check site/app.js
```

The deployment and live-game workflows run these checks before publishing.

## Deploy

1. In GitHub, open **Settings → Pages** and select **GitHub Actions** as the source.
2. Open **Actions → Update NHL Tracker and deploy**.
3. Choose **Run workflow**.

The main workflow refreshes and deploys four times per day. A separate game-night workflow checks for active tracked games every 15 minutes during likely NHL hours.

GitHub Pages remains the primary deployment. An optional, access-controlled Cloudflare Pages deployment can run alongside it; see [Parallel hosting](docs/parallel-hosting.md).

NHL Tracker is an unofficial, non-commercial fan project and is not affiliated with the NHL.
