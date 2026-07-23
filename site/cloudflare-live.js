(() => {
  "use strict";

  const marker = document.querySelector('meta[name="nhl-cloudflare-api"]');
  const base = marker?.content?.replace(/\/$/, "") || "";
  const enabled = base.startsWith("/") && !base.startsWith("//");
  const lastGood = { score: null, schedule: null };

  const officialValue = value => {
    if (value == null) return "";
    if (typeof value === "object") return value.default || value.en || Object.values(value)[0] || "";
    return String(value);
  };

  async function apiGet(path) {
    if (!enabled || !path.startsWith("/")) throw new Error("Cloudflare live data is not enabled");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    try {
      const response = await fetch(`${base}${path}`, {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      if (!response.ok || !(response.headers.get("content-type") || "").includes("application/json")) {
        throw new Error("Cloudflare live data is unavailable");
      }
      const payload = await response.json();
      if (!payload?.ok || !payload.data) throw new Error("Cloudflare live data is invalid");
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }

  function gameRow(game, fallbackDate = "") {
    const startTimeUTC = game.startTimeUTC || "";
    const slateDate = game.gameDate || fallbackDate || startTimeUTC.slice(0, 10);
    const baseRow = {
      id: game.id,
      date: slateDate,
      slateDate,
      startTimeUTC,
      state: game.gameState || game.state || "",
      scheduleState: game.gameScheduleState || game.scheduleState || "",
      type: game.gameType || game.type || 0,
      venue: officialValue(game.venue),
      home: officialValue(game.homeTeam?.abbrev || game.home).toUpperCase(),
      away: officialValue(game.awayTeam?.abbrev || game.away).toUpperCase(),
      homeScore: game.homeTeam?.score ?? game.homeScore,
      awayScore: game.awayTeam?.score ?? game.awayScore,
      period: game.periodDescriptor?.number ?? game.period,
      periodDescriptor: game.periodDescriptor,
      gameOutcome: game.gameOutcome,
      clock: game.clock,
      broadcasts: (game.tvBroadcasts || game.broadcasts || []).map(row => row.network || row).filter(Boolean),
    };
    const normalized = window.NHLTrackerGameState?.normalizeGameState(baseRow);
    return normalized ? { ...baseRow, londonDate: normalized.londonDate, status: normalized } : baseRow;
  }

  function normaliseDaily(score = {}, schedule = {}) {
    const scheduledGames = [];
    (schedule?.gameWeek || []).forEach(day => (day.games || []).forEach(game => {
      scheduledGames.push({ ...game, gameDate: game.gameDate || day.date });
    }));
    const scoreGames = Array.isArray(score?.games) ? score.games : [];
    const scoreById = new Map(scoreGames.map(game => [String(game.id), game]));
    const seen = new Set(scheduledGames.map(game => String(game.id)));
    const sourceGames = scheduledGames.map(game => {
      const live = scoreById.get(String(game.id));
      return live ? {
        ...game,
        ...live,
        awayTeam: { ...game.awayTeam, ...live.awayTeam },
        homeTeam: { ...game.homeTeam, ...live.homeTeam },
      } : game;
    });
    scoreGames.forEach(game => {
      if (!seen.has(String(game.id))) sourceGames.push(game);
    });
    const games = sourceGames.map(game => gameRow(game));
    const dates = [...new Set(games.map(game => game.slateDate).filter(Boolean))].sort();
    const requestedDate = score?.currentDate || null;
    const selectedDate = dates.includes(requestedDate)
      ? requestedDate
      : dates.find(date => requestedDate && date >= requestedDate) || dates.at(-1) || requestedDate;
    return {
      currentDate: selectedDate,
      slateDate: selectedDate,
      requestedDate,
      fallback: Boolean(selectedDate && requestedDate && selectedDate !== requestedDate),
      games: games.filter(game => game.slateDate === selectedDate),
    };
  }

  function overlayMeta(components, partial) {
    const responses = Object.values(components).filter(Boolean);
    const metas = responses.map(response => response.meta || {});
    const fetchedAt = metas.map(meta => meta.fetchedAt).filter(Boolean).sort().at(-1) || new Date().toISOString();
    const stale = metas.some(meta => meta.stale);
    const cached = !stale && metas.length > 0 && metas.every(meta => meta.cache === "hit");
    const status = stale ? "stale" : partial ? (cached ? "partial-cached" : "partial-live") : cached ? "cached" : "live";
    return {
      status,
      fetchedAt,
      stale,
      partial,
      components: {
        score: components.score ? (components.score.meta?.stale ? "stale" : components.score.meta?.cache === "hit" ? "cached" : "live") : "unavailable",
        schedule: components.schedule ? (components.schedule.meta?.stale ? "stale" : components.schedule.meta?.cache === "hit" ? "cached" : "live") : "unavailable",
      },
      states: [...new Set(metas.map(meta => meta.state).filter(Boolean))],
      cache: metas.map(meta => meta.cache).filter(Boolean),
    };
  }

  async function hydrate(data) {
    if (!enabled) return data;
    const [scoreResult, scheduleResult] = await Promise.allSettled([
      apiGet("/nhl/score/now"),
      apiGet("/nhl/schedule/now"),
    ]);
    if (scoreResult.status === "fulfilled") lastGood.score = scoreResult.value;
    if (scheduleResult.status === "fulfilled") lastGood.schedule = scheduleResult.value;
    const components = {
      score: scoreResult.status === "fulfilled" ? scoreResult.value : lastGood.score,
      schedule: scheduleResult.status === "fulfilled" ? scheduleResult.value : lastGood.schedule,
    };
    if (!components.score && !components.schedule) {
      return {
        ...data,
        meta: {
          ...data.meta,
          cloudflareLive: {
            status: "static-fallback",
            fetchedAt: data.meta?.liveGameUpdateAt || data.meta?.updatedAt || null,
            stale: true,
            partial: false,
            components: { score: "unavailable", schedule: "unavailable" },
          },
        },
      };
    }
    const partial = !components.score || !components.schedule || scoreResult.status === "rejected" || scheduleResult.status === "rejected";
    return {
      ...data,
      daily: normaliseDaily(components.score?.data || {}, components.schedule?.data || {}),
      meta: { ...data.meta, cloudflareLive: overlayMeta(components, partial) },
    };
  }

  async function game(gameId, fallback = null) {
    const id = String(gameId || "");
    if (!/^\d{10}$/.test(id)) throw new Error("Invalid NHL game identifier");
    if (!enabled) {
      if (fallback) return fallback;
      throw new Error("Cloudflare live data is not enabled");
    }
    const [landing, boxscore] = await Promise.allSettled([
      apiGet(`/nhl/game/${id}/landing`),
      apiGet(`/nhl/game/${id}/boxscore`),
    ]);
    const detail = { ...(fallback || {}) };
    if (landing.status === "fulfilled") detail.landing = landing.value.data;
    if (boxscore.status === "fulfilled") detail.box = boxscore.value.data;
    if (!detail.landing && !detail.box && !detail.pbp) throw new Error("Detailed NHL data is unavailable");
    return detail;
  }

  window.NHLCloudflareLive = Object.freeze({ enabled, hydrate, game, normaliseDaily });
})();
