(function initialiseTrackerStatistics(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.NHLTrackerStatistics = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function trackerStatisticsFactory() {
  const number = value => {
    if (value === null || value === undefined || typeof value === "boolean") return null;
    if (typeof value === "string" && value.trim() === "") return null;
    if (typeof value !== "number" && typeof value !== "string") return null;
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

  const playerCollectionRows = collection => {
    if (Array.isArray(collection)) return collection;
    if (!collection || typeof collection !== "object") return [];
    return Object.values(collection).flatMap(rows => Array.isArray(rows) ? rows : []);
  };

  const comparisonRowType = row => row?.comparisonType === "goalie" || row?.position === "G"
    ? "goalie"
    : "skater";

  const uniqueIdentityRows = rows => {
    const seen = new Set();
    return (rows || []).filter(row => {
      const goalie = comparisonRowType(row) === "goalie";
      const id = String(row?.id || "").trim();
      const key = id
        ? `${comparisonRowType(row)}:id:${id}`
        : `${comparisonRowType(row)}:name:${comparisonName(row?.name, goalie)}:${comparisonPosition(row?.position)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const comparisonIdentityMatch = (rows, source) => {
    if (!source) return null;
    const type = comparisonRowType(source);
    const goalie = type === "goalie";
    const id = String(source.id || "").trim();
    const exact = id && (rows || []).find(row => comparisonRowType(row) === type && String(row?.id || "").trim() === id);
    if (exact) return exact;
    const name = comparisonName(source.name, goalie);
    if (!name) return null;
    const nameMatch = row => comparisonRowType(row) === type
      && comparisonName(row?.name, goalie) === name
      && (!source.position || !row?.position || comparisonPosition(source.position) === comparisonPosition(row.position));
    return (rows || []).find(row => nameMatch(row) && (!id || !String(row?.id || "").trim())) || null;
  };

  const seasonComparisonRecords = data => {
    if (!data || typeof data !== "object") return [];
    if (comparisonRecordCache.has(data)) return comparisonRecordCache.get(data);
    const officialSkaters = (data?.officialPlayers?.skaters || []).map(row => ({ ...row, comparisonType: "skater" }));
    const officialGoalies = (data?.officialPlayers?.goalies || []).map(row => ({ ...row, position: "G", comparisonType: "goalie" }));
    const detailedRows = uniqueIdentityRows(playerCollectionRows(data?.players).map(row => ({
      ...row,
      comparisonType: row?.position === "G" ? "goalie" : "skater",
    })));
    const moneyPuckRows = [
      ...(data?.moneypuck?.skaters || []).map(row => ({ ...row, comparisonType: "skater" })),
      ...(data?.moneypuck?.goalies || []).map(row => ({ ...row, position: "G", comparisonType: "goalie" })),
    ];
    const sourceRows = [
      ...(data?.naturalStatTrick?.players || []).map(row => ({ ...row, comparisonType: "skater" })),
      ...(data?.naturalStatTrick?.goalies || []).map(row => ({ ...row, position: "G", comparisonType: "goalie" })),
    ];
    const officialRows = [...officialSkaters, ...officialGoalies].filter(row => number(row?.totals?.gp) > 0);
    const rosterRows = Object.entries(data?.rosters || {}).flatMap(([team, rows]) => (rows || []).map(row => ({
      ...row,
      teams: [team],
      comparisonType: row.position === "G" ? "goalie" : "skater",
    })));
    const participantRows = uniqueIdentityRows([...officialRows, ...detailedRows].filter(row => number(row?.totals?.gp) > 0));
    const createRecord = (naturalStatTrick, identity = naturalStatTrick) => {
      const type = comparisonRowType(identity);
      const goalie = type === "goalie";
      const official = comparisonIdentityMatch(officialRows, identity);
      const detailed = comparisonIdentityMatch(detailedRows, identity);
      const roster = comparisonIdentityMatch(rosterRows, identity);
      const moneyPuck = comparisonIdentityMatch(moneyPuckRows, official || detailed || roster || identity)
        || comparisonIdentityMatch(moneyPuckRows, identity);
      const sourceId = String(naturalStatTrick?.id || "").trim();
      const id = String(sourceId || official?.id || detailed?.id || roster?.id
        || `${type}:${comparisonName(identity?.name, goalie)}:${identity?.position || ""}`);
      const seasonTeams = [
        ...(naturalStatTrick?.teams || []),
        ...(official?.teams || []),
        ...(detailed?.teams || []),
        ...(moneyPuck?.teams || []),
        moneyPuck?.team,
      ].filter(Boolean);
      const teams = [...new Set(seasonTeams.length ? seasonTeams : (roster?.teams || []))].sort();
      const gameLog = Array.isArray(detailed?.games)
        ? detailed.games
        : Array.isArray(official?.games) ? official.games : [];
      const totals = detailed?.totals || official?.totals || null;
      const sourceFlags = {
        naturalStatTrick: !!naturalStatTrick,
        moneyPuck: !!moneyPuck,
        official: !!official,
        gameLog: gameLog.length > 0,
      };
      return {
        ...official,
        ...detailed,
        ...naturalStatTrick,
        id,
        teams,
        position: goalie ? "G" : naturalStatTrick?.position || detailed?.position || official?.position || "Skater",
        comparisonType: type,
        totals,
        games: gameLog,
        gameLog,
        headshot: detailed?.headshot || roster?.headshot || official?.headshot || null,
        naturalStatTrick: naturalStatTrick || null,
        moneyPuck: moneyPuck || null,
        sourceFlags,
        sourceAvailable: sourceFlags.naturalStatTrick,
        naturalStatTrickAvailable: sourceFlags.naturalStatTrick,
        moneyPuckAvailable: sourceFlags.moneyPuck,
        officialAvailable: sourceFlags.official,
        gameLogAvailable: sourceFlags.gameLog,
        officialTotals: official?.totals || null,
        statisticalScope: "allTeams",
        allTeams: true,
        isTraded: teams.length > 1,
        season: data?.meta?.season || "",
      };
    };
    const records = sourceRows.map(source => createRecord(source));
    participantRows.forEach(identity => {
      const id = String(identity.id || "").trim();
      const goalie = comparisonRowType(identity) === "goalie";
      const matched = records.some(record => comparisonRowType(record) === comparisonRowType(identity)
        && (id ? String(record.id || "") === id : comparisonName(record.name, goalie) === comparisonName(identity.name, goalie)));
      if (!matched) records.push(createRecord(null, identity));
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
    const minimum = goalie ? 500 : 200;
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
    const value = number(valueFn(target));
    const values = (rows || []).map(valueFn).map(number).filter(item => item !== null);
    if (value === null || !values.length) return null;
    const ranked = values.filter(item => higher ? item <= value : item >= value).length;
    return Math.round(ranked / values.length * 100);
  };

  const comparisonRate = (row, value, minutes = "toi", scale = 60) => {
    const numerator = number(typeof value === "function" ? value(row) : row?.[value]);
    const denominator = number(typeof minutes === "function" ? minutes(row) : row?.[minutes]);
    const rateScale = number(scale);
    return numerator !== null && denominator !== null && denominator > 0 && rateScale !== null
      ? numerator / denominator * rateScale
      : null;
  };

  const skaterPenaltyRate = row => {
    const drawn = number(row?.penaltiesDrawn);
    const taken = number(row?.totalPenalties);
    return drawn !== null && taken !== null ? comparisonRate(row, () => drawn - taken) : null;
  };

  const skaterPrimaryRate = row => {
    const goals = comparisonRate(row, "goals");
    const firstAssists = comparisonRate(row, "firstAssists");
    return goals !== null && firstAssists !== null ? goals + firstAssists : null;
  };

  const skaterImpactMeasures = [
    ["Primary", skaterPrimaryRate],
    ["Expected goals", row => comparisonRate(row, "ixg")],
    ["High-danger", row => comparisonRate(row, "ihdcf")],
    ["Rush", row => comparisonRate(row, "rushAttempts")],
    ["Takeaways", row => comparisonRate(row, "takeaways")],
    ["Penalty", skaterPenaltyRate],
  ];

  const skaterPeerRows = (rows, target) => {
    if (!target || comparisonRowType(target) === "goalie") return [];
    const defence = comparisonPosition(target.position) === "D";
    return (rows || []).filter(row => comparisonRowType(row) === "skater"
      && (comparisonPosition(row.position) === "D") === defence
      && number(row.toi) !== null
      && number(row.toi) >= 200
      && row.sourceAvailable !== false);
  };

  const skaterImpactPercentiles = (target, rows) => {
    const peers = skaterPeerRows(rows, target);
    if (number(target?.toi) === null || number(target?.toi) < 200) {
      return skaterImpactMeasures.map(() => null);
    }
    return skaterImpactMeasures.map(([, valueFn]) => comparisonPercentile(peers, valueFn, target));
  };

  const skaterImpactScore = (target, rows) => {
    const values = skaterImpactPercentiles(target, rows);
    return values.length && values.every(value => number(value) !== null)
      ? Math.round(values.reduce((total, value) => total + value, 0) / values.length)
      : null;
  };

  const skaterImpactComponents = (target, rows) => {
    const values = skaterImpactPercentiles(target, rows);
    const average = indexes => {
      const componentValues = indexes.map(index => number(values[index]));
      return componentValues.every(value => value !== null)
        ? Math.round(componentValues.reduce((total, value) => total + value, 0) / componentValues.length)
        : null;
    };
    return [
      { label: "Primary offence", value: average([0]), detail: "Goals and first assists per 60" },
      { label: "Chance generation", value: average([1, 2, 3]), detail: "Expected goals, high-danger and rush chances" },
      { label: "Puck recovery", value: average([4]), detail: "Takeaways per 60" },
      { label: "Discipline", value: average([5]), detail: "Penalties drawn minus taken per 60" },
    ];
  };

  const skaterNeighbourFeatures = row => [
    skaterPrimaryRate(row),
    comparisonRate(row, "ixg"),
    comparisonRate(row, "ihdcf"),
    comparisonRate(row, "shots"),
    comparisonRate(row, "takeaways"),
    skaterPenaltyRate(row),
  ];

  const skaterStatisticalNeighbours = (target, rows, limit = 6) => {
    if (!target || number(target.toi) === null || number(target.toi) < 200) return [];
    const targetId = String(target.id || "").trim();
    const featureRows = skaterPeerRows(rows, target).filter(row => {
      const rowId = String(row.id || "").trim();
      if (targetId ? rowId === targetId : row === target) return false;
      return skaterNeighbourFeatures(row).every(value => value !== null);
    });
    const targetFeatures = skaterNeighbourFeatures(target);
    if (targetFeatures.some(value => value === null) || !featureRows.length) return [];
    const population = [target, ...featureRows];
    const columns = targetFeatures.map((_, index) => population.map(row => skaterNeighbourFeatures(row)[index]));
    const means = columns.map(values => values.reduce((total, value) => total + value, 0) / values.length);
    const deviations = columns.map((values, index) => (
      Math.sqrt(values.reduce((total, value) => total + Math.pow(value - means[index], 2), 0) / Math.max(1, values.length - 1)) || 1
    ));
    const vector = row => skaterNeighbourFeatures(row).map((value, index) => (value - means[index]) / deviations[index]);
    const targetVector = vector(target);
    const distances = featureRows.map(row => ({
      row,
      distance: Math.sqrt(vector(row).reduce(
        (total, value, index) => total + Math.pow(value - targetVector[index], 2),
        0,
      )),
    })).sort((a, b) => a.distance - b.distance || String(a.row.id || "").localeCompare(String(b.row.id || "")));
    const maxDistance = Math.max(...distances.map(item => item.distance), 1);
    return distances.slice(0, Math.max(0, Math.floor(number(limit) ?? 6))).map(item => ({
      ...item,
      similarity: Math.max(0, 100 - item.distance / maxDistance * 55),
    }));
  };

  return {
    number,
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
    comparisonRate,
    skaterPeerRows,
    skaterImpactMeasures,
    skaterImpactPercentiles,
    skaterImpactScore,
    skaterImpactComponents,
    skaterStatisticalNeighbours,
    sum,
  };
});
