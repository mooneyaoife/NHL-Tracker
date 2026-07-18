const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const index = fs.readFileSync(path.join(root, "site/index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "site/app.js"), "utf8");
const worker = fs.readFileSync(path.join(root, "site/sw.js"), "utf8");

const uiVersion = app.match(/^const UI_VERSION="([^"]+)";/)?.[1];
assert.ok(uiVersion, "the application exposes a UI version");
for (const asset of ["design-system.css", "statistics.js", "app.js"]) {
  assert.match(index, new RegExp(`${asset.replace(".", "\\.")}\\?v=${uiVersion.replaceAll(".", "\\.")}`), `${asset} uses the current UI cache key`);
  assert.match(worker, new RegExp(`${asset.replace(".", "\\.")}\\?v=${uiVersion.replaceAll(".", "\\.")}`), `${asset} is cached with the current UI version`);
}
assert.match(worker, new RegExp(`const CACHE="nhl-tracker-${uiVersion.replaceAll(".", "\\.")}"`), "the service-worker cache matches the UI version");

const ids = [...index.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
const duplicates = ids.filter((id, position) => ids.indexOf(id) !== position);
assert.deepEqual(duplicates, [], "HTML IDs are unique across the application");
const idSet = new Set(ids);

const pages = [...index.matchAll(/<section id="([^"]+)" class="page(?:\s|\")/g)].map(match => match[1]);
assert.equal(pages.length, 16, "all application pages are present");
for (const page of pages) {
  const start = index.indexOf(`<section id="${page}" class="page`);
  const next = pages.map(id => index.indexOf(`<section id="${id}" class="page`, start + 1)).filter(position => position > start).sort((a, b) => a - b)[0] ?? index.indexOf("</main>", start);
  const markup = index.slice(start, next);
  assert.match(markup, /<h[12](?:\s|>)/, `${page} has a visible page heading`);
}

const navigation = app.match(/const NAVIGATION=\{([\s\S]*?)\n\};/)?.[1] || "";
const navigationTargets = new Set([...navigation.matchAll(/"([a-z][a-z-]+)"/g)].map(match => match[1]).filter(value => pages.includes(value)));
for (const target of navigationTargets) assert.ok(idSet.has(target), `navigation target ${target} exists`);
for (const match of index.matchAll(/data-(?:page|default-page)="([^"]+)"/g)) assert.ok(idSet.has(match[1]), `direct navigation target ${match[1]} exists`);

assert.ok(idSet.has("availability-lines-source") && idSet.has("availability-pairings-source"), "Lineups exposes its evidence season consistently");
assert.match(app, /if\(page==="availability"\)void ensureAvailabilityEvidence/, "direct Lineups routes load completed-season evidence");
assert.doesNotMatch(app, /Tracked team-games|Detailed tracked players/, "Status does not describe league-wide data as a followed-team subset");

for (const side of ["a", "b"]) {
  assert.ok(idSet.has(`player-compare-team-${side}`), `player comparison side ${side} has a team selector`);
  assert.ok(idSet.has(`player-compare-${side}`), `player comparison side ${side} has a player selector`);
  assert.ok(idSet.has(`player-comparison-options-${side}`), `player comparison side ${side} has a team-scoped search list`);
  assert.ok(index.indexOf(`id="player-compare-team-${side}"`) < index.indexOf(`id="player-compare-${side}"`), `team ${side} is chosen before player ${side}`);
}
assert.ok(idSet.has("player-comparison-season"), "player comparison exposes a season selector");
assert.ok(index.indexOf('id="player-comparison-season"') < index.indexOf('id="player-compare-team-a"'), "season is chosen before team and player");
assert.ok(idSet.has("player-comparison-context") && idSet.has("player-comparison-announcer"), "comparison evidence and selection changes have accessible live regions");
assert.match(app, /comparisonPlayersForTeam=team=>filterComparisonPlayersByTeam/, "player comparison options are filtered by the selected team");
assert.match(app, /"comparisonSeason","aTeam","bTeam","aScope","bScope"/, "season, team and scope choices survive direct links and browser history");
assert.match(app, /seasonComparisonRecords\(playerComparisonData\(\)\)/, "comparison participants come from the selected season evidence");
assert.doesNotMatch(app, /eligibleComparisonPlayers/, "selection is not silently restricted to chart-eligible skaters");

console.log("site contracts: all checks passed");
