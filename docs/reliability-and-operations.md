# Reliability and operations

## Runtime model

`site/data/home.json` is a compact, provenance-backed first view. `site/shell.js` renders the latest slate and registers offline support without parsing the analytical application. Tonight and the initial Season calendar use `site/route-app.js`; the analytical application loads only when a deeper destination opens. Charts still wait for chart intent or scrolling. A failed optional request must not replace a valid static view.

Current-season data is generated as four capability artifacts: `tracker-core.json` (standings and slate), `tracker-schedule.json`, `tracker-players.json`, and `tracker-analytics.json`. `tracker-manifest.json` records their sizes and hashes. The browser merges these into the established tracker runtime shape, so routes and renderers do not need a second schema. `tracker.json` remains the canonical artifact, the archive format, and the transitional fallback for an old installed cache. Run `python scripts/split_tracker_data.py` after changing a committed tracker by hand; scheduled generation does this automatically.

Cloudflare score and schedule requests settle independently. The overlay can retain the last good component and labels the result `live`, `partial-live`, `cached`, `partial-cached`, `stale` or `static-fallback`. The header exposes that state. API secrets remain GitHub secrets or Cloudflare environment bindings; they must never be written to `site/`.

The service worker precaches Home, the core and compact schedule capabilities, the lightweight route runtime, and the application shell. Offline Home, Tonight and the Season calendar therefore remain useful. This migration release retains the preceding cache so a legacy `tracker.json` can recover an interrupted capability upgrade. Live refreshes, advanced/player capability files, Plotly charts, archived seasons, mail and model data require a connection and are labelled as unavailable without replacing stored content.

## Generation safety

The generator normalises game states through `scripts/game_state.py` and renders the same model through `site/game-state.js`. All user-facing slate dates use Europe/London calendar dates, including midnight UTC and daylight-saving transitions.

A current regular season is complete only when every NHL team has the season-specific full schedule: 82 games through 2025–26 and 84 from 2026–27. Schedule or roster failures reuse the prior complete data, record freshness and failed teams, and stop if no safe fallback exists. Writes use temporary files followed by atomic replacement so readers never see a half-written JSON document.

`site/build-meta.json` records the source commit, artifact time, underlying data time and SHA-256 tracker hash. Deployment workflows regenerate it from the exact checked-out commit before upload. Generated tracker payloads also include source and data provenance when produced by the updater.

Before any scheduled, committed or live artifact is published, `scripts/check_artifact_health.py` verifies the tracker hash, provenance, complete schedule/roster coverage and data age. GitHub Actions summaries record the source commit, timestamp, age, hash, failed teams and deployment destinations. Fresh or intentionally static committed artifacts may be at most 24 hours old by default. An explicitly labelled complete `stale` or `partial-stale` fallback may be at most 72 hours old; incomplete, expired or unknown-status artifacts always fail closed.

`scripts/verify_production.py` repeats the provenance, hash and freshness checks against the deployed bytes. It verifies GitHub Pages after every deployment and once daily, and uses the existing Cloudflare Access service-token secrets to check the private root, tracker artifact and `/api/health`. Public and private source commits and tracker hashes must match. The verifier reads only the configured deployments; it never contacts the NHL or another data provider and never prints Access credentials.

## Workflow boundaries

- `update-and-deploy.yml` generates and commits scheduled data; it does not contain deployment logic. A successful run triggers `validate-and-deploy.yml`, which checks out the newly committed default-branch artifact before validating and publishing it. Failed generation never triggers a deployment.
- `live-games.yml` checks hourly during likely game windows and deploys only for followed-team active/pregame games.
- `validate-and-deploy.yml` validates and deploys existing committed data without contacting upstream NHL sources.
- `mail-feed.yml` validates metadata-only PuckPedia exports without an NHL refresh or deployment.
- `browser-tests.yml` and `performance.yml` protect responsive, accessibility, payload and LCP budgets on pull requests.
- `production-verify.yml` detects deployed artifact drift, expiry or endpoint failure once daily without triggering a refresh or deployment.

The hourly live cron has at most 19 checks per day during the configured months, down from 76 quarter-hourly checks. The server-side pregame/active filter prevents unrelated league games from triggering a deploy.

## Production approval checklist

No workflow, DNS, Cloudflare Access policy or production setting should be changed during a code-only review. Before an approved deploy:

1. Review the branch diff and confirm all local validation commands in the README pass.
2. Inspect `site/build-meta.json` and the tracker freshness/status fields.
3. Confirm GitHub Pages uses GitHub Actions.
4. If Cloudflare is enabled, confirm repository variables `CLOUDFLARE_DEPLOY_ENABLED`, `CLOUDFLARE_PAGES_URL`, `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_PAGES_PROJECT`.
5. Confirm secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCESS_CLIENT_ID` and `CLOUDFLARE_ACCESS_CLIENT_SECRET` are present and scoped narrowly.
6. Manually run **Validate and deploy existing artifact** and verify its authenticated root, tracker-data and health smoke checks.
7. From an unauthenticated session, confirm the private Cloudflare origin still redirects to Access and remains noindexed.

### Artifact-age thresholds

Repository variables `MAX_FRESH_ARTIFACT_AGE_HOURS` and `MAX_FALLBACK_ARTIFACT_AGE_HOURS` may raise or lower the default 24-hour and 72-hour limits without changing code. This is the emergency adjustment mechanism, not a bypass: hashes, provenance, recognised freshness status and complete safe snapshots remain mandatory. Record the reason and intended expiry when changing either variable, restore the defaults after recovery, and rerun **Validate and deploy existing artifact**. Never use a threshold change to label incomplete data as fresh.

Do not log secret values or place service tokens in client-side JavaScript. Rotating credentials or changing Access/DNS remains a separate, explicitly approved infrastructure operation.
