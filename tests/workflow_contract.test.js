const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, ".github/workflows", name), "utf8");
const live = read("live-games.yml");
const scheduled = read("update-and-deploy.yml");
const deploy = read("validate-and-deploy.yml");
const mail = read("mail-feed.yml");
const production = read("production-verify.yml");
const browser = read("browser-tests.yml");
const performance = read("performance.yml");

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
assert.match(scheduled, /git add site\/data site\/build-meta\.json data\/cache/,
  "scheduled generation commits the metadata that describes its refreshed artifact");
assert.match(live, /check_artifact_health\.py/,
  "live deployments use the same artifact health gate");
for (const workflow of [deploy, live]) {
  assert.match(workflow, /name: github-pages-\$\{\{ github\.run_attempt \}\}/,
    "each deployment attempt uploads a uniquely named Pages artifact");
  assert.match(workflow, /artifact_name: github-pages-\$\{\{ github\.run_attempt \}\}/,
    "the Pages deployment selects the artifact from the current attempt");
}
for (const workflow of [deploy, scheduled, live]) {
  assert.match(workflow, /MAX_FRESH_ARTIFACT_AGE_HOURS/);
  assert.match(workflow, /MAX_FALLBACK_ARTIFACT_AGE_HOURS/);
}
assert.match(deploy, /GITHUB_STEP_SUMMARY/);
assert.match(live, /GITHUB_STEP_SUMMARY/);
assert.match(deploy, /CLOUDFLARE_ACCESS_CLIENT_ID/);
assert.match(deploy, /verify_production\.py/,
  "post-deployment verification checks deployed artifacts and authenticated health");
assert.match(deploy, /--attempts 10[\s\S]{0,80}--retry-delay 12/,
  "deployment verification tolerates normal multi-origin propagation lag");
assert.match(production, /cron: "17 6 \* \* \*"/,
  "production verification runs once daily");
assert.match(production, /verify_production\.py/);
assert.match(production, /CLOUDFLARE_ACCESS_CLIENT_ID/);
assert.doesNotMatch(production, /update_tracker|api-web\.nhle|moneypuck/,
  "production verification never refreshes upstream provider data");
assert.match(mail, /site\/data\/puckpedia-mail\.json/);
assert.doesNotMatch(mail, /update_tracker|deploy-pages|wrangler/,
  "mail-feed validation is isolated from full NHL refreshes and deployments");

for (const workflow of [live, scheduled, deploy, mail, production, browser, performance]) {
  const uses = [...workflow.matchAll(/uses:\s+([^\s#]+)/g)].map(match => match[1]);
  assert.ok(uses.length, "workflow contains actions");
  for (const action of uses) assert.match(action, /@[0-9a-f]{40}$/, `${action} is pinned to an immutable commit`);
}

console.log("workflow contracts: all checks passed");
