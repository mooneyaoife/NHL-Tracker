(function initialiseGameState(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.NHLTrackerGameState = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function createGameState() {
  "use strict";

  const LIVE = new Set(["LIVE", "CRIT"]);
  const FINAL = new Set(["OFF", "FINAL"]);
  const DELAYED = new Set(["DELAYED", "DELAY"]);
  const POSTPONED = new Set(["POSTPONED", "PPD"]);
  const SUSPENDED = new Set(["SUSPENDED", "SUSP"]);
  const CANCELLED = new Set(["CANCELLED", "CANCELED", "CNCL"]);

  const upper = value => String(value || "").trim().toUpperCase();
  const first = (...values) => values.find(value => value !== null && value !== undefined && value !== "");

  function dateInTimeZone(value, timeZone = "Europe/London") {
    if (!value) return "";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return values.year && values.month && values.day ? `${values.year}-${values.month}-${values.day}` : "";
  }

  function periodTypeFor(game) {
    return upper(first(
      game?.outcome,
      game?.lastPeriodType,
      game?.gameOutcome?.lastPeriodType,
      game?.periodDescriptor?.periodType,
    ));
  }

  function rawStateFor(game) {
    return upper(first(game?.state, game?.gameState));
  }

  function scheduleStateFor(game) {
    return upper(first(game?.scheduleState, game?.gameScheduleState));
  }

  function normalizeGameState(game = {}) {
    const raw = rawStateFor(game);
    const schedule = scheduleStateFor(game);
    const periodType = periodTypeFor(game);
    const startTimeUTC = String(game.startTimeUTC || "");
    const slateDate = String(first(game.slateDate, game.gameDate, game.date, startTimeUTC.slice(0, 10)) || "");
    const londonDate = String(game.londonDate || dateInTimeZone(startTimeUTC) || slateDate);
    const intermission = Boolean(game.clock?.inIntermission || game.periodDescriptor?.inIntermission);
    let code = "scheduled";
    let label = "Scheduled";

    if (CANCELLED.has(raw) || CANCELLED.has(schedule)) {
      code = "cancelled";
      label = "Cancelled";
    } else if (POSTPONED.has(raw) || POSTPONED.has(schedule)) {
      code = "postponed";
      label = "Postponed";
    } else if (SUSPENDED.has(raw) || SUSPENDED.has(schedule)) {
      code = "suspended";
      label = "Suspended";
    } else if (DELAYED.has(raw) || DELAYED.has(schedule)) {
      code = "delayed";
      label = "Delayed";
    } else if (FINAL.has(raw)) {
      code = periodType === "SO" ? "final-so" : periodType === "OT" ? "final-ot" : "final";
      label = periodType === "SO" ? "Final/SO" : periodType === "OT" ? "Final/OT" : "Final";
    } else if (LIVE.has(raw)) {
      code = intermission ? "intermission" : "live";
      label = intermission ? "Intermission" : "Live";
    } else if (raw === "PRE") {
      code = "pregame";
      label = "Pregame";
    }

    const final = code.startsWith("final");
    const live = code === "live" || code === "intermission";
    const exception = ["delayed", "postponed", "suspended", "cancelled"].includes(code);
    return Object.freeze({
      code,
      label,
      raw,
      scheduleState: schedule,
      periodType,
      startTimeUTC,
      slateDate,
      londonDate,
      live,
      final,
      completed: final || code === "cancelled",
      active: live,
      exception,
      scheduled: code === "scheduled" || code === "pregame",
      scoreVisible: live || final,
    });
  }

  function normalizeSlateState({ games = [], now = new Date() } = {}) {
    if (games.length) return Object.freeze({ code: "games", label: "NHL slate available", games: games.length });
    const date = now instanceof Date ? now : new Date(now);
    const month = Number.isFinite(date.getTime()) ? date.getUTCMonth() + 1 : 0;
    const offseason = month === 7 || month === 8;
    return Object.freeze({
      code: offseason ? "offseason" : "empty-slate",
      label: offseason ? "Offseason" : "No games scheduled",
      games: 0,
    });
  }

  return Object.freeze({
    normalizeGameState,
    normalizeSlateState,
    dateInTimeZone,
    LIVE_STATES: LIVE,
    FINAL_STATES: FINAL,
  });
}));
