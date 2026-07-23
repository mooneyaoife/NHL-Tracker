const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const states = require("../site/game-state.js");

const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/game_states.json"), "utf8"));
for (const fixture of fixtures) {
  const result = states.normalizeGameState(fixture.game);
  assert.equal(result.code, fixture.code, `${fixture.name} code`);
  if (fixture.label) assert.equal(result.label, fixture.label, `${fixture.name} label`);
  if (fixture.londonDate) assert.equal(result.londonDate, fixture.londonDate, `${fixture.name} London date`);
  if (["delayed", "postponed", "suspended"].includes(fixture.code)) {
    assert.equal(result.completed, false, `${fixture.name} must never be inferred complete`);
  }
}

assert.equal(states.normalizeSlateState({ games: [], now: "2026-07-21T12:00:00Z" }).code, "offseason");
assert.equal(states.normalizeSlateState({ games: [], now: "2026-11-21T12:00:00Z" }).code, "empty-slate");
assert.equal(states.normalizeSlateState({ games: [{}], now: "2026-07-21T12:00:00Z" }).code, "games");

console.log("game state contract: all checks passed");
