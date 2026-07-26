(function initialiseUrlSafety(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.NHLTrackerUrlSafety = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function createUrlSafety() {
  "use strict";

  const sanitise = value => {
    try {
      const url = new URL(String(value || ""));
      return url.protocol === "https:" ? url.href : "";
    } catch {
      return "";
    }
  };

  return Object.freeze({ sanitise });
}));
