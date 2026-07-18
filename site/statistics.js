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

  return {
    mean,
    weightedAverage,
    pointsPercentage,
    perGame,
    sharePercentage,
    ratePer60,
    opportunityPercentage,
    filterPlayersByTeam,
    sum,
  };
});
