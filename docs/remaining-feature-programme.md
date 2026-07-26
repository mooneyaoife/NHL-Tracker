# Remaining Feature Programme

## Goal

Complete the strongest distinct ideas in the established backlog without duplicating working product areas, weakening evidence standards, or increasing initial-route cost.

## Backlog resolution

| Option | Resolution | Evidence |
|---|---|---|
| Watch Next | Implemented | Compact Home intelligence with exact Game Centre links and labelled source season |
| Since last check | Implemented | Device-local result, schedule, roster, rank, forecast and saved-player comparison |
| Week-ahead schedule stress | Batch 1 implemented | Precomputed seven-day team windows using canonical schedule burden evidence |
| Schedule change monitor | Superseded | Release centre history, Since last check, plus changed-game markers in Calendar |
| Daily league signal board | Superseded | Tonight and Watch Next already cover the league and followed-team shortlist |
| Roster movement digest | Existing; Batch 2 refinement | Transactions already separates tracker detection, reporting and official confirmation |
| Team/player change watch | Partial; Batch 2 refinement | Saved players are covered; league roster events need a discoverable fallback |
| Player form watch | Deferred | Current season has no game sample; completed-season evidence must not be presented as current form |
| Why this is unusual / season comparison | Rejected for this release | Existing archives, comparisons and histories cover the safe evidence; stronger claims need a valid cross-season normalisation model |
| Matchup evidence brief | Implemented | Game Centre already has pregame evidence, transparent lean and methodology |
| Game-day pulse / postgame summary | Implemented | Existing Game Day and postgame views are state-aware |

## Batch 1 — Calendar Pressure Window

**Problem:** Calendar showed dates but did not answer which next game or seven-day span carries the greatest schedule load.

**Delivered:** A precomputed team window for all 32 clubs, league percentile, one-to-three plain-language reasons, current/offseason/complete/stale/archive states, changed-schedule markers, and exact Game Centre hand-off. The calculation is workload context, never a result prediction. It uses no new request and stays in the Schedule-only runtime.

**Checkpoint:** 32 team models, 103 upcoming team-game entries, bounded signals and percentiles, London-date rollover, shard preservation, JavaScript syntax and site/data contracts passed. Mobile and desktop exact-scope browser checks passed. Full regression remains in the final validation batch.

## Batch 2 — Roster Continuity Without False Empties

**Problem:** The movement desk defaults correctly to followed teams, but currently reports an empty state while five recent tracker-detected changes exist elsewhere in the league.

**Delivered:** Added followed-team/all-NHL scope, followed-first ordering, an explicit league fallback, exact team-roster hand-off, direct-link persistence, and sparse/freshness wording while retaining the distinction between detected, reported and officially confirmed information. All-team context renders only the requested extra roster rather than creating 32 full roster panels.

**Checkpoint:** The five current tracker-detected league changes are discoverable, the default followed-team desk remains personalised, movement scope survives in the URL, and exact roster hand-off passed on mobile and desktop. JavaScript syntax and site/data contracts passed. Full regression remains in the final validation batch.

## Deferred/rejected guardrails

- Do not label completed-season player data as current form.
- Do not add a second league slate, schedule monitor, matchup preview or postgame surface.
- Do not make “unusual” or predictive claims without a comparable cross-season baseline and disclosed uncertainty.
- Do not add a framework, dependency, browser-time API loop or initial Home payload.

## Completion record

### Batch 1 files

- Data and integration: `scripts/schedule_pressure.py`, `scripts/update_tracker.py`, `scripts/split_tracker_data.py`, `site/data/tracker.json`, `site/data/tracker-schedule.json`, `site/data/tracker-manifest.json`.
- Interface: `site/index.html`, `site/app.js`, `site/routes/season.js`, `site/design-system.css`, generated `site/core-routes.css`.
- Regression coverage: `tests/test_schedule_pressure.py`, `tests/test_split_tracker_data.py`, `tests/data_integrity.test.js`, `tests/site_contract.test.js`, `tests/browser/tracker.spec.mjs`.

### Batch 2 files

- Interface and continuity: `site/index.html`, `site/app.js`, `site/styles.css`.
- Regression coverage: `tests/site_contract.test.js`, `tests/browser/tracker.spec.mjs`.

### Final validation

- Python: 68 unit tests passed, including current-window, offseason, completed-season, sparse-data and London-date cases; Python compilation passed.
- JavaScript and contracts: all repository syntax, calculation, data-integrity, loader, freshness, preferences, URL-safety, workflow and site-contract checks passed; Cloudflare API tests passed 6/6.
- Browser: full Playwright suite passed 118/118 on desktop and mobile. The post-render visual review found a missing descendant-selector extraction in the immediate Schedule stylesheet; the extractor was corrected and the focused Schedule/roster suite then passed 4/4 with explicit computed-grid assertions.
- Accessibility and responsive behaviour: principal and redesigned journeys had no serious automated accessibility violations; mobile, intermediate and desktop route containment passed, as did keyboard/touch and 200% reflow coverage.
- Performance: deterministic budgets passed without being raised. Initial JavaScript is 20,992/21,000 bytes, initial CSS 213,866/220,000 bytes, initial JSON 66,820/100,000 bytes, offline cache 1,822,742/2,100,000 bytes, and the Schedule shard 1,365,131/1,554,682 bytes.
- Lighthouse: three final, post-fix simulated-mobile runs passed the configured assertions. Median performance was 0.99, accessibility/best-practices/SEO were 1.00, LCP was 1,751 ms, TBT was 89 ms and CLS was 0.
- Hosting: the static artifact was exercised directly through the production-equivalent compressed server. The root-hosted private Cloudflare artifact built and passed its canonical URL, noindex, security-header, function-routing and required-file verification. No production deployment was made.

### Known limitation

The active 2026–27 artifact is still preseason. Schedule pressure therefore labels preseason opponent evidence explicitly and does not treat it as current-season form. Player Form Watch remains blocked until a real current-season sample exists.
