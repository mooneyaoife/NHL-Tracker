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
    "stored-fallback": ["Stored fallback", "The last complete generated snapshot remains active because part of the latest data refresh was unavailable.", true],
    static: ["Static snapshot", "This host is using the latest generated tracker snapshot.", false],
    archive: ["Archive", "This is a completed-season snapshot and does not receive live updates.", false],
  };

  const validDate = value => {
    const date = new Date(value || "");
    return Number.isFinite(date.getTime()) ? date : null;
  };

  function describe({ status = "static", snapshotAt = null, fetchedAt = null, components = null, archived = false,
    artifactStatus = "fresh", failedTeams = [], timeZone = "Europe/London" } = {}) {
    const retainedArtifact = ["stale", "partial-stale"].includes(String(artifactStatus || "").toLowerCase());
    const code = archived ? "archive" : status === "static" && retainedArtifact ? "stored-fallback" : STATUS[status] ? status : "static";
    const [label, explanation, retryable] = STATUS[code];
    const sourceDate = validDate(fetchedAt) || validDate(snapshotAt);
    const timestamp = sourceDate
      ? sourceDate.toLocaleString("en-GB", { timeZone, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" })
      : "time unavailable";
    const componentText = components && !archived
      ? ` Score: ${components.score || "unavailable"}; schedule: ${components.schedule || "unavailable"}.`
      : "";
    const affected = [...new Set((failedTeams || []).map(String).filter(Boolean))];
    const artifactText = retainedArtifact
      ? ` Generated-data fallback is active${affected.length ? ` for ${affected.join(", ")}` : ""}.`
      : "";
    const retry = retryable
      ? " Reloading may restore fresher live information; the displayed static or cached content remains usable."
      : " Reloading is not required for the currently displayed data.";
    return Object.freeze({
      code,
      label,
      timestamp,
      compact: `${label} · ${timestamp}`,
      detail: `${explanation}${componentText}${artifactText}${retry}`,
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
