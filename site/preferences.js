(function initialisePreferences(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.NHLTrackerPreferences = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function createPreferencesModule() {
  "use strict";

  const KEYS = Object.freeze({
    home: "nhl-home-workspace-v1",
    lenses: "nhl-player-lenses-v1",
    views: "nhl-saved-analysis-views-v1",
    filters: "nhl-page-filters-v1",
    watchlist: "nhl-watchlist",
    teams: "nhl-tracked-teams",
    compact: "nhl-compact",
    theme: "nhl-theme",
  });

  const clone = value => JSON.parse(JSON.stringify(value));

  function create(storage) {
    const read = (key, fallback) => {
      try {
        const value = JSON.parse(storage.getItem(key) || "null");
        return value === null ? clone(fallback) : value;
      } catch (_) {
        return clone(fallback);
      }
    };
    const write = (key, value) => {
      try { storage.setItem(key, JSON.stringify(value)); return true; } catch (_) { return false; }
    };
    const remove = key => { try { storage.removeItem(key); } catch (_) {} };
    const text = (key, fallback = "") => { try { return storage.getItem(key) ?? fallback; } catch (_) { return fallback; } };
    const writeText = (key, value) => { try { storage.setItem(key, String(value)); return true; } catch (_) { return false; } };

    const homePrefs = (defaults, moduleIds, pinIds) => {
      const stored = read(KEYS.home, defaults);
      const order = [...new Set(Array.isArray(stored.order) ? stored.order : [])].filter(id => moduleIds.includes(id));
      moduleIds.forEach(id => { if (!order.includes(id)) order.push(id); });
      return {
        order,
        hidden: [...new Set(Array.isArray(stored.hidden) ? stored.hidden : [])].filter(id => moduleIds.includes(id)),
        pins: [...new Set(Array.isArray(stored.pins) ? stored.pins : [])].filter(id => pinIds.includes(id)),
      };
    };
    const playerLenses = valid => {
      const stored = read(KEYS.lenses, {});
      if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
      return Object.fromEntries(Object.entries(stored).filter(([id, lens]) => id && valid.includes(lens)));
    };
    const savedViews = (limit = 16) => {
      const stored = read(KEYS.views, []);
      return (Array.isArray(stored) ? stored : []).filter(row => row?.id && row?.page && row?.chart).slice(0, limit);
    };
    const filters = () => {
      const stored = read(KEYS.filters, {});
      return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
    };
    const watchlist = () => {
      const stored = read(KEYS.watchlist, { teams: [], players: [] });
      return {
        teams: Array.isArray(stored?.teams) ? [...new Set(stored.teams.map(String))] : [],
        players: Array.isArray(stored?.players) ? [...new Set(stored.players.map(String))] : [],
      };
    };
    const selectedTeams = (available, fallback) => {
      const stored = read(KEYS.teams, null);
      const rows = Array.isArray(stored) ? [...new Set(stored.map(String))] : [];
      return rows.length && rows.every(team => available.has(team)) ? rows : [...fallback];
    };
    const migrate = ({ defaults, moduleIds, pinIds, validLenses }) => {
      const home = homePrefs(defaults, moduleIds, pinIds);
      const lenses = playerLenses(validLenses);
      const views = savedViews();
      const pageFilters = filters();
      const saved = watchlist();
      write(KEYS.home, home);
      write(KEYS.lenses, lenses);
      write(KEYS.views, views);
      write(KEYS.filters, pageFilters);
      write(KEYS.watchlist, saved);
      return { home, lenses, views, filters: pageFilters, watchlist: saved };
    };

    return Object.freeze({
      KEYS,
      read,
      write,
      remove,
      text,
      writeText,
      homePrefs,
      saveHomePrefs: value => write(KEYS.home, value),
      playerLenses,
      savePlayerLens: (id, lens, valid) => {
        if (!valid.includes(lens)) return false;
        const values = playerLenses(valid); values[String(id)] = lens; return write(KEYS.lenses, values);
      },
      removePlayerLens: (id, valid) => {
        const values = playerLenses(valid); delete values[String(id)]; return write(KEYS.lenses, values);
      },
      savedViews,
      saveViews: (rows, limit = 16) => write(KEYS.views, (Array.isArray(rows) ? rows : []).slice(0, limit)),
      filters,
      saveFilters: value => write(KEYS.filters, value),
      watchlist,
      saveWatchlist: value => write(KEYS.watchlist, {
        teams: [...new Set((value?.teams || []).map(String))],
        players: [...new Set((value?.players || []).map(String))],
      }),
      selectedTeams,
      migrate,
    });
  }

  return Object.freeze({ KEYS, create });
}));
