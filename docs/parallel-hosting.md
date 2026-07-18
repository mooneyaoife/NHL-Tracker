# Parallel Cloudflare hosting

GitHub Pages remains the primary deployment. Cloudflare Pages is an optional, private second target and runs only when `CLOUDFLARE_DEPLOY_ENABLED` is exactly `true`.

## Cloudflare resources

- Direct Upload project: `nhl-tracker-private`
- Production URL: `https://nhl-tracker-private.pages.dev/`
- Production branch: `main`
- Zero Trust team: `nhl-tracker-private-pages`

Cloudflare Access must protect the production and preview hostnames before the first upload.

## GitHub Actions configuration

| Type | Name | Value |
|---|---|---|
| Secret | `CLOUDFLARE_API_TOKEN` | Minimal token with Pages write access |
| Variable | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account identifier |
| Variable | `CLOUDFLARE_PAGES_PROJECT` | `nhl-tracker-private` |
| Variable | `CLOUDFLARE_PAGES_URL` | `https://nhl-tracker-private.pages.dev/` |
| Variable | `CLOUDFLARE_DEPLOY_ENABLED` | Set to `true` last |

The scheduled workflows deploy GitHub Pages first. Cloudflare build and deployment steps are appended afterward and are skipped unless the enable variable is present.

## Rollback

Set `CLOUDFLARE_DEPLOY_ENABLED` to `false` or remove it. GitHub Pages continues unchanged. Cloudflare can also restore a previous Pages deployment from its deployment history.

## Future custom domain

Attach the domain to the existing Pages project, protect it with Access, update `CLOUDFLARE_PAGES_URL`, and verify the generated artifact before making it the preferred address. Keep the `pages.dev` hostname protected so it cannot bypass Access.
