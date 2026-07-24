const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, ".github/workflows", name), "utf8");
const live = read("live-games.yml");
const scheduled = read("update-and-deploy.yml");
const deploy = read("validate-and-deploy.yml");
const mail = read("mail-feed.yml");

assert.match(live, /cron: "7 0-10,16-23/, "live checks run hourly rather than every 15 minutes");
assert.match(live, /if: steps\.live\.outputs\.active == 'true'[\s\S]{0,100}uses: actions\/deploy-pages/,
  "GitHub Pages deployment only occurs for an active followed-team game");
assert.match(live, /if: steps\.live\.outputs\.active == 'true' && vars\.CLOUDFLARE_DEPLOY_ENABLED/,
  "Cloudflare work also requires an active followed-team game");
assert.doesNotMatch(scheduled, /^\s+push:/m, "scheduled data generation is not triggered by unrelated pushes");
assert.doesNotMatch(scheduled, /deploy-pages|wrangler/, "scheduled generation does not deploy directly");
assert.match(deploy, /workflow_run:[\s\S]{0,160}workflows: \["Generate scheduled NHL data"\]/,
  "successful scheduled generation hands off to the separate deployment workflow");
assert.match(deploy, /github\.event\.workflow_run\.conclusion == 'success'/,
  "a failed scheduled generation cannot trigger deployment");
assert.match(deploy, /github\.event\.repository\.default_branch/,
  "scheduled handoff deploys the generator's newly committed default-branch artifact");
assert.match(deploy, /Validate committed artifact without refreshing upstream data/,
  "code/artifact deployment does not perform a full NHL refresh");
assert.match(deploy, /check_artifact_health\.py/,
  "committed artifacts pass the freshness and completeness gate before deployment");
assert.match(scheduled, /check_artifact_health\.py/,
  "scheduled generation records artifact health before committing data");
assert.match(live, /check_artifact_health\.py/,
  "live deployments use the same artifact health gate");
for (const workflow of [deploy, scheduled, live]) {
  assert.match(workflow, /MAX_FRESH_ARTIFACT_AGE_HOURS/);
  assert.match(workflow, /MAX_FALLBACK_ARTIFACT_AGE_HOURS/);
}
assert.match(deploy, /GITHUB_STEP_SUMMARY/);
assert.match(live, /GITHUB_STEP_SUMMARY/);
assert.match(deploy, /CLOUDFLARE_ACCESS_CLIENT_ID/);
assert.match(deploy, /\/data\/tracker\.json \/api\/health/,
  "authenticated post-deployment smoke coverage includes data and health");
assert.match(mail, /site\/data\/puckpedia-mail\.json/);
assert.doesNotMatch(mail, /update_tracker|deploy-pages|wrangler/,
  "mail-feed validation is isolated from full NHL refreshes and deployments");

console.log("workflow contracts: all checks passed");
