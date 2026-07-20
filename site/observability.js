(function initialiseObservability(root) {
  "use strict";

  const STORAGE_KEY = "nhl-local-performance-v1";
  const LIMIT = 30;
  const latest = { lcp: null, cls: 0, inp: null, navigation: null };

  const read = () => {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(value) ? value : [];
    } catch (_) {
      return [];
    }
  };

  const write = value => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value.slice(-LIMIT)));
    } catch (_) {}
  };

  const record = () => {
    const navigation = performance.getEntriesByType("navigation")[0];
    const basePath = location.pathname.startsWith("/NHL-Tracker/") ? "/NHL-Tracker/" : "/";
    const route = root.NHLTrackerRouter?.routeFromPath(location.pathname, basePath) || "unknown";
    const sample = {
      at: new Date().toISOString(),
      route,
      lcp: latest.lcp,
      cls: Number(latest.cls.toFixed(4)),
      inp: latest.inp,
      navigation: navigation ? Math.round(navigation.loadEventEnd || navigation.duration) : null,
    };
    write([...read(), sample]);
  };

  const observe = (type, callback, options = {}) => {
    try {
      const observer = new PerformanceObserver(list => callback(list.getEntries()));
      observer.observe({ type, buffered: true, ...options });
      return observer;
    } catch (_) {
      return null;
    }
  };

  observe("largest-contentful-paint", entries => {
    const entry = entries.at(-1);
    if (entry) latest.lcp = Math.round(entry.startTime);
  });
  observe("layout-shift", entries => {
    entries.filter(entry => !entry.hadRecentInput).forEach(entry => { latest.cls += entry.value; });
  });
  observe("event", entries => {
    const durations = entries.map(entry => entry.duration).filter(Number.isFinite);
    if (durations.length) latest.inp = Math.max(latest.inp || 0, ...durations);
  }, { durationThreshold: 40 });

  addEventListener("pagehide", record, { once: true });

  root.NHLTrackerObservability = Object.freeze({
    snapshot: () => ({ latest: { ...latest }, samples: read() }),
    clear: () => {
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    },
    record,
  });
}(typeof globalThis !== "undefined" ? globalThis : this));
