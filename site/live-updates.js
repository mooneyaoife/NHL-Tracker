(function initialiseLiveUpdates(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.NHLTrackerLiveUpdates = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function createLiveUpdates() {
  "use strict";

  const gameState = typeof globalThis !== "undefined" ? globalThis.NHLTrackerGameState : null;
  const normalise = game => gameState?.normalizeGameState?.(game) || {
    code: String(game?.state || "").toUpperCase(),
    label: String(game?.state || "Scheduled"),
    active: new Set(["LIVE", "CRIT"]).has(String(game?.state || "").toUpperCase()),
  };
  const LIVE_STATES = new Set(["LIVE", "CRIT", "INTERMISSION"]);

  const gameRows = payload => payload?.daily?.games || [];
  const snapshot = payload => new Map(gameRows(payload).map(game => [String(game.id), {
    id: String(game.id),
    away: game.away,
    home: game.home,
    awayScore: game.awayScore,
    homeScore: game.homeScore,
    state: normalise(game).code,
    stateLabel: normalise(game).label,
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
        message: `${game.away} ${game.awayScore ?? 0}, ${game.home} ${game.homeScore ?? 0}. ${game.stateLabel}.`,
      });
    }
    return changes;
  };

  const hasActiveGame = payload => gameRows(payload).some(game => normalise(game).active);

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
