const assert = require("node:assert/strict");
const status = require("../site/freshness-status.js");

const snapshotAt = "2026-10-18T19:00:00Z";
for (const code of ["live", "cached", "partial-live", "partial-cached", "stale", "static-fallback", "static"]) {
  const result = status.describe({ status: code, snapshotAt, components: { score: "live", schedule: "unavailable" } });
  assert.equal(result.code, code);
  assert.ok(result.label);
  assert.match(result.detail, /Reloading/);
}
assert.equal(status.describe({ status: "partial-live", snapshotAt }).retryable, true);
assert.equal(status.describe({ status: "static", snapshotAt }).retryable, false);
assert.equal(status.describe({ archived: true, snapshotAt }).code, "archive");

console.log("freshness status: all checks passed");
