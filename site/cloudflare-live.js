(() => {
  "use strict";

  const marker = document.querySelector('meta[name="nhl-cloudflare-api"]');
  const base = marker?.content?.replace(/\/$/, "") || "";
  const enabled = base.startsWith("/") && !base.startsWith("//");

  const officialValue = value => {
    if (value == null) return "";
    if (typeof value === "object") return value.default || value.en || Object.values(value)[0] || "";
    return String(value);
  };

  async function apiGet(path) {
    if (!enabled || !path.startsWith("/")) throw new Error("Cloudflare live data is not enabled");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9500);
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

  function normaliseDaily(score, schedule) {
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
    const games = sourceGames.map(game => {
      const startTimeUTC = game.startTimeUTC || "";
      return {
        id: game.id,
        date: game.gameDate || startTimeUTC.slice(0, 10),
        startTimeUTC,
        state: game.gameState || "",
        type: game.gameType || 0,
        venue: officialValue(game.venue),
        home: officialValue(game.homeTeam?.abbrev).toUpperCase(),
        away: officialValue(game.awayTeam?.abbrev).toUpperCase(),
        homeScore: game.homeTeam?.score,
        awayScore: game.awayTeam?.score,
        period: game.periodDescriptor?.number,
        broadcasts: (game.tvBroadcasts || []).map(row => row.network).filter(Boolean),
      };
    });
    const dates = [...new Set(games.map(game => game.date).filter(Boolean))].sort();
    const requestedDate = score?.currentDate || null;
    const selectedDate = dates.includes(requestedDate)
      ? requestedDate
      : dates.find(date => requestedDate && date >= requestedDate) || dates.at(-1) || requestedDate;
    return {
      currentDate: selectedDate,
      requestedDate,
      fallback: Boolean(selectedDate && requestedDate && selectedDate !== requestedDate),
      games: games.filter(game => game.date === selectedDate),
    };
  }

  function overlayMeta(responses) {
    const metas = responses.map(response => response.meta || {});
    const fetchedAt = metas.map(meta => meta.fetchedAt).filter(Boolean).sort().at(-1) || new Date().toISOString();
    const stale = metas.some(meta => meta.stale);
    return {
      status: stale ? "stale" : "live",
      fetchedAt,
      stale,
      states: [...new Set(metas.map(meta => meta.state).filter(Boolean))],
      cache: metas.map(meta => meta.cache).filter(Boolean),
    };
  }

  async function hydrate(data) {
    if (!enabled) return data;
    try {
      const [score, schedule] = await Promise.all([
        apiGet("/nhl/score/now"),
        apiGet("/nhl/schedule/now"),
      ]);
      return {
        ...data,
        daily: normaliseDaily(score.data, schedule.data),
        meta: { ...data.meta, cloudflareLive: overlayMeta([score, schedule]) },
      };
    } catch {
      return {
        ...data,
        meta: {
          ...data.meta,
          cloudflareLive: { status: "static-fallback", fetchedAt: data.meta?.liveGameUpdateAt || data.meta?.updatedAt || null, stale: true },
        },
      };
    }
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
