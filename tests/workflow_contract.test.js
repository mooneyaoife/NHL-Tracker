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
assert.match(deploy, /Validate committed artifact without refreshing upstream data/,
  "code/artifact deployment does not perform a full NHL refresh");
assert.match(deploy, /CLOUDFLARE_ACCESS_CLIENT_ID/);
assert.match(deploy, /\/data\/tracker\.json \/api\/health/,
  "authenticated post-deployment smoke coverage includes data and health");
assert.match(mail, /site\/data\/puckpedia-mail\.json/);
assert.doesNotMatch(mail, /update_tracker|deploy-pages|wrangler/,
  "mail-feed validation is isolated from full NHL refreshes and deployments");

console.log("workflow contracts: all checks passed");
