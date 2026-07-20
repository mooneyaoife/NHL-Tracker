(function initialiseLiveUpdates(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.NHLTrackerLiveUpdates = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function createLiveUpdates() {
  "use strict";

  const LIVE_STATES = new Set(["LIVE", "CRIT"]);
  const FINAL_STATES = new Set(["OFF", "FINAL"]);
  const stateLabel = state => FINAL_STATES.has(state) ? "Final" : LIVE_STATES.has(state) ? "Live" : state || "Scheduled";

  const gameRows = payload => payload?.daily?.games || [];
  const snapshot = payload => new Map(gameRows(payload).map(game => [String(game.id), {
    id: String(game.id),
    away: game.away,
    home: game.home,
    awayScore: game.awayScore,
    homeScore: game.homeScore,
    state: String(game.state || "").toUpperCase(),
  }]));

  const meaningfulChanges = (beforePayload, afterPayload) => {
    const before = snapshot(beforePayload);
    const changes = [];
    for (const game of snapshot(afterPayload).values()) {
      const prior = before.get(game.id);
      if (!prior) continue;
      const scoreChanged = game.awayScore !== prior.awayScore || game.homeScore !== prior.homeScore;
      const stateChanged = game.state !== prior.state;
      if (!scoreChanged && !stateChanged) continue;
      changes.push({
        ...game,
        key: `${game.id}|${game.state}|${game.awayScore ?? "-"}|${game.homeScore ?? "-"}`,
        message: `${game.away} ${game.awayScore ?? 0}, ${game.home} ${game.homeScore ?? 0}. ${stateLabel(game.state)}.`,
      });
    }
    return changes;
  };

  const hasActiveGame = payload => gameRows(payload).some(game => LIVE_STATES.has(String(game.state || "").toUpperCase()));

  const pollingEligible = ({payloadSeason, currentSeason, visibilityState, route, payload}) => (
    String(payloadSeason || "") === String(currentSeason || "") &&
    visibilityState !== "hidden" &&
    new Set(["dashboard", "tonight", "games"]).has(route) &&
    hasActiveGame(payload)
  );

  const pollingDelay = failureCount => Math.min(300000, 60000 * (2 ** Math.min(Math.max(0, Number(failureCount) || 0), 3)));
  const changeKey = changes => (changes || []).map(change => change.key).join("|");

  const reconcile = (current, fresh) => ({
    ...current,
    daily: fresh.daily,
    gameCentre: fresh.gameCentre,
    games: fresh.games,
    preseasonGames: fresh.preseasonGames,
    meta: fresh.meta,
  });

  return Object.freeze({
    LIVE_STATES,
    meaningfulChanges,
    hasActiveGame,
    pollingEligible,
    pollingDelay,
    changeKey,
    reconcile,
    snapshot,
  });
}));
