const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const index = fs.readFileSync(path.join(root, "site/index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "site/app.js"), "utf8");
const worker = fs.readFileSync(path.join(root, "site/sw.js"), "utf8");
const critical = fs.readFileSync(path.join(root, "site/critical.css"), "utf8");
const designSystem = fs.readFileSync(path.join(root, "site/design-system.css"), "utf8");
const gameCentre = fs.readFileSync(path.join(root, "site/game-centre.js"), "utf8");
const buildMeta = JSON.parse(fs.readFileSync(path.join(root, "site/build-meta.json"), "utf8"));

const uiVersion = app.match(/^const UI_VERSION="([^"]+)";/)?.[1];
assert.ok(uiVersion, "the application exposes a UI version");
for (const asset of ["critical.css", "design-system.css", "shell.js"]) {
  assert.match(index, new RegExp(`${asset.replace(".", "\\.")}\\?v=${uiVersion.replaceAll(".", "\\.")}`), `${asset} uses the current UI cache key`);
  assert.match(worker, new RegExp(`${asset.replace(".", "\\.")}\\?v=${uiVersion.replaceAll(".", "\\.")}`), `${asset} is cached with the current UI version`);
}
assert.match(index, new RegExp(`freshness-status\\.js\\?v=${uiVersion.replaceAll(".", "\\.")}`), "freshness detail logic loads with the initial shell");
assert.match(worker, new RegExp(`freshness-status\\.js\\?v=${uiVersion.replaceAll(".", "\\.")}`), "freshness details remain available offline");
assert.match(index, new RegExp(`game-state\\.js\\?v=${uiVersion.replaceAll(".", "\\.")}`), "the shared game-window contract loads before the progressive shell");
assert.match(index, /id="freshness-control"[\s\S]*id="freshness-detail-copy"/, "the compact status exposes accessible recovery details");
assert.equal((index.match(/id="season-select"/g) || []).length, 1, "the header exposes one season control");
assert.doesNotMatch(index, /season-archive-toggle/, "the duplicate archive shortcut is removed");
assert.match(index, /data-group="season" data-default-page="schedule">Schedule</, "the primary route is named for its destination, not a second season control");
const foundations = designSystem.slice(designSystem.indexOf("/* 7.20"), designSystem.indexOf("/* 7.21"));
const localControls = designSystem.slice(designSystem.indexOf("/* 7.22"), designSystem.indexOf("/* 7.23"));
for (const token of ["--page-title-size", "--section-title-size", "--card-title-size", "--type-body", "--type-control", "--type-caption", "--control-height", "--control-radius"]) {
  assert.match(foundations, new RegExp(token), `${token} is owned by the canonical visual foundation`);
}
assert.doesNotMatch(localControls, /--page-title-size|--section-title-size|--card-title-size/, "route controls do not redefine the global type hierarchy");
assert.match(foundations, /\.page button:not\(\.pill\)[\s\S]*font-family:var\(--font-sans\)!important/, "interactive copy uses the interface typeface");
assert.match(foundations, /\.page button:not\(\.pill\)[\s\S]*min-height:var\(--control-height\)!important/, "non-icon page actions preserve the canonical touch target");
assert.match(foundations, /\.page \.reset-view-button,\.context-link[\s\S]*min-height:var\(--control-height\)!important/, "secondary actions preserve the canonical touch target");
assert.doesNotMatch(index, /home-masthead-copy h1\{[^}]*Georgia/, "the inline first paint uses the canonical interface typeface");
const criticalConsolidation = critical.slice(critical.indexOf("/* 7.20"));
assert.doesNotMatch(criticalConsolidation, /Inter|Georgia|Times New Roman/, "critical rendering does not flash a different typeface");
assert.match(criticalConsolidation, /font-weight:730;line-height:1;letter-spacing:-\.045em/, "critical title metrics match the canonical hierarchy");
assert.doesNotMatch(index, /tonight-slate-rail/, "Tonight does not repeat every game in a second navigation rail");
assert.match(index, /class="schedule-command"[\s\S]*?<h2>Schedule<\/h2>/, "the schedule page has an unambiguous title");
const progressiveShell=fs.readFileSync(path.join(root,"site/shell.js"),"utf8");
const installShellAssets=JSON.parse(worker.match(/const SHELL=(\[[^;]+\]);/)?.[1] || "[]");
const runtimeAssets=["statistics.js", "data-contracts.js", "data-loader.js", "router.js", "route-loader.js", "route-app.js", "preferences.js", "live-updates.js", "observability.js", "cloudflare-live.js", "app.js"];
for (const asset of runtimeAssets) assert.match(progressiveShell,new RegExp(asset.replace(".","\\.")),`${asset} is loaded by the progressive shell`);
for (const asset of ["game-state.js", "data-contracts.js", "data-loader.js", "route-loader.js", "route-app.js", "cloudflare-live.js"]) {
  assert.match(worker, new RegExp(`${asset.replace(".", "\\.")}\\?v=${uiVersion.replaceAll(".", "\\.")}`), `${asset} supports the dependable offline routes`);
}
for (const asset of ["statistics.js", "router.js", "preferences.js", "live-updates.js", "observability.js", "app.js"]) {
  assert.ok(!installShellAssets.some(value=>value.split("?")[0]===`./${asset}`),`${asset} is cached only after explicit use`);
}
assert.match(app, /NHLTrackerPreferences\.create/, "stored preferences are owned by the extracted module");
assert.match(progressiveShell,/QUICK_PAGES=new Set\(\["tonight","games","schedule"\]\)/,"Tonight, Game Centre and Season use the lightweight route runtime");
assert.match(progressiveShell,/fetch\("data\/seasons\/index\.json"/, "the progressive shell primes the season picker before the full app loads");
assert.match(progressiveShell,/NHLTrackerPendingAction=id/,
  "shell-only controls preserve the user's first action while the full app loads");
assert.match(app,/pendingAction==="theme-button"[\s\S]{0,180}pendingAction==="global-search-button"/,
  "the complete app replays deferred theme and search actions");
assert.match(app,/active!==document\.body&&active!==document\.documentElement\?active:el\("global-search-button"\)/,
  "search restores focus reliably when hydration replaces the original active element");
assert.match(index,/id="route-status" class="route-status" role="alert" hidden/,
  "recoverable route failures have a visible status surface");
const quickRoutes=fs.readFileSync(path.join(root,"site/route-app.js"),"utf8");
assert.match(quickRoutes,/game-centre\.js\?v=\$\{VERSION\}/, "Game Centre owns a separately loaded route module");
assert.match(quickRoutes,/await ensureGameCentreModule\(\)/, "direct Game Centre routes wait for their module before rendering");
assert.match(gameCentre,/createDetailController/, "detailed Game Centre request state is owned by the route module");
assert.match(gameCentre,/createDetailView/, "Game Centre loading, empty and fallback presentation is owned by the route module");
assert.match(gameCentre,/status: "superseded"/, "late game-detail responses cannot replace a newer selection");
assert.match(app,/GAME_CENTRE_MODULE_LOADING=null;throw error/, "failed Game Centre module requests remain retryable");
assert.match(quickRoutes,/gameCentreLoading=null;throw error/, "the lightweight Game Centre can retry a failed module request");
assert.ok(!installShellAssets.some(value=>value.split("?")[0]==="./game-centre.js"), "Game Centre code is cached only after the route is opened");
assert.match(quickRoutes,/gameWindow=selected/, "the lightweight Game Centre uses a bounded game window");
assert.match(quickRoutes,/describeSlateWindow/, "the lightweight Tonight route uses the shared UK-time game-window contract");
assert.match(app,/describeSlateWindow\(\{games,slateDate:daily\.currentDate/, "the complete Tonight route uses the same game-window contract");
assert.match(index,/id="tonight-notice"[^>]*role="status"[^>]*aria-live="polite"/, "Tonight announces exceptional and non-current slate states");
assert.match(index,/id="game-refresh-status"[^>]*role="status"/, "Game Centre exposes refresh success and failure without removing stored data");
assert.match(app,/Refresh failed\. The stored game view remains available\./, "manual refresh failures explain that retained data is still usable");
assert.match(app,/const liveState=m\.cloudflareLive\?window\.NHLTrackerFreshnessStatus\?\.describe/, "Status reuses the same live, partial, cached and stale labels as the header");
assert.match(quickRoutes,/section\.hidden=section\.id!=="schedule-calendar-chapter"/, "the lightweight Schedule shows one chapter at a time");
assert.match(quickRoutes,/data-quick-calendar-game/, "the lightweight Schedule renders interactive games inside grouped calendar days");
assert.match(quickRoutes,/NHLTrackerQuickRoutes=\{open,ready\}/,
  "the progressive shell can wait for lightweight data initialization");
assert.match(progressiveShell,/NHLTrackerQuickRoutes\?\.ready/,
  "direct lightweight routes do not race the capability loader");
assert.match(quickRoutes,/page==="games"\?\["core"\]/, "Game Centre summaries use only the compact core artifact");
assert.match(progressiveShell,/scriptRequests\.has\(name\)/, "promotion to the complete app reuses quick-route script requests");
assert.match(progressiveShell,/connection\?\.saveData/, "detailed-view prefetch respects reduced-data preferences");
assert.match(gameCentre,/addEventListener\("pointerenter", primeDetailed/, "Game Centre warms detailed scripts only after deliberate intent");
assert.doesNotMatch(quickRoutes,/class="calendar-item"/, "the lightweight Schedule does not fall back to one tile per game");
assert.doesNotMatch(index,/data-workspace-target="workspace-saved">01/, "Workspace sections are not presented as duplicate numbered files");
assert.doesNotMatch(index,/workspace-command-state/, "Workspace does not repeat its selected chapter in the page header");
assert.match(index,/class="workspace-command"><div><h2>Workspace<\/h2><p id="workspace-command-counts"/, "Workspace keeps useful personal counts beside its heading");
assert.doesNotMatch(index,/data-section-pane="player-profile" open><summary>(?:Player charts and recent form|Team rankings and complete game log)/, "secondary player evidence is collapsed on first view");
assert.doesNotMatch(index,/class="expandable analytics-section" open|class="expandable" open><summary>Standings by division/, "deep league evidence is collapsed on first view");
assert.doesNotMatch(index,/id="analysis-journey"/, "League does not duplicate its tab navigation with a second guided route");
assert.doesNotMatch(app,/ANALYSIS_JOURNEY|setupAnalysisJourney/, "the removed League journey leaves no dormant runtime behind");
assert.equal((index.match(/class="expandable comparison-evidence"/g) || []).length, 2, "team and player comparisons reveal full evidence on demand");
assert.match(index,/id="power-state-note"[\s\S]*id="power-visuals"[\s\S]*id="power-ranking-details"/, "Power Index separates availability, current visuals and historical rankings");
assert.match(app,/setPowerAvailability\(false,[\s\S]{0,500}power-chart[\s\S]{0,200}power-scatter/, "Power Index suppresses unavailable charts during the offseason");
assert.match(app,/pane\.dataset\.sectionPrimary==="true"/, "switching Explore tabs opens only their primary disclosure");
assert.match(app,/\["team-nst-chart","team-monthly","player-nst-chart","nst-goalie-leaders"\][\s\S]{0,180}disclosure\.open=false/, "optional Explore evidence starts collapsed");
assert.match(designSystem,/#teams>\.section-subnav[\s\S]{0,180}overflow-x:auto/, "the five Team tabs scroll instead of clipping on phones");
assert.match(designSystem,/details\.section-pane\.active>summary\{display:flex!important\}/, "collapsed specialist evidence keeps a visible disclosure control");
assert.match(designSystem,/#power-tracked\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important\}/, "followed-team Power cards use a compact phone grid");
assert.match(app,/\["Schedule","Calendar and UK game times"/, "global search names the destination Schedule consistently");
assert.match(app,/\["News","Moves, insiders and rosters","news"\]/, "global search names the News destination consistently");
assert.match(progressiveShell,/NHLTrackerLoadCompleteApp/,"deeper destinations can promote safely to the complete application");
assert.doesNotMatch(progressiveShell,/addEventListener\("(?:wheel|touchmove)"/,"passive Home exploration never downloads the full application");
assert.doesNotMatch(progressiveShell,/\["ArrowDown","PageDown","End"," "\]/,"ordinary page navigation keys never download the full application");
assert.match(progressiveShell,/needs a connection the first time it is opened/,"an uncached deep route explains its offline limitation");
assert.match(progressiveShell,/fullLoading=null;throw error/,"a failed full-route request can be retried");
assert.match(progressiveShell,/quickLoading=null;throw error/,"a failed lightweight-route request can be retried");
for(const group of ["night","season","people","explore"])assert.ok(fs.existsSync(path.join(root,`site/routes/${group}.js`)),`${group} has a native lazy route module`);
const capabilityManifest=JSON.parse(fs.readFileSync(path.join(root,"site/data/tracker-manifest.json"),"utf8"));
assert.deepEqual(Object.keys(capabilityManifest.capabilities).sort(),["analytics","core","players","schedule"]);
const legacyBytes=fs.statSync(path.join(root,"site/data/tracker.json")).size;
const seasonBytes=capabilityManifest.capabilities.core.bytes+capabilityManifest.capabilities.schedule.bytes;
assert.ok(seasonBytes<=legacyBytes*.6,`Season capability data is at least 40% smaller (${seasonBytes} <= ${Math.floor(legacyBytes*.6)})`);
assert.match(worker, new RegExp(`const CACHE="nhl-tracker-${uiVersion.replaceAll(".", "\\.")}"`), "the service-worker cache matches the UI version");
const shell = worker.match(/const SHELL=(\[[^;]+\]);/)?.[1] || "";
assert.doesNotMatch(shell, /plotly|seasons\/\d+\.json|tracker-models|puckpedia-mail/i, "offline installation excludes charts, archives and auxiliary data");
assert.doesNotMatch(shell,/data\/tracker\.json/,"new offline installs use capability artifacts instead of the monolith");
assert.doesNotMatch(worker,/LEGACY_CACHE/,"a verified install does not retain a duplicate full cache generation");
assert.match(worker,/caches\.delete/,"older cache generations are retired after a complete capability install");
assert.match(worker,/names\.filter\(name=>name!==CACHE\)/,"every previous cache generation is retired after verification");
assert.ok(app.indexOf('initialisePage("dashboard")') < app.indexOf("hydrateLiveInBackground(archived)"), "static Home renders before live enhancement starts");
const initialisation = app.slice(app.indexOf("async function init"), app.indexOf("function renderFatalError"));
assert.doesNotMatch(initialisation, /await\s+window\.NHLCloudflareLive\.hydrate/, "live enhancement never blocks initial rendering");
assert.match(index, /styles\.css\?v=6\.0\.0" media="print"/, "non-critical styles do not block the first paint");
assert.doesNotMatch(index, /<script defer src="app\.js/, "the analytical application is not parsed before first paint");
assert.match(index, /property="og:image"/);
assert.match(index, /name="twitter:card" content="summary_large_image"/);
assert.equal(buildMeta.schema, 1);
for (const field of ["sourceCommit", "artifactGeneratedAt", "dataGeneratedAt", "dataHash"]) assert.ok(buildMeta[field], `build metadata includes ${field}`);

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

assert.equal((app.match(/function renderGuide\(\)/g) || []).length, 1, "the reference guide has one canonical renderer");
const latestNews = index.slice(index.indexOf('id="offseason"'), index.indexOf('id="cap-centre"'));
assert.doesNotMatch(latestNews, /PuckPedia Updates|Roster Pulse|Offseason Resources/, "Latest does not duplicate dedicated cap, roster or transaction tools");
const rosterNews = index.slice(index.indexOf('id="rosters"'), index.indexOf('</section>', index.indexOf('id="rosters"')));
assert.match(rosterNews, /Roster Pulse/, "roster monitoring lives with the complete roster view");
assert.doesNotMatch(index, /id="insider-posts"[^>]*\sopen(?:\s|>)/, "third-party insider timelines start collapsed");
assert.match(app, /id==="rumours"&&el\("insider-posts"\)\?\.open/, "insider widgets load only after explicit disclosure");
assert.match(app, /reset\.hidden=id!=="offseason"/, "News hides its Latest-only reset action on dedicated views");
assert.match(app, /visible=CAP_TIMELINE_EXPANDED\?filtered:filtered\.slice\(0,10\)/, "the cap timeline starts with a bounded recent set");
assert.match(index, /id="nst-refresh-centre" class="panel nst-refresh-centre status-disclosure"/, "manual refresh instructions use progressive disclosure");
assert.match(index, /id="status-coverage-panel" class="panel status-disclosure"/, "coverage evidence starts as a disclosure");
assert.match(app, /stale=active&&\(!ready\|\|age>=7\)/, "manual analytics reminders stay quiet outside the active season");
assert.match(app, /!active\?"No action needed"/, "offseason status does not falsely request a refresh");
assert.match(designSystem, /#news>\.news-subnav[\s\S]*overflow-x:auto!important/, "the five News destinations scroll instead of colliding on phones");

console.log("site contracts: all checks passed");
