(function initialiseDataContracts(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.NHLTrackerDataContracts = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function createDataContracts() {
  "use strict";

  const numberOrNull = value => {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };

  const share = (forValue, againstValue) => {
    const forNumber = numberOrNull(forValue);
    const againstNumber = numberOrNull(againstValue);
    const total = forNumber === null || againstNumber === null ? 0 : forNumber + againstNumber;
    return total > 0 ? forNumber / total : null;
  };

  /** Return a provider-unit share (0–1) from the retained component totals. */
  const expectedGoalsShare = row => {
    const derived = share(row?.xgf, row?.xga);
    if (derived !== null) return derived;
    const provider = numberOrNull(row?.xgPct);
    return provider !== null && Math.abs(provider) > 1 ? provider / 100 : provider;
  };

  /**
   * Normalise precision-sensitive provider records at the application boundary.
   * The original provider field remains available for audit in providerXgPct.
   */
  const normaliseExpectedGoalsRows = rows => (rows || []).map(row => {
    const derived = expectedGoalsShare(row);
    if (derived === null) return { ...row };
    return {
      ...row,
      providerXgPct: row.providerXgPct ?? row.xgPct ?? null,
      xgPct: derived,
      xgPctDefinition: row.xgf != null && row.xga != null
        ? "xgf/(xgf+xga); retained provider totals"
        : "provider percentage; component totals unavailable",
    };
  });

  const normaliseTrackerData = payload => {
    if (!payload || typeof payload !== "object") return payload;
    const moneypuck = payload.moneypuck || {};
    return {
      ...payload,
      moneypuck: {
        ...moneypuck,
        teams: normaliseExpectedGoalsRows(moneypuck.teams),
        teamGames: normaliseExpectedGoalsRows(moneypuck.teamGames),
      },
    };
  };

  const seasonEvidenceLabel = ({
    evidenceSeason,
    currentSeason,
    selectedSeason,
    rosterIsCurrent = false,
    loading = false,
  } = {}) => {
    if (loading) return "Loading completed-season player evidence…";
    const evidence = String(evidenceSeason || selectedSeason || "");
    const current = String(currentSeason || "");
    const selected = String(selectedSeason || evidence);
    const format = season => `${season.slice(0, 4)}–${season.slice(6)}`;
    if (!evidence) return "Season evidence unavailable";
    const completed = Boolean(current && evidence !== current) || Boolean(current && selected !== current);
    const scope = completed ? "completed-season statistics" : "current-season statistics";
    return `${rosterIsCurrent && completed ? "Current roster · " : ""}${format(evidence)} ${scope}`;
  };

  const firstValue = (...values) => values.find(value => {
    if (Array.isArray(value)) return value.length > 0;
    return value !== null && value !== undefined && value !== "";
  });

  /** Merge schedule, permanent archive, and official detail into one game view. */
  const normaliseGameView = ({ schedule = {}, archive = {}, landing = {} } = {}) => ({
    ...schedule,
    ...archive,
    id: firstValue(landing.id, archive.id, schedule.id),
    away: firstValue(landing.awayTeam?.abbrev, archive.away, schedule.away),
    home: firstValue(landing.homeTeam?.abbrev, archive.home, schedule.home),
    awayScore: firstValue(landing.awayTeam?.score, archive.awayScore, schedule.awayScore),
    homeScore: firstValue(landing.homeTeam?.score, archive.homeScore, schedule.homeScore),
    state: firstValue(landing.gameState, archive.state, schedule.state),
    startTimeUTC: firstValue(landing.startTimeUTC, archive.startTimeUTC, schedule.startTimeUTC),
    venue: firstValue(
      typeof landing.venue === "object" ? landing.venue.default || landing.venue.en : landing.venue,
      archive.venue,
      schedule.venue,
    ) || "",
    broadcasts: firstValue(landing.tvBroadcasts, archive.broadcasts, schedule.broadcasts) || [],
  });

  const validateTrackerData = payload => {
    const errors = [];
    if (!payload || typeof payload !== "object") return ["payload must be an object"];
    if (!payload.meta || typeof payload.meta !== "object") errors.push("meta must be an object");
    if (!/^\d{8}$/.test(String(payload.meta?.season || ""))) errors.push("meta.season must be an eight-digit NHL season");
    if (!Array.isArray(payload.standings)) errors.push("standings must be an array");
    if (!Array.isArray(payload.games)) errors.push("games must be an array");
    if (!payload.teams || typeof payload.teams !== "object" || Array.isArray(payload.teams)) errors.push("teams must be an object");
    if (payload.gameLibrary != null && !Array.isArray(payload.gameLibrary)) errors.push("gameLibrary must be an array when present");
    for (const row of payload.moneypuck?.teams || []) {
      if (!row.team) errors.push("moneypuck team row requires team");
      const derived = share(row.xgf, row.xga);
      if (derived !== null && Math.abs(expectedGoalsShare(row) - derived) > 0.0005) {
        errors.push(`${row.team || "unknown"} xgPct does not reproduce from xgf/xga`);
      }
    }
    return errors;
  };

  const validateCapabilityManifest = manifest => {
    const errors = [];
    if (manifest?.schema !== 1) errors.push("capability manifest schema must be 1");
    for (const name of ["core", "schedule", "players", "analytics"]) {
      const entry = manifest?.capabilities?.[name];
      if (!entry?.url) errors.push(`${name} capability requires a URL`);
      if (entry?.bytes != null && (!Number.isInteger(entry.bytes) || entry.bytes < 2)) errors.push(`${name} capability bytes must be positive`);
      if (entry?.sha256 != null && !/^[a-f0-9]{64}$/.test(entry.sha256)) errors.push(`${name} capability hash must be SHA-256`);
    }
    return errors;
  };

  const validateCapabilityData = (name, payload) => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [`${name} capability must be an object`];
    if (name === "core") return validateTrackerData({ ...payload, games: payload.games || [] });
    if (name === "schedule" && !Array.isArray(payload.games)) return ["schedule capability games must be an array"];
    if (name === "players" && (payload.rosters == null || typeof payload.rosters !== "object")) return ["players capability rosters must be an object"];
    if (name === "analytics" && (payload.gameCentre == null || typeof payload.gameCentre !== "object")) return ["analytics capability gameCentre must be an object"];
    return [];
  };

  return Object.freeze({
    expectedGoalsShare,
    normaliseExpectedGoalsRows,
    normaliseTrackerData,
    seasonEvidenceLabel,
    normaliseGameView,
    validateTrackerData,
    validateCapabilityManifest,
    validateCapabilityData,
  });
}));
