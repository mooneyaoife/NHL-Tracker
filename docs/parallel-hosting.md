# Parallel Cloudflare hosting

GitHub Pages remains the primary deployment. Cloudflare Pages is an optional, private second target and runs only when `CLOUDFLARE_DEPLOY_ENABLED` is exactly `true`.

## Cloudflare resources

- Direct Upload project: `nhl-tracker-private`
- Production URL: `https://nhl-tracker-private.pages.dev/`
- Production branch: `main`
- Zero Trust team: `nhl-tracker-private-pages`

Cloudflare Access must protect the production and preview hostnames before the first upload.

## Phase 1 live-data API

The Cloudflare artifact adds a same-origin, Access-authenticated API without changing the GitHub Pages build. The Cloudflare-only build marker activates `site/cloudflare-live.js`; GitHub Pages omits that marker and continues using the generated static data.

| Route | Upstream request |
|---|---|
| `GET /api/health` | No upstream request |
| `GET /api/nhl/score/now` | NHL score feed for the current day |
| `GET /api/nhl/schedule/now` | NHL schedule feed for the current day |
| `GET /api/nhl/game/{10-digit-id}/landing` | One fixed NHL game landing endpoint |
| `GET /api/nhl/game/{10-digit-id}/boxscore` | One fixed NHL game boxscore endpoint |

`HEAD` is also accepted. All other methods, paths, query strings, game-ID formats and outbound hosts are rejected. Requests use a four-second timeout, one bounded retry for transient failures, state-aware cache lifetimes, and stale KV data when a previously successful response remains inside its stale window.

Live games cache for 15 seconds, intermissions for 30 seconds, delayed games for five minutes, recently final games for ten minutes, settled final games for 24 hours, historical data for seven days, and pregame data from one minute to six hours depending on proximity to puck drop. Responses expose cache state and age without exposing upstream internals.

Cloudflare Access remains the outer identity gate. The API additionally verifies the signed Access JWT against the configured team issuer and environment-specific application audience. It fails closed if authentication configuration or the KV binding is missing. Cross-origin browser requests are rejected and responses include restrictive framing, content-type, referrer and permissions headers.

## Pages configuration

`wrangler.toml` defines the non-secret team name, Access mode, output directory, compatibility date and the `NHL_CACHE` KV binding. The Pages dashboard must provide the environment-specific `POLICY_AUD` value under **Settings → Variables and Secrets**:

- Production: audience tag from the production Access application.
- Preview: audience tag from the wildcard preview Access application.

Do not commit either audience value. `.dev.vars.example` contains variable names only. The production and preview KV namespaces are separate, so preview traffic cannot overwrite production cache entries.

## Local development

Build the Cloudflare artifact, copy `.dev.vars.example` to `.dev.vars`, set `AUTH_MODE=disabled`, and run Pages development through Wrangler:

```bash
python scripts/build_cloudflare.py --production-url https://nhl-tracker-private.pages.dev/
npx wrangler pages dev .cloudflare-build --compatibility-date=2026-07-18
```

Authentication can be disabled only for `localhost`, `127.0.0.1`, or `::1`. A non-local request still fails closed even if `AUTH_MODE=disabled` is present.

Run the Cloudflare-specific checks with:

```bash
node tests/cloudflare_live_overlay.test.js
node --test tests/cloudflare_api.test.mjs
python scripts/verify_cloudflare_build.py --production-url https://nhl-tracker-private.pages.dev/
```

## GitHub Actions configuration

| Type | Name | Value |
|---|---|---|
| Secret | `CLOUDFLARE_API_TOKEN` | Minimal token with Pages write access |
| Variable | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account identifier |
| Variable | `CLOUDFLARE_PAGES_PROJECT` | `nhl-tracker-private` |
| Variable | `CLOUDFLARE_PAGES_URL` | `https://nhl-tracker-private.pages.dev/` |
| Variable | `CLOUDFLARE_DEPLOY_ENABLED` | Set to `true` last |

The scheduled workflows deploy GitHub Pages first. Cloudflare build and deployment steps are appended afterward and are skipped unless the enable variable is present.

Access-protected branch previews can be created without affecting production by changing the deploy command's `--branch` value from `main` to a temporary branch name. Preview deployments use the separate preview KV namespace and preview Access audience. An automatic pull-request preview workflow can be added later if the GitHub publishing credential is granted the `workflow` scope; it is not required for production or rollback.

## Rollback

Set `CLOUDFLARE_DEPLOY_ENABLED` to `false` or remove it to stop future Cloudflare uploads. GitHub Pages continues unchanged. For an application rollback, select the previous successful production deployment in Cloudflare Pages and promote it. If the API itself must be isolated, remove the Cloudflare-only build marker by restoring the prior deployment; the static tracker remains usable through GitHub Pages throughout.

## Future custom domain

Attach the domain to the existing Pages project, protect it with Access, update `CLOUDFLARE_PAGES_URL`, and verify the generated artifact before making it the preferred address. Keep the `pages.dev` hostname protected so it cannot bypass Access.
