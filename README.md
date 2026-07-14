# NHL Tracker

An automatically updated, interactive NHL dashboard for the Buffalo Sabres, San Jose Sharks, Minnesota Wild and Carolina Hurricanes.

## What it includes

- Four-team-first dashboard with expandable detail
- UK-time schedule calendar and dedicated Game Centre
- Game Night Centre with official scoring, penalties, player leaders, three stars, play-by-play and shot maps
- Live game-day lineup, injury and starting-goalie links for every selected matchup
- Team dashboards, division race histories and interactive season graphs
- Player and goalie centres with full names and official roster images
- Official NHL standings and tracked-team ranks
- Confirmed updates, roster-change detection and clearly separated rumour sources
- Automatic official NHL headlines, curated insider timelines, current podcast episodes and recent hockey videos
- Power rankings using approved MoneyPuck downloads with visible credit
- Phase-aware playoff information
- Automatic season rollover with selectable per-season archives
- Cached boxscores for fast incremental updates
- Scheduled updates through GitHub Actions
- Game-night snapshots approximately every 15 minutes while a tracked team is active
- An in-site Natural Stat Trick Refresh Centre with stale-data reminders and a one-file upload helper
- Free hosting through GitHub Pages

## First deployment

1. Open **Settings → Pages** in this repository.
2. Under **Build and deployment**, select **GitHub Actions** as the source.
3. Open **Actions**, select **Update NHL Tracker and deploy**, and choose **Run workflow**.
4. When it finishes, the site will be available at `https://mooneyaoife.github.io/NHL-Tracker/`.

The workflow also runs automatically four times per day. In automatic mode, the tracker checks the NHL's next-season schedule and rolls forward only after a substantial regular-season schedule is published. Every refresh preserves the active season under `site/data/seasons/`, and the website's Season menu makes completed seasons selectable. NHL and MoneyPuck feeds resume automatically; Natural Stat Trick remains a clearly labelled manual CSV import.

## Run locally

```bash
python scripts/update_tracker.py
python -m http.server 8000 --directory site
```

Then open `http://localhost:8000`.

This is an unofficial fan project and is not affiliated with the NHL.
