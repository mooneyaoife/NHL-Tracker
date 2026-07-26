# NHL Tracker full audit, implementation and final QA

Audit date: 26 July 2026

Release candidate: UI 7.35.0 / data 5.74.0 / season 2026–27

Baseline source: `f4f155bba8ff0edad0f8bb0f28e74194f1b614f2`

Working branch: `agent/full-audit-v734`

Production merge: `96cffe60784cd485eb2f21fe2d60c57b30269ab3` (PR #11)

## 1. EXECUTIVE SUMMARY

NHL Tracker is a unusually capable static-first personal hockey application. It combines official NHL schedules, game states, standings and rosters with season archives, player/team analysis, comparisons, power rankings, news, third-party evidence, calendar feeds and an installable offline shell. Its strongest original qualities were honest freshness labelling, detailed exceptional-game handling, Europe/London date support, capability-based data loading, and a cautious Cloudflare live-data layer that preserves a verified static snapshot when an upstream request fails.

The initial application was functional and its displayed NHL sample data was accurate, but the audit confirmed several material release-quality problems. Every human-readable URL advertised by the sitemap returned a GitHub Pages 404; mobile Lighthouse measured severe cumulative layout shift (CLS 0.306–0.444); scheduled data commits omitted the metadata used to identify and assess their artifact; the development dependency graph contained known vulnerabilities; provider-controlled URLs were inserted or opened without a protocol allowlist; GitHub Actions used mutable version tags; and a claimed Policies route had no page. A Cloudflare authentication error also exposed internal audience identifiers, and an undefined team identity produced a broken NHL-logo request.

The release candidate fixes all confirmed feasible High and Medium findings and connected low-risk findings. Direct links now have generated, query-preserving hand-off pages; the incomplete Home layout is withheld until its small snapshot has rendered; core styles are active for first paint; artifact metadata is committed with refreshed data; workflow actions are immutable; dependency audit is clean; external URLs accept HTTPS only; Access errors no longer disclose audience values; Policies is a real route; and unknown team identities use a local image.

Final local QA is clean: 56 Python tests, all fast JavaScript and Cloudflare tests, all performance budgets, the Cloudflare production build, 90 Playwright tests, a compact WebKit smoke pass, and three Lighthouse runs passed. Final Lighthouse results were performance 100/100/100, accessibility 100/100/100, LCP 1,653 ms in every run, and CLS 0 in every run. No known feasible Critical, High or Medium defect remains. The only remaining items are optional defence-in-depth or disproportionate refactors described in section 16.

## 2. SYSTEM MAP

### Architecture and important files

- `site/index.html` is the static document, route inventory, progressive shell markup and metadata entry point.
- `site/shell.js` renders the compact Home snapshot and loads either the lightweight route runtime or the complete analytical application on demand.
- `site/route-app.js`, `site/routes/night.js` and `site/routes/season.js` implement the lightweight Tonight, Game Centre and Schedule experience.
- `site/app.js` owns the complete analytical application and shared rendering behaviour. `site/router.js`, `site/route-loader.js`, `site/data-loader.js`, `site/preferences.js` and `site/statistics.js` separate navigation, capability loading, persistence and calculations.
- `site/data/*.json` is the checked-in static data artifact. Capability shards keep initial and route-specific transfers bounded. `site/data/seasons/` contains historical archives.
- `scripts/update_tracker.py` obtains and transforms NHL and supporting-provider data. `scripts/generate_home_snapshot.py`, `scripts/generate_build_metadata.py` and related scripts derive deployable artifacts without requiring runtime server rendering.
- `functions/api/` provides the allowlisted Cloudflare Pages Functions API. `functions/_shared/access.mjs` validates Cloudflare Access JWTs. The function layer uses bounded upstream timeouts/retries, state-aware caching and stale fallback.
- `site/sw.js` makes Home, Tonight and Schedule dependable offline, while deeper analysis is cached only after use.
- `.github/workflows/update-and-deploy.yml` refreshes data four times daily. `.github/workflows/live-games.yml` runs only in active-game windows. `.github/workflows/validate-and-deploy.yml` validates one committed artifact, publishes it to GitHub Pages, builds/deploys the Cloudflare artifact, and verifies both destinations. Separate workflows cover browser tests, Lighthouse/performance, production verification and the isolated metadata-only mail feed.

### Data flow

1. Scheduled Python generation requests official NHL endpoints and configured supporting sources.
2. Validation and deterministic transforms create capability shards, archives, calendars, compact Home data and artifact metadata.
3. The repository stores the last verified artifact. Failure does not silently replace it with incomplete data.
4. GitHub Pages serves the public static site. Cloudflare Pages serves the same site plus protected Functions endpoints.
5. The browser renders static data first. The private deployment may enhance it with live Cloudflare data; states are explicitly labelled live, partial-live, cached, stale or static fallback.

### Deployment relationship

At baseline, `origin/main` and the audit worktree both pointed to `f4f155b`. The last observed successful deployment workflow was run `30197150887`, and the public and private artifact verifier reported the same current artifact. There was therefore no initial code drift between the checked-out main branch and the deployed release, although generated `build-meta.json` could drift after scheduled refreshes because the workflow failed to commit it. The release candidate changes one shared `site/` artifact for both hosts; Cloudflare adds Functions and Access rather than maintaining a second UI implementation.

## 3. ROUTE AND FEATURE INVENTORY

| Route | Major features | Initial status | Final status |
|---|---|---|---|
| Home (`#dashboard`) | snapshot, followed teams, latest slate, meaningful changes, saved analysis | Working but severe load shift | Repaired; stable compact first render |
| Tonight (`#tonight`) | slate, live/static state, exceptional states | Working | Working; regression-tested |
| Game Centre (`#games`) | featured game, library, recap, matchup panes | Working | Working; progressive loading retained |
| Lineups (`#availability`) | projected lines, pairings, scratches, source evidence | Working | Working |
| Schedule (`#schedule`) | calendar, release centre, export, archive context | Working hash route; `/season/` 404 | Working; direct hand-off repaired |
| Form & trends (`#trends`) | form and analytical trends | Working | Working |
| Playoff path (`#playoffs`) | standings context and model output | Working | Working |
| Teams (`#teams`) | overview, roster, statistics and advanced evidence | Working | Working; mobile rail test corrected |
| Players (`#players`) | team/player selection, profiles and season-aware evidence | Working | Working |
| Compare (`#compare`) | player/team comparisons | Working | Working |
| League (`#league`) | standings and league-wide context | Working | Working |
| Power Rankings (`#power`) | descriptive tracker model and movement | Working | Working |
| News (`#news`; public alias `/movement/`) | NHL news, transactions and movement | Working | Working; provider links protocol-checked |
| Workspace (`#watchlist`) | followed teams, players, saved views, preferences, install | Working | Working |
| Reference (`#guide`) | searchable definitions and sources | Working | Working |
| Data status (`#status`) | freshness, coverage, source state, manual NST helper | Working | Working |
| Policies (`#policies`) | data/editorial, privacy, correction and rights statements | Router/sitemap claim only; no page | Repaired and included in navigation/QA |

All 16 original live hash routes were inspected at desktop, 375×812 and 768×1024. All resolved to the correct active route and heading without fatal errors or document overflow. The release candidate contains 17 real pages. Sixteen public slug aliases (`/tonight/`, `/games/`, `/lineups/`, `/season/`, `/trends/`, `/playoffs/`, `/teams/`, `/players/`, `/compare/`, `/league/`, `/power/`, `/movement/`, `/workspace/`, `/reference/`, `/status/`, `/policies/`) now hand off to the corresponding canonical hash route. The unsupported `widget` metadata entry was obsolete and removed.

## 4. AUDIT METHOD

The audit started from repository status, branch and commit, then read the README, manifests, entry points, route/runtime loaders, data generators, Cloudflare Functions, build scripts and all workflows. Generated dependencies, caches and build output were not manually scanned. Existing tests and artifact budgets established the baseline before application edits.

Live inspection covered the public GitHub Pages deployment and the Cloudflare Access boundary. Each accessible hash route was opened once systematically. Viewports were desktop, 768×1024 and 375×812; automated reflow checks also exercised 1024×820 and 390×844. Chromium supplied the full functional, responsive and axe run. WebKit 26.0 supplied a compact Home/Schedule/Policies smoke check. Browser console, failed requests, route identity, headings and horizontal overflow were observed. The private unauthenticated state was checked; it correctly redirected to Cloudflare Access. The authenticated private session expired during the audit, so post-release private verification relies on the established service-token production verifier rather than recording or requesting credentials.

Data checks compared selected generated values directly with official NHL endpoints on 26 July 2026. The audit checked schedule identity, dates, London rollover, standings, score slate and roster membership, plus existing DST/midnight fixtures. Security review included tracked-code secret patterns, client/server boundaries, Access validation, endpoint allowlists, workflow permissions/action references, dependency audit and externally supplied URLs. Performance evidence came from byte budgets, request-aware Playwright tests and throttled Lighthouse rather than unmeasured optimisation guesses.

## 5. FINDINGS REGISTER

### F-01 — advertised direct routes returned 404

- Category: Routing, deployment and SEO
- Severity / confidence: **High / Confirmed**
- Affected feature: every non-hash URL in the original sitemap
- Evidence and reproduction: open `/NHL-Tracker/season/` or any of the other 16 sitemap slugs on GitHub Pages; the host returned its “File not found” page. The original `site/sitemap.xml` advertised directories that did not exist.
- File/function: `site/sitemap.xml`; new `scripts/generate_route_aliases.py`; generated `site/*/index.html`
- Impact: shared/bookmarked links and search-crawler destinations failed even though the equivalent hash page worked.
- Cause: a static GitHub Pages site cannot rewrite arbitrary paths to `index.html`, while navigation itself used hash routes.
- Resolution: generated deterministic static hand-off pages that preserve the query string and set the matching hash. Alias pages are `noindex,follow`; the sitemap now advertises only the canonical root to avoid duplicate competing URLs.
- Validation: site contract checks all aliases; Playwright opened `/season/?month=2026-10` and reached `/?month=2026-10#schedule` with the Schedule page active.
- Final status: **Fixed**.

### F-02 — Home had severe cumulative layout shift

- Category: Performance and visual stability
- Severity / confidence: **High / Confirmed**
- Affected feature: Home first load, especially throttled mobile
- Evidence and reproduction: baseline Lighthouse runs measured CLS 0.306, 0.444 and 0.444 and performance 84, 80 and 80. Core route CSS also used `media="print"`/`onload`, allowing an incomplete styled state to paint. Trace review isolated the dominant shift to replacement of Home’s loading slate with compact `home.json` content.
- File/function: `site/index.html` (`#dashboard.home-pending`, core stylesheet links); `site/shell.js` (`settleHome`)
- Impact: content visibly jumped while loading and could move a user’s intended target.
- Cause: a dynamic, differently sized Home skeleton became visible before the compact snapshot settled; critical route styles were activated after first paint.
- Resolution: load `critical.css` and `core-routes.css` synchronously, keep the incomplete Home page invisible until `renderHome` resolves, and reveal an honest error fallback if it fails. A `noscript` rule keeps static content visible without JavaScript.
- Validation: a Playwright CLS observer and an LHCI assertion now enforce CLS ≤0.1. Final three runs measured CLS 0/0/0, performance 100/100/100, accessibility 100/100/100 and LCP 1,653 ms in every run.
- Final status: **Fixed**.

### F-03 — scheduled artifacts omitted their identifying metadata

- Category: Data freshness, deployment and observability
- Severity / confidence: **High / Confirmed**
- Affected feature: scheduled refresh commit and production artifact provenance
- Evidence and reproduction: `.github/workflows/update-and-deploy.yml` generated metadata but staged only `site/data data/cache`; `site/build-meta.json` could therefore continue identifying an older data hash/source after a successful refresh.
- File/function: `.github/workflows/update-and-deploy.yml`, “Commit refreshed data” step
- Impact: deploy/status diagnostics could report stale provenance and make repository-to-production drift harder to diagnose.
- Cause: incomplete `git add` scope.
- Resolution: stage `site/build-meta.json` together with the refreshed data and cache. A workflow contract locks this behaviour.
- Validation: metadata generation, artifact health, workflow contract and Cloudflare build verification all passed.
- Final status: **Fixed**.

### F-04 — known dependency vulnerabilities in test tooling

- Category: Supply-chain security and reproducibility
- Severity / confidence: **High / Confirmed**
- Affected feature: development/CI dependency graph, not shipped browser runtime
- Evidence and reproduction: baseline `pnpm audit` reported five advisories through transitive tooling; a later registry check also identified the then-current `tmp` advisory.
- File/function: `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`
- Impact: compromised or malicious test inputs could reach vulnerable transitive code in local/CI tooling; stale test tooling also reduced reproducibility.
- Cause: older Playwright plus vulnerable transitive versions selected by Lighthouse/CLI dependencies.
- Resolution: update `@playwright/test` 1.55.0→1.55.1 and pin safe transitive overrides `brace-expansion` 5.0.8, `tmp` 0.2.7 and `uuid` 11.1.1. Add weekly Dependabot coverage and a high-severity CI audit.
- Validation: `pnpm install --frozen-lockfile --ignore-scripts`, full Playwright, Lighthouse and `pnpm audit --audit-level=moderate` passed; audit result was “No known vulnerabilities found”.
- Final status: **Fixed**.

### F-05 — Actions used mutable tags

- Category: CI supply-chain security
- Severity / confidence: **Medium / Confirmed**
- Affected feature: all seven GitHub Actions workflows
- Evidence and reproduction: workflow steps used references such as `actions/checkout@v7` and `actions/setup-python@v6`.
- File/function: `.github/workflows/*.yml`; `tests/workflow_contract.test.js`
- Impact: the executed third-party code could change without a repository change or review.
- Cause: convenient major-version tags were used instead of immutable commits.
- Resolution: pin every action to a verified 40-character commit SHA while retaining the release tag in a comment; add a contract that rejects mutable `uses:` references.
- Validation: workflow contract passed and Cloudflare build verification accepted the resulting workflows.
- Final status: **Fixed**.

### F-06 — provider URLs had no protocol allowlist

- Category: Client security
- Severity / confidence: **Medium / Confirmed**
- Affected feature: news, recaps, reports, transactions, podcast/video links and global search
- Evidence and reproduction: multiple `app.js` templates inserted source-provided `item.url` values into anchors or passed them to `window.open`; HTML escaping alone does not reject a dangerous URL scheme.
- File/function: new `site/url-safety.js`; `site/app.js` helpers `externalUrl` and `safeUrl`, plus provider-link renderers
- Impact: if an upstream/generated record were compromised, a user action could navigate to a non-HTTPS scheme.
- Cause: text escaping and URL-policy enforcement were conflated.
- Resolution: central HTTPS-only URL sanitiser, applied to all provider-controlled anchors and `window.open` paths. Invalid values become inert or are not opened.
- Validation: `tests/url_safety.test.js` covers HTTPS, HTTP, JavaScript, data, relative and malformed inputs; site contracts assert integration; full browser suite passed.
- Final status: **Fixed**.

### F-07 — Cloudflare Access audience identifiers leaked in errors

- Category: Privacy and diagnostic hardening
- Severity / confidence: **Low / Confirmed**
- Affected feature: invalid-audience API response
- Evidence and reproduction: `authenticateAccess` attached the received and expected audience to an exception; middleware returned both in headers and JSON.
- File/function: `functions/_shared/access.mjs` (`authenticateAccess`); `functions/api/_middleware.js` (`onRequest`)
- Impact: unauthenticated callers could learn internal Access application identifiers. This did not bypass authentication but was unnecessary disclosure.
- Cause: deployment troubleshooting data was returned to the caller instead of remaining server-side.
- Resolution: preserve the generic denial code/message and remove values from exceptions, headers and response bodies.
- Validation: six Cloudflare API tests passed, including a source regression that forbids audience response fields.
- Final status: **Fixed**.

### F-08 — Policies was claimed but absent; `widget` metadata was dead

- Category: Information architecture and maintainability
- Severity / confidence: **Medium / Confirmed**
- Affected feature: Policies, footer/workspace navigation, route catalogue
- Evidence and reproduction: the sitemap/router referred to Policies, but `site/index.html` contained no `#policies` page. Router metadata also described a `widget` page with no DOM target.
- File/function: `site/index.html`; `site/app.js` (`NAVIGATION`, `PAGE_NAMES`); `site/router.js`
- Impact: a promised destination failed and the route model did not match the application.
- Cause: metadata had been added without a corresponding page, while obsolete route metadata remained.
- Resolution: add a concise policy page appropriate to a private non-commercial tracker, expose it through footer/context/search navigation, cover it in responsive/axe tests, and remove unsupported widget metadata.
- Validation: 17-page DOM contract, alias contract, route navigation and both desktop/mobile axe runs passed.
- Final status: **Fixed**.

### F-09 — undefined team identities requested a nonexistent NHL logo

- Category: Reliability and visual polish
- Severity / confidence: **Low / Confirmed**
- Affected feature: utility routes before full team context was available
- Evidence and reproduction: WebKit console/network smoke observed `https://assets.nhle.com/logos/nhl/svg/_light.svg` returning 404 on Policies. `teamLogo(undefined)` interpolated an empty identity.
- File/function: `site/app.js`, `teamLogo`
- Impact: avoidable failed request and broken image risk.
- Cause: the fallback assumed every caller had a valid team abbreviation.
- Resolution: construct an NHL logo URL only for 2–4 uppercase letters; otherwise use the local application icon.
- Validation: source contract and final WebKit Home/Schedule/Policies smoke passed without failed requests or console errors.
- Final status: **Fixed**.

### F-10 — official NHL sample values and dates are accurate

- Category: Data integrity
- Severity / confidence: **Observation / Confirmed**
- Affected feature: schedules, standings, current slate and roster
- Evidence: data verification table in section 6.
- Cause/impact: no fault found. The generator preserves the official game identifier/date while separately deriving `londonDate`, which is the correct approach for an evening North American game that crosses midnight in London.
- Resolution: no data formula changed; existing contracts and DST fixtures were retained.
- Validation: official endpoint comparison plus 56 Python and data-integrity tests.
- Final status: **Not Reproducible** as a defect.

### F-11 — Cloudflare caching and failure behaviour are proportionate

- Category: Reliability and security
- Severity / confidence: **Observation / Confirmed**
- Affected feature: protected live API
- Evidence: endpoint allowlist, JWT signature/issuer/audience/expiry checks, local-only disabled-auth rule, bounded timeout/retry logic, state-aware cache TTLs, request identifiers and stale/static fallback are implemented under `functions/` and tested by `tests/cloudflare_api.test.mjs` and `tests/cloudflare_live_overlay.test.js`.
- Impact: the private layer does not block the valid static site and does not present a failed live request as current.
- Resolution: preserved; only diagnostic audience disclosure was removed.
- Final status: **Not Reproducible** as a defect.

### F-12 — a strict static Content Security Policy would require a separate migration

- Category: Defence-in-depth
- Severity / confidence: **Low / Confirmed design limitation**
- Affected feature: public static document
- Evidence: `site/index.html` intentionally contains inline first-paint theme/style/script content and the application loads provider media/integration URLs. Enforcing a useful CSP now would require hashes/nonces plus an audited resource inventory.
- Impact: absence of a restrictive CSP leaves one browser defence unused, but current risk is moderated by no public write surface, systematic text escaping, HTTPS URL allowlisting, protected Cloudflare APIs and no client secret.
- Resolution: deferred to avoid a cosmetic header that either breaks the PWA or permits broad unsafe-inline behaviour.
- Validation/status: **Deferred**; no Critical/High/Medium risk depends on it.

### F-13 — complete analytical CSS remains large but intentionally deferred

- Category: Maintainability and performance
- Severity / confidence: **Low / Confirmed design trade-off**
- Affected feature: deep analytical routes
- Evidence: canonical `styles.css`, `theme-569.css` and `design-system.css` total 473,965 bytes against a 500,000-byte budget. The initial core CSS is 201,728 bytes against 220,000, and the complete cascade is deferred until a deep route is requested.
- Impact: deep routes download a sizeable stylesheet, but the first-use cost is bounded and does not affect ordinary Home/Tonight/Schedule exploration.
- Resolution: no risky bulk consolidation during this audit; existing extraction script and budgets are retained.
- Final status: **Deferred** as disproportionate to current private-site benefit.

## 6. DATA VERIFICATION TABLE

Source for the checks below: official NHL web API, checked 26 July 2026. “Original” and “final” refer to the generated repository artifact before and after UI/security fixes; no analytical definition was silently changed.

| Check | Season/source | Expected | Original displayed/stored | Final | Result |
|---|---|---:|---:|---:|---|
| Buffalo regular-season game count | 2026–27 NHL club schedule | 84 | 84 | 84 | Exact |
| Buffalo schedule identifiers | 2026–27 NHL club schedule | 84 official IDs | all 84, no missing/extra | unchanged | Exact |
| Game `2026020011` | NHL schedule | ID, teams and start time match | match | unchanged | Exact |
| Game `2026020022` | NHL schedule | ID, teams and start time match | match | unchanged | Exact |
| Game `2026020049` date | NHL schedule / London transform | NHL date 6 Oct; 00:00 UTC on 7 Oct; London date 7 Oct | `date` 6 Oct, `londonDate` 7 Oct | unchanged | Correct dual context |
| Buffalo final standing | 2025–26 NHL standings | 82 GP, 50–23–9, 109 pts | same | unchanged | Exact |
| Carolina final standing | 2025–26 NHL standings | 82 GP, 53–22–7, 113 pts | same | unchanged | Exact |
| Minnesota final standing | 2025–26 NHL standings | 82 GP, 46–24–12, 104 pts | same | unchanged | Exact |
| San Jose final standing | 2025–26 NHL standings | 82 GP, 39–35–8, 86 pts | same | unchanged | Exact |
| Current score slate | NHL `score/now` | currentDate 29 Sep, 5 games | same | unchanged | Exact |
| Buffalo current roster | NHL roster endpoint | 32 players | 32, same identities | unchanged | Exact |

The existing game-state fixtures additionally cover delayed, suspended, cancelled, postponed, final overtime, final shootout, offseason and empty slates. Browser fixtures assert Europe/London midnight and daylight-saving boundaries. No confirmed standings, schedule, roster, timezone or game-state transformation error was found.

## 7. IMPLEMENTATION LOG

### Stable first paint and performance regression protection

- Changed `site/index.html` and `site/shell.js` to activate core styles before first paint and reveal Home only after the compact snapshot settles.
- Added CLS limits to `lighthouserc.json` and `performance-budgets.json` and a real layout-shift observer to `tests/browser/performance.spec.mjs`.
- Bumped the coherent UI/service-worker cache version to 7.35.0 in `site/app.js`, `site/shell.js`, `site/route-app.js`, `site/route-loader.js`, `site/sw.js`, HTML and offline tests.

### Direct-link and route consistency

- Added `scripts/generate_route_aliases.py` and 16 generated `site/<slug>/index.html` hand-off pages.
- Reduced `site/sitemap.xml` to the canonical indexable root.
- Added the real Policies page and navigation/search labels; removed obsolete widget metadata.
- Added direct-route, route-count, responsive and accessibility coverage.

### Artifact, CI and dependency integrity

- Updated `.github/workflows/update-and-deploy.yml` to commit generated build metadata.
- Pinned all GitHub Actions to immutable commits and added a workflow contract.
- Added `.github/dependabot.yml`, `pnpm-workspace.yaml` safe overrides, the Playwright patch update and CI dependency audit.
- Updated workflow path filters so lock/workspace changes run the relevant browser/performance jobs.

### Client and Cloudflare hardening

- Added `site/url-safety.js` and `tests/url_safety.test.js`; integrated the HTTPS allowlist into every provider-controlled link/open path in `site/app.js`.
- Removed Cloudflare Access audience details from `functions/_shared/access.mjs` and `functions/api/_middleware.js`; added a regression test.
- Made `teamLogo` use a local fallback for invalid/unknown identities.

### Documentation and generated metadata

- Updated `README.md` with route alias generation and URL safety validation.
- Regenerated `site/build-meta.json` and `site/data/home.json` using existing scripts; the deployment workflow regenerates provenance against the actual release commit.
- No database migration, DNS change, new paid service, new secret or manual data mutation is required.

## 8. LIVE DEPLOYMENT COMPARISON

The initial public site matched the baseline main branch and served a fresh 2026–27 artifact. The last baseline deployment observed was GitHub Actions run `30197150887`; its production verifier compared the public GitHub Pages artifact with the protected Cloudflare artifact and reported the same current version. Public root freshness and offseason wording were correct. Unauthenticated access to the private site redirected to Cloudflare Access as intended.

The meaningful baseline host difference was architectural: GitHub Pages served static public files, while Cloudflare served the same UI plus protected Functions. It was not a divergent frontend. The broken pretty URLs were specific to static hosting expectations and reproduced on GitHub Pages.

The release was squash-merged through PR #11 as `96cffe60784cd485eb2f21fe2d60c57b30269ab3`. Production workflow run `30200819685` passed in 52 seconds: it revalidated the committed artifact and freshness, deployed GitHub Pages, built and verified the Cloudflare artifact, deployed it, and then passed the authenticated public/private artifact comparison. A final public fetch confirmed UI 7.35.0, fresh season `20262027` metadata identifying the merge commit, and working `/season/` and `/policies/` hand-off documents. No Cloudflare value or credential is copied into this report.

## 9. DESIGN-SYSTEM CONSISTENCY REVIEW

The strongest original patterns were the editorial sheet/header hierarchy, shared design tokens, compact section navigation, source/freshness badges and progressive disclosure on dense analytical routes. Previous work had already consolidated header controls, removed duplicate season/archive choices, restored the schedule calendar, normalised title/type hierarchy and collapsed secondary evidence. The live route audit confirmed those patterns held at desktop, tablet and mobile without header overlap.

This audit found one cross-cutting visual defect rather than redesigning individual pages: Home’s incomplete state visibly displaced the established sheet layout. Fixing the render boundary restored consistency without changing the visual language. Policies reuses the existing title bar, grid and panel components. The unknown-team image fix removes a broken visual exception. All 17 pages retain the same typography/control hierarchy; automated tests verify principal-route hierarchy, singular season control, distinct header controls, non-overlapping tabs and mobile reflow.

Intentional exceptions remain: Home has a larger masthead; Tonight and Schedule use lighter route-specific shells; dense analytical routes load the complete design cascade only on demand. These reflect different tasks and performance needs rather than accidental styling forks.

## 10. ACCESSIBILITY REVIEW

The original application already had a skip link, landmarks, labelled selectors, focus restoration for search, focus trapping for dialogs, accessible route announcements, table-region labelling, chart accessible names, reduced-motion support and large touch targets on core actions. Baseline Lighthouse accessibility was 100.

The audit manually exercised keyboard-oriented search/theme navigation and checked route headings, active states, focus restoration, mobile reflow and dynamically exposed failure detail. Automated axe coverage spans Home, Tonight, Schedule, Game Centre, Teams, Players, League, Compare, Power, Workspace, News, Reference, Status and now Policies in both configured Chromium projects. No serious automated violation remains. Three final Lighthouse runs scored accessibility 100, and 90 Playwright tests passed.

Automated checks cannot prove the usefulness of every long chart description or the complete experience in every screen reader. Those are continuing content-quality considerations, not confirmed release blockers. The release did not add unnecessary ARIA or hide static error content from assistive technology.

## 11. PERFORMANCE AND RELIABILITY REVIEW

### Initial evidence

- Performance budget checks already passed, but throttled Home Lighthouse was only 80–84 because CLS reached 0.306–0.444.
- Initial JS was 20,329 bytes and compact Home data 12,971 bytes; the architecture was already genuinely progressive.
- Live data did not block static rendering, and offline tests covered the dependable shell.

### Final evidence

- Lighthouse (three mobile runs): performance 100/100/100; accessibility 100/100/100; FCP 1,203 ms each; LCP 1,653 ms each; CLS 0 each; TBT 0/42/0 ms.
- Final byte budgets: initial JS 20,475/21,000; initial CSS 201,728/220,000; initial data 12,971/100,000; offline shell 1,701,711/2,100,000; non-analytical JS 55,193/438,000; complete application JS 623,982/650,000; deferred CSS 473,965/500,000; Game Centre data 25,354/75,000; Season data 1,337,869/1,554,682.
- Playwright proves ordinary Home exploration does not load the complete app, Tonight uses only the lightweight runtime/core data, Game Centre and Season beat their transfer-reduction targets, and deeper Game Centre panes load only required capabilities.
- Offline Home/Tonight/Schedule and visible failure for uncached deep routes passed in desktop and mobile projects.
- Exceptional games, partial-live, cached, stale, static fallback, failed manual refresh and retained-artifact honesty all passed.

The release improves a measured problem without adding eager data preloads or more API calls. Existing Cloudflare cache invalidation, retry and stale-state semantics remain intact.

## 12. SECURITY AND PRIVACY REVIEW

No committed privileged credential or client-side API secret was found. Cloudflare values are read from deployment environment configuration; the private API verifies Access tokens and restricts disabled authentication to local origins. Protected endpoints are allowlisted and the public static UI remains usable without them.

Completed repairs were: HTTPS-only provider link handling, removal of Access audience values from unauthenticated errors, immutable workflow action pins, dependency remediation to zero known audit findings, weekly update automation and CI audit enforcement. Workflow permissions remain scoped: deployment jobs request Pages/id-token access while validation jobs do not receive broad write permission.

The public GitHub Pages version is intentionally public and indexable at its canonical root; the Cloudflare deployment remains the Access-protected personal instance. Alias pages are `noindex,follow`, preventing accidental index duplication. Local preferences and watchlists remain in browser storage; the app contains no advertising or analytics tracker.

No credential rotation or external account action is required. A restrictive CSP is the one deferred defence-in-depth item; section 16 gives the safe next action.

## 13. CODEBASE AND MAINTAINABILITY REVIEW

The application is large vanilla JavaScript rather than a framework build, but it has clear practical seams: shared data/statistical utilities, capability loaders, a progressive shell, route modules, a service worker, deterministic generators and extensive contract tests. That structure made it possible to repair shared roots without page-by-page patches.

Maintainability improvements in this release include a single URL-policy module, deterministic route alias generation, a contract tying every alias to its route, an artifact-metadata staging contract, immutable-action enforcement, automatic dependency update proposals, removal of dead route metadata and explicit Policies ownership. Version/cache updates were kept coherent across runtimes and tests.

The largest remaining debt is the size and density of `site/app.js` and the complete CSS cascade. Splitting code solely for aesthetics would be high regression risk. Existing capability/route modules already protect the user-facing load path, so further extraction should happen only when a feature change provides a natural tested boundary. The project has no configured lint or static type-check command; `node --check`, contracts, unit tests and browser tests are the current syntax/behaviour gates. Introducing a compiler or framework is not justified.

## 14. TESTING AND VALIDATION

Final validation completed on 26 July 2026:

- `python -m unittest discover -s tests -p 'test_*.py'` — **56 passed**.
- JavaScript suites for game state, frontend statistics, Cloudflare overlay, live updates, Game Centre, capability contracts, data loader, route loader, freshness, preferences, data integrity, site contracts, workflow contracts and URL safety — **all passed**.
- `node --test tests/cloudflare_api.test.mjs` — **6 passed**.
- `pnpm audit --audit-level=moderate` — **no known vulnerabilities**.
- `python scripts/check_performance_budgets.py` — **all byte/route budgets passed**.
- `python scripts/check_artifact_health.py …` — **fresh artifact passed**.
- `python scripts/verify_cloudflare_build.py …` — **Cloudflare production artifact passed**.
- `pnpm test:browser` / Playwright Chromium desktop and mobile — **90 passed** in 1.6 minutes.
- LHCI autorun — **3 of 3 passed**, with the metrics in section 11.
- WebKit 26.0 compact smoke at 390×844 for Home, Schedule and Policies — **passed** without overflow, console errors or failed requests.
- GitHub PR checks after the focused cross-platform assertion repair — browser **passed** (run `30200649484`), budgets **passed** (run `30200649480`).
- Production deployment and authenticated public/private verification — **passed** (run `30200819685`, merge `96cffe6`).
- `git diff --check` — **passed**.

The browser suite covers direct links, route announcements, back/focus behaviours, theme, postponed/delayed/suspended/cancelled/OT/SO/offseason/empty states, London DST/midnight dates, static-before-live rendering, recovery states, responsive layout, control duplication, UI hierarchy, progressive disclosure, touch targets, transfer limits, offline behaviour and serious axe violations. All original live routes were also inspected manually at representative viewports.

There is no repository lint or type-check script because the runtime is unbundled vanilla JavaScript. Syntax checks are run for runtime entry points and are supplemented by contract/unit/browser execution. Full manual authenticated private UI exploration was limited by the expired interactive Access session; the established service-token verifier is the authoritative post-deployment check for that artifact.

## 15. BEFORE-AND-AFTER SUMMARY

| Area | Before | After |
|---|---|---|
| Shared URLs | 16 advertised slugs returned GitHub Pages 404 | 16 deterministic query-preserving hand-offs; canonical sitemap |
| Home stability | CLS 0.306–0.444; visible load jump | CLS 0 in three runs; complete compact first render |
| Performance score | 80–84 in baseline runs | 100/100/100 |
| Artifact provenance | refreshed data could omit `build-meta.json` | metadata committed and contract-enforced |
| Dependency security | known transitive advisories | zero known vulnerabilities; weekly updates + CI audit |
| CI action integrity | mutable major tags | immutable SHA pins with update automation |
| Provider links | escaped text but unrestricted scheme | central HTTPS-only policy |
| Cloudflare denial detail | Access audience values returned | generic denial only |
| Policies | claimed route, no page | real route, navigation, alias and QA coverage |
| Unknown logos | invalid `_light.svg` request | local fallback icon |
| Data accuracy | representative values correct | unchanged and reverified |
| Regression suite | no direct-route/CLS/URL/audience guards | dedicated guards plus 90/90 browser pass |

## 16. REMAINING WORK

### Optional CSP migration

- Why it remains: a meaningful policy requires eliminating or hashing inline first-paint code and inventorying every required image/media/provider origin. A rushed permissive policy would add little protection; a strict one could break theme boot, PWA resources or integrations.
- Classification: optional defence-in-depth; low current risk and disproportionate to this release.
- Exact next action: introduce a report-only CSP in a preview, collect violations across all 17 routes, move inline boot code to versioned files or generate hashes, then enforce only after full offline/Cloudflare/browser QA.
- User input/access: none required unless a provider integration may be removed to simplify the policy.

### Further CSS/application extraction

- Why it remains: complete CSS and app JS are large but already deferred and inside explicit budgets; bulk reorganisation would not measurably improve the current initial experience and would carry broad regression risk.
- Classification: optional, best done opportunistically with future feature work.
- Exact next action: when modifying a dense route, extract one cohesive route module plus its contract/browser coverage and compare route-transfer budgets before/after.
- User input/access: none.

### Broader permanent second-engine CI

- Why it remains: Chromium supplies comprehensive automation and WebKit passed a focused smoke; installing/running every test in two engines on every change adds material CI time for a private project.
- Classification: optional cost/reliability trade-off.
- Exact next action: add a scheduled weekly WebKit smoke job for Home, Schedule, Game Centre and Policies if cross-engine regressions become recurring.
- User input/access: only a preference decision about extra CI time.

No remaining item is a known feasible Critical, High or Medium defect.

## 17. ISSUES NOT WORTH FIXING

- **Framework rewrite:** rejected. The current static/PWA/Functions architecture is edge-compatible, inexpensive, deployable and well covered. A rewrite would endanger working statistics and historical states without fixing an observed user problem.
- **Public accounts, social features or commercial analytics:** rejected as outside the personal-use product and privacy model.
- **Eagerly preload the full app or analytical data:** rejected. It would make information appear no sooner on core routes and would undo measured transfer savings.
- **Add more navigation layers:** rejected. The current four task groups plus contextual route rail already expose all features, and prior duplicate season controls have been removed.
- **Replace honest stale fallback with blank/error-only screens:** rejected. Preserving the last verified artifact with a visible freshness state is more useful and no less honest.
- **Index every alias URL:** rejected. Hash navigation describes one application; indexing aliases would create duplicate search destinations rather than improve a private tracker.
- **Micro-optimise already bounded model/chart work:** rejected until profiling shows a real interaction problem.

## 18. FINAL COMPLETION CHECKLIST

- [x] Repository, architecture, data generators, Functions and deployment workflows inspected.
- [x] Complete route/feature inventory created; all original live routes inspected and all 17 release-candidate pages exercised.
- [x] Main navigation, direct links, query preservation, search, selectors, tabs, disclosures and route states tested.
- [x] Schedule, standings, roster, current slate and London-date samples verified against official NHL data.
- [x] Exceptional games, offseason, empty, partial, cached, stale, failure and offline states tested.
- [x] Confirmed feasible High and Medium findings fixed at their shared causes.
- [x] Important repairs have regression coverage.
- [x] Desktop, tablet and mobile layouts checked; Chromium full suite and focused WebKit smoke passed.
- [x] Accessibility, performance, reliability, security/privacy, design consistency and maintainability reviewed.
- [x] Dependency audit, artifact health, performance budgets and Cloudflare production build passed.
- [x] Baseline production compared with repository; final GitHub Pages and Cloudflare artifacts deployed and verified from merge `96cffe6`.
- [x] No production data, DNS, billing, credential or unrelated Cloudflare setting changed.
- [x] No private credential or Access value included in code, report or fixtures.
- [x] No known feasible Critical, High or Medium finding remains.
