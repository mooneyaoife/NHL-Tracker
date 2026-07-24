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

The scheduled updater combines official NHL data with approved MoneyPuck downloads. Natural Stat Trick CSV imports remain manual and are handled through the in-site refresh helper. PuckPedia mail exports contain only public-link metadata and are validated independently of NHL refreshes.

Automatic season rollover waits for the season-specific complete regular-season count for every NHL team (82 through 2025–26; 84 from 2026–27). If one or more schedule or roster requests fail, the generator retains the last complete artifact, labels it stale, and records the failed teams instead of publishing a partial season.

Game state and Europe/London date handling are shared between generation and presentation. Scheduled, pregame, live, intermission, delayed, postponed, suspended, cancelled, regulation final, overtime final and shootout final are distinct states.

## Run locally

```bash
python scripts/update_tracker.py
python -m http.server 8000 --directory site
```

Open `http://localhost:8000`.

To inspect the existing generated site without refreshing external data, run only the second command.

## Validate

```bash
python scripts/generate_build_metadata.py
python scripts/check_artifact_health.py
python -m py_compile scripts/*.py
python -m unittest discover -s tests -p "test_*.py"
node --check site/app.js
node tests/game_state.test.js
node tests/cloudflare_live_overlay.test.js
node tests/live_updates.test.js
node tests/site_contract.test.js
node tests/workflow_contract.test.js
node --test tests/cloudflare_api.test.mjs
python scripts/check_performance_budgets.py
python scripts/validate_mail_feed.py
pnpm install --frozen-lockfile --ignore-scripts
pnpm exec playwright install chromium
pnpm test:browser
```

The deployment and live-game workflows run the relevant fast checks before publishing. Pull requests run the responsive browser suite and throttled mobile Lighthouse budgets.

## Workflows and deploy approval

Generation and deployment are intentionally separate:

- **Generate scheduled NHL data** refreshes and commits generated artifacts four times per day. It never deploys directly; a successful completion hands the new default-branch artifact to the separate validation/deployment workflow.
- **Refresh active NHL games** checks hourly during likely game windows and deploys only when a followed-team game is active or in its pregame window.
- **Validate and deploy existing artifact** deploys an already committed artifact without an upstream refresh.
- **Validate isolated mail-feed artifact** checks metadata-only mail changes without refreshing NHL data or deploying.

GitHub Pages remains the primary deployment. An optional, access-controlled Cloudflare Pages deployment can run alongside it; see [Parallel hosting](docs/parallel-hosting.md).

Cloudflare deployment remains opt-in through `CLOUDFLARE_DEPLOY_ENABLED`. Before approving a production run, review the committed `site/build-meta.json`, confirm repository variables and secrets in [Reliability and operations](docs/reliability-and-operations.md), then manually run **Validate and deploy existing artifact**. The Cloudflare build remains private, noindexed and protected by Access; its authenticated smoke check covers `/`, `/data/tracker.json` and `/api/health`.

The interface renders the committed static snapshot first. Cloudflare live data enhances it in the background and reports full, partial, cached, stale or static-fallback freshness. See [Reliability and operations](docs/reliability-and-operations.md) for caching, provenance, offline limits and recovery behaviour.

NHL Tracker is an unofficial, non-commercial fan project and is not affiliated with the NHL.
