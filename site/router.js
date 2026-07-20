(function initialiseRouter(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.NHLTrackerRouter = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function createRouter() {
  "use strict";

  const ROUTES = Object.freeze({
    dashboard: { slug: "", title: "NHL Tracker", description: "Tonight's NHL games, season context and transparent hockey analysis." },
    tonight: { slug: "tonight", title: "Tonight's NHL Games", description: "NHL game times, live status, scores and followed-team context in UK time." },
    games: { slug: "games", title: "NHL Game Centre", description: "Game summaries, official status, matchup evidence and archived NHL game records." },
    widget: { slug: "widget", title: "NHL Tracker Widget", description: "Compact NHL tracker snapshots for quick mobile viewing." },
    availability: { slug: "lineups", title: "NHL Lineups", description: "Official rosters, recent usage and clearly labelled lineup evidence." },
    schedule: { slug: "season", title: "NHL Season and Schedule", description: "NHL calendar, workload, travel and transparent schedule-difficulty analysis." },
    trends: { slug: "trends", title: "NHL Form and Trends", description: "Recent NHL form compared with season-long results and process." },
    playoffs: { slug: "playoffs", title: "NHL Playoff Path", description: "Playoff outlook, stage probabilities and remaining-schedule context." },
    teams: { slug: "teams", title: "NHL Team Profiles", description: "Team results, underlying play, special teams and source-aware analysis." },
    players: { slug: "players", title: "NHL Player Profiles", description: "Player production, usage and position-aware evidence across current and completed seasons." },
    compare: { slug: "compare", title: "NHL Comparison Centre", description: "Compare NHL teams and players with consistent season and source context." },
    league: { slug: "league", title: "NHL League Analysis", description: "League standings, team rankings and player leaders with transparent definitions." },
    power: { slug: "power", title: "NHL Tracker Power Index", description: "A transparent descriptive NHL index built from results, process and goal difference." },
    news: { slug: "movement", title: "NHL Movement", description: "Sourced NHL headlines, roster movement and clearly separated rumour context." },
    watchlist: { slug: "workspace", title: "NHL Tracker Workspace", description: "Saved NHL teams, players, views and display preferences stored on this device." },
    guide: { slug: "reference", title: "NHL Statistics Reference", description: "Definitions, formulas, scope and sources for every major NHL Tracker statistic." },
    status: { slug: "status", title: "NHL Tracker Data Status", description: "Data provenance, update times, source coverage and model activation state." },
    policies: { slug: "policies", title: "Editorial, Privacy and Rights Policies", description: "NHL Tracker authorship, automation, corrections, privacy, security and rights governance." },
    "not-found": { slug: "not-found", title: "Page Not Found", description: "Recover from an invalid or outdated NHL Tracker link." },
  });

  const cleanPath = pathname => String(pathname || "/").replace(/\/+$/, "");
  const routeStateFromPath = (pathname, basePath = "/") => {
    const path = cleanPath(pathname);
    const base = cleanPath(basePath);
    const relative = path.startsWith(base) ? path.slice(base.length).replace(/^\//, "") : path.replace(/^\//, "");
    if (!relative) return { route: "dashboard", params: {} };
    const segments = relative.split("/").filter(Boolean).map(decodeURIComponent);
    const route = Object.keys(ROUTES).find(candidate => ROUTES[candidate].slug === segments[0]) || null;
    const params = {};
    if (route === "teams" && segments[1]) params.team = segments[1].toUpperCase();
    if (route === "players") {
      if (segments[1]) params.team = segments[1].toUpperCase();
      if (segments[2]) params.player = segments[2];
    }
    if (route === "games" && segments[1]) params.game = segments[1];
    if (route === "guide" && segments[1]) params.stat = segments.slice(1).join(" ");
    return { route, params };
  };

  const routeFromPath = (pathname, basePath = "/") => routeStateFromPath(pathname, basePath).route;

  const routePath = (route, basePath = "/") => {
    const metadata = ROUTES[route] || ROUTES["not-found"];
    const base = `${cleanPath(basePath) || ""}/`.replace(/\/+/g, "/");
    return metadata.slug ? `${base}${metadata.slug}/` : base;
  };

  return Object.freeze({ ROUTES, routeFromPath, routeStateFromPath, routePath });
}));
