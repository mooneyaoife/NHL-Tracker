const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function gameRows(payload) {
  const rows = [];
  if (Array.isArray(payload?.games)) rows.push(...payload.games);
  if (Array.isArray(payload?.gameWeek)) {
    payload.gameWeek.forEach(day => Array.isArray(day?.games) && rows.push(...day.games));
  }
  if (payload && (payload.id || payload.gameState || payload.startTimeUTC)) rows.push(payload);
  return rows;
}

function startTime(game) {
  const value = Date.parse(game?.startTimeUTC || game?.gameDate && `${game.gameDate}T12:00:00Z` || "");
  return Number.isFinite(value) ? value : null;
}

function stateFor(game) {
  return String(game?.gameState || game?.state || "").toUpperCase();
}

function policyForGame(game, nowMs) {
  const state = stateFor(game);
  const startedAt = startTime(game);
  const intermission = Boolean(game?.clock?.inIntermission || game?.periodDescriptor?.inIntermission);

  if (["LIVE", "CRIT"].includes(state)) {
    return intermission
      ? { state: "intermission", freshSeconds: 30, staleSeconds: 30 * MINUTE }
      : { state: "live", freshSeconds: 15, staleSeconds: 15 * MINUTE };
  }
  if (["DELAYED", "POSTPONED", "SUSPENDED"].includes(state)) {
    return { state: "delayed", freshSeconds: 5 * MINUTE, staleSeconds: DAY };
  }
  if (["OFF", "FINAL"].includes(state)) {
    const estimatedFinalAt = startedAt == null ? nowMs : startedAt + 3 * HOUR * 1000;
    const age = Math.max(0, nowMs - estimatedFinalAt);
    if (age < 6 * HOUR * 1000) return { state: "recent-final", freshSeconds: 10 * MINUTE, staleSeconds: 7 * DAY };
    if (age < 48 * HOUR * 1000) return { state: "settled-final", freshSeconds: DAY, staleSeconds: 7 * DAY };
    return { state: "historical", freshSeconds: 7 * DAY, staleSeconds: 30 * DAY };
  }
  if (state === "PRE") return { state: "pregame", freshSeconds: MINUTE, staleSeconds: 6 * HOUR };
  if (startedAt != null) {
    const untilStart = startedAt - nowMs;
    if (untilStart <= 2 * HOUR * 1000) return { state: "scheduled-soon", freshSeconds: 2 * MINUTE, staleSeconds: 6 * HOUR };
    if (untilStart <= 24 * HOUR * 1000) return { state: "scheduled-today", freshSeconds: 15 * MINUTE, staleSeconds: DAY };
    return { state: "scheduled", freshSeconds: 6 * HOUR, staleSeconds: DAY };
  }
  return { state: "unknown", freshSeconds: 2 * MINUTE, staleSeconds: 30 * MINUTE };
}

export function cachePolicy(payload, nowMs = Date.now()) {
  const rows = gameRows(payload);
  if (!rows.length) return { state: "unknown", freshSeconds: 2 * MINUTE, staleSeconds: 30 * MINUTE };
  return rows.map(row => policyForGame(row, nowMs)).sort((left, right) =>
    left.freshSeconds - right.freshSeconds || left.staleSeconds - right.staleSeconds,
  )[0];
}
