(function initialiseFreshnessStatus(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.NHLTrackerFreshnessStatus = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function createFreshnessStatus() {
  "use strict";

  const STATUS = {
    live: ["Live scores", "Fresh score and schedule responses are active.", false],
    cached: ["Cached scores", "The edge cache supplied a recent complete live snapshot.", false],
    "partial-live": ["Partial live data", "One live component is current while another is temporarily unavailable.", true],
    "partial-cached": ["Partial cached data", "One live component is unavailable and a retained cached component remains active.", true],
    stale: ["Stale scores", "A recent cached NHL response remains visible while the upstream service recovers.", true],
    "static-fallback": ["Static snapshot", "The valid generated snapshot remains active because live enhancement is unavailable.", true],
    static: ["Static snapshot", "This host is using the latest generated tracker snapshot.", false],
    archive: ["Archive", "This is a completed-season snapshot and does not receive live updates.", false],
  };

  const validDate = value => {
    const date = new Date(value || "");
    return Number.isFinite(date.getTime()) ? date : null;
  };

  function describe({ status = "static", snapshotAt = null, fetchedAt = null, components = null, archived = false } = {}) {
    const code = archived ? "archive" : STATUS[status] ? status : "static";
    const [label, explanation, retryable] = STATUS[code];
    const sourceDate = validDate(fetchedAt) || validDate(snapshotAt);
    const timestamp = sourceDate
      ? sourceDate.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })
      : "time unavailable";
    const componentText = components && !archived
      ? ` Score: ${components.score || "unavailable"}; schedule: ${components.schedule || "unavailable"}.`
      : "";
    const retry = retryable
      ? " Reloading may restore fresher live information; the displayed static or cached content remains usable."
      : " Reloading is not required for the currently displayed data.";
    return Object.freeze({
      code,
      label,
      timestamp,
      compact: `${label} · ${timestamp}`,
      detail: `${explanation}${componentText}${retry}`,
      retryable,
    });
  }

  function render(options = {}, documentRoot = typeof document !== "undefined" ? document : null) {
    const state = describe(options);
    if (!documentRoot) return state;
    const summary = documentRoot.getElementById("updated");
    const title = documentRoot.getElementById("freshness-detail-title");
    const detail = documentRoot.getElementById("freshness-detail-copy");
    if (summary) {
      summary.textContent = state.compact;
      summary.dataset.freshness = state.code;
      summary.title = "Open data freshness details";
    }
    if (title) title.textContent = state.label;
    if (detail) detail.textContent = `${state.detail} Snapshot time: ${state.timestamp}.`;
    return state;
  }

  return Object.freeze({ describe, render });
}));
