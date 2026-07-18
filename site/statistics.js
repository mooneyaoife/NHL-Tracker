(function initialiseTrackerStatistics(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.NHLTrackerStatistics = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function trackerStatisticsFactory() {
  const number = value => {
    if (value === null || value === "" || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const sum = (rows, value) => (rows || []).reduce((total, row) => {
    const parsed = number(typeof value === "function" ? value(row) : row?.[value]);
    return total + (parsed ?? 0);
  }, 0);

  const mean = values => {
    const valid = (values || []).map(number).filter(value => value !== null);
    return valid.length ? valid.reduce((total, value) => total + value, 0) / valid.length : null;
  };

  const weightedAverage = (rows, value, weight) => {
    const valid = (rows || []).map(row => ({
      value: number(typeof value === "function" ? value(row) : row?.[value]),
      weight: number(typeof weight === "function" ? weight(row) : row?.[weight]),
    })).filter(row => row.value !== null && row.weight !== null && row.weight > 0);
    const totalWeight = valid.reduce((total, row) => total + row.weight, 0);
    return totalWeight ? valid.reduce((total, row) => total + row.value * row.weight, 0) / totalWeight : null;
  };

  const ratio = (rows, numerator, denominator, scale = 1) => {
    const denominatorTotal = sum(rows, denominator);
    return denominatorTotal > 0 ? sum(rows, numerator) / denominatorTotal * scale : null;
  };

  const pointsPercentage = rows => {
    const eligible = (rows || []).filter(row => number(row?.gp) > 0);
    return ratio(eligible, "points", row => number(row?.gp) * 2, 100);
  };

  const perGame = (rows, value, games = "gp") => {
    const eligible = (rows || []).filter(row => number(
      typeof games === "function" ? games(row) : row?.[games]
    ) > 0);
    return ratio(eligible, value, games);
  };

  const sharePercentage = (rows, forValue, againstValue) => {
    const forTotal = sum(rows, forValue);
    const againstTotal = sum(rows, againstValue);
    return forTotal + againstTotal > 0 ? forTotal / (forTotal + againstTotal) * 100 : null;
  };

  const ratePer60 = (rows, value, minutes = "minutes") => ratio(rows, value, minutes, 60);

  const opportunityPercentage = (rows, success, opportunities) => ratio(rows, success, opportunities, 100);

  const filterPlayersByTeam = (rows, team) => (rows || []).filter(row => {
    const affiliations = Array.isArray(row?.teams) ? row.teams : row?.team ? [row.team] : [];
    return affiliations.includes(team);
  });

  const normalPersonName = value => String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();

  const GOALIE_NAME_ALIASES = {
    samuelmontembeault: "sammontembeault",
    leevimerilinen: "leevimerilainen",
  };

  const PROVIDER_NAME_ALIASES = {
    alexpetrovic: "alexanderpetrovic",
    fredericgaudreau: "freddygaudreau",
    jackstivany: "johnstivany",
    joshdunne: "joshuadunne",
    maxshabanov: "maksimshabanov",
    pojoseph: "pierreolivierjoseph",
    sampoulin: "samuelpoulin",
    sammyblais: "samuelblais",
    yegorchinakhov: "egorchinakhov",
  };

  const comparisonName = (value, goalie = false) => {
    const normalized = normalPersonName(value);
    return PROVIDER_NAME_ALIASES[normalized] || (goalie ? GOALIE_NAME_ALIASES[normalized] : null) || normalized;
  };

  const comparisonPosition = value => value === "G" ? "G" : value === "D" ? "D" : "F";

  const comparisonRecordCache = new WeakMap();

  const seasonComparisonRecords = data => {
    if (!data || typeof data !== "object") return [];
    if (comparisonRecordCache.has(data)) return comparisonRecordCache.get(data);
    const officialSkaters = data?.officialPlayers?.skaters || [];
    const officialGoalies = data?.officialPlayers?.goalies || [];
    const sourceRows = [
      ...(data?.naturalStatTrick?.players || []).map(row => ({ ...row, comparisonType: "skater" })),
      ...(data?.naturalStatTrick?.goalies || []).map(row => ({ ...row, position: "G", comparisonType: "goalie" })),
    ];
    const officialRows = [
      ...officialSkaters.map(row => ({ ...row, comparisonType: "skater" })),
      ...officialGoalies.map(row => ({ ...row, position: "G", comparisonType: "goalie" })),
    ].filter(row => Number(row?.totals?.gp || 0) > 0);
    const rosterRows = Object.entries(data?.rosters || {}).flatMap(([team, rows]) => (rows || []).map(row => ({
      ...row,
      teams: [team],
      comparisonType: row.position === "G" ? "goalie" : "skater",
    })));
    const identityRows = [...officialRows, ...rosterRows];
    const matchedOfficial = new Set();
    const records = sourceRows.map(source => {
      const goalie = source.comparisonType === "goalie";
      const sourceId = String(source.id || "");
      const official = identityRows.find(row => sourceId && String(row.id || "") === sourceId)
        || identityRows.find(row => row.comparisonType === source.comparisonType
          && comparisonName(row.name, goalie) === comparisonName(source.name, goalie)
          && (!source.position || !row.position || comparisonPosition(source.position) === comparisonPosition(row.position)));
      if (official) matchedOfficial.add(official);
      const teams = [...new Set([...(source.teams || []), ...(official?.teams || [])].filter(Boolean))].sort();
      const id = String(sourceId || official?.id || `${source.comparisonType}:${comparisonName(source.name, goalie)}:${source.position || ""}`);
      return {
        ...official,
        ...source,
        id,
        teams,
        position: goalie ? "G" : source.position || official?.position || "Skater",
        comparisonType: source.comparisonType,
        sourceAvailable: true,
        officialTotals: official?.totals || null,
        statisticalScope: "allTeams",
        season: data?.meta?.season || "",
      };
    });
    officialRows.filter(row => !matchedOfficial.has(row)).forEach(official => {
      const goalie = official.comparisonType === "goalie";
      records.push({
        ...official,
        id: String(official.id || `${official.comparisonType}:${comparisonName(official.name, goalie)}:${official.position || ""}`),
        teams: [...new Set(official.teams || [])].sort(),
        position: goalie ? "G" : official.position || "Skater",
        gp: Number(official.totals?.gp || 0),
        toi: null,
        sourceAvailable: false,
        officialTotals: official.totals || null,
        statisticalScope: "allTeams",
        season: data?.meta?.season || "",
      });
    });
    const result = [...new Map(records.map(record => [`${record.comparisonType}:${record.id}`, record])).values()]
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")) || String(a.id).localeCompare(String(b.id)));
    comparisonRecordCache.set(data, result);
    return result;
  };

  const comparisonPeerGroup = record => record?.comparisonType === "goalie" || record?.position === "G"
    ? "Goalies"
    : record?.position === "D" ? "Defencemen" : "Forwards";

  const comparisonEligibility = record => {
    const goalie = record?.comparisonType === "goalie" || record?.position === "G";
    const minimum = goalie ? 600 : 200;
    const unit = "five-on-five minutes";
    if (!record) return { eligible: false, minimum, unit, reason: "No statistics available for this season" };
    if (Number(record.gp || record.officialTotals?.gp || 0) <= 0) return { eligible: false, minimum, unit, reason: "No games played" };
    if (!record.sourceAvailable) return { eligible: false, minimum, unit, reason: "Comparison source fields are unavailable" };
    if (record.toi === "" || record.toi === "-" || record.toi == null || !Number.isFinite(Number(record.toi))) {
      return { eligible: false, minimum, unit, reason: "Ice-time evidence is unavailable" };
    }
    if (Number(record.toi) < minimum) return { eligible: false, minimum, unit, reason: "Not eligible for this comparison" };
    return { eligible: true, minimum, unit, reason: "Eligible" };
  };

  const comparisonPercentile = (rows, valueFn, target, higher = true) => {
    const value = Number(valueFn(target));
    const values = (rows || []).map(valueFn).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (!Number.isFinite(value) || values.length < 2) return null;
    const below = values.filter(item => item < value).length;
    const equal = values.filter(item => item === value).length;
    const percentile = (below + Math.max(0, equal - 1) / 2) / (values.length - 1) * 100;
    return Math.round(higher ? percentile : 100 - percentile);
  };

  return {
    mean,
    weightedAverage,
    pointsPercentage,
    perGame,
    sharePercentage,
    ratePer60,
    opportunityPercentage,
    filterPlayersByTeam,
    seasonComparisonRecords,
    comparisonPeerGroup,
    comparisonEligibility,
    comparisonPercentile,
    sum,
  };
});
