const assert = require("node:assert/strict");
const { sanitise } = require("../site/url-safety.js");

assert.equal(sanitise("https://www.nhl.com/gamecenter/2026020001"), "https://www.nhl.com/gamecenter/2026020001");
assert.equal(sanitise("HTTPS://example.com/path?q=1"), "https://example.com/path?q=1");
for (const value of ["javascript:alert(1)", "data:text/html,hello", "http://example.com", "//example.com", "/relative", "not a url", ""]) {
  assert.equal(sanitise(value), "", `${value || "empty input"} is rejected`);
}

console.log("URL safety: all checks passed");
