# Reliability and operations

## Runtime model

`site/data/home.json` is a compact, provenance-backed first view. `site/shell.js` renders the latest slate and registers offline support without parsing the analytical application. Navigation, a user scroll or a deep link then loads the full `site/data/tracker.json` application; charts wait for chart intent or scrolling. This keeps Home useful during startup while deferring the monolithic analytical code, Cloudflare score/schedule overlay, auxiliary model/mail data, Plotly and season archives. A failed optional request must not replace a valid static view.

Cloudflare score and schedule requests settle independently. The overlay can retain the last good component and labels the result `live`, `partial-live`, `cached`, `partial-cached`, `stale` or `static-fallback`. The header exposes that state. API secrets remain GitHub secrets or Cloudflare environment bindings; they must never be written to `site/`.

The service worker precaches the lightweight Home artifact, application shell and current tracker snapshot. Offline Home and Tonight use those cached snapshots. Live refreshes, Plotly charts, archived seasons, mail and model data require a connection.

## Generation safety

The generator normalises game states through `scripts/game_state.py` and renders the same model through `site/game-state.js`. All user-facing slate dates use Europe/London calendar dates, including midnight UTC and daylight-saving transitions.

A current regular season is complete only when every NHL team has the season-specific full schedule: 82 games through 2025–26 and 84 from 2026–27. Schedule or roster failures reuse the prior complete data, record freshness and failed teams, and stop if no safe fallback exists. Writes use temporary files followed by atomic replacement so readers never see a half-written JSON document.

`site/build-meta.json` records the source commit, artifact time, underlying data time and SHA-256 tracker hash. Deployment workflows regenerate it from the exact checked-out commit before upload. Generated tracker payloads also include source and data provenance when produced by the updater.

## Workflow boundaries

- `update-and-deploy.yml` generates and commits scheduled data; it does not deploy.
- `live-games.yml` checks hourly during likely game windows and deploys only for followed-team active/pregame games.
- `validate-and-deploy.yml` validates and deploys existing committed data without contacting upstream NHL sources.
- `mail-feed.yml` validates metadata-only PuckPedia exports without an NHL refresh or deployment.
- `browser-tests.yml` and `performance.yml` protect responsive, accessibility, payload and LCP budgets on pull requests.

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

Do not log secret values or place service tokens in client-side JavaScript. Rotating credentials or changing Access/DNS remains a separate, explicitly approved infrastructure operation.
