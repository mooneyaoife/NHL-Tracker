# NHL Tracker

An automatically updated, interactive NHL dashboard for the Buffalo Sabres, San Jose Sharks, Minnesota Wild and Carolina Hurricanes.

## What it includes

- Four-team-first dashboard with expandable detail
- UK-time schedule calendar and individual game centre
- Team dashboards, division race histories and interactive season graphs
- Player and goalie centres with full names and official roster images
- Official NHL standings and tracked-team ranks
- Confirmed updates, roster-change detection and clearly separated rumour sources
- Power rankings using approved MoneyPuck downloads with visible credit
- Phase-aware playoff information
- Per-season data archives for future team comparisons
- Cached boxscores for fast incremental updates
- Scheduled updates through GitHub Actions
- Free hosting through GitHub Pages

## First deployment

1. Open **Settings → Pages** in this repository.
2. Under **Build and deployment**, select **GitHub Actions** as the source.
3. Open **Actions**, select **Update NHL Tracker and deploy**, and choose **Run workflow**.
4. When it finishes, the site will be available at `https://mooneyaoife.github.io/NHL-Tracker/`.

The workflow also runs automatically four times per day. The active season is set in `config.json`; every refresh also preserves a season archive under `site/data/seasons/` so completed seasons are not overwritten.

## Run locally

```bash
python scripts/update_tracker.py
python -m http.server 8000 --directory site
```

Then open `http://localhost:8000`.

This is an unofficial fan project and is not affiliated with the NHL.
