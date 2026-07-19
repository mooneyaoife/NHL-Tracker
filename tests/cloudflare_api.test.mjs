import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";

import { authenticateAccess, clearAccessKeyCacheForTests } from "../functions/_shared/access.mjs";
import { cachePolicy } from "../functions/_shared/cache-policy.mjs";
import { getNhlPayload } from "../functions/_shared/proxy.mjs";
import { gameRoute, SCORE_NOW, SCHEDULE_NOW } from "../functions/_shared/routes.mjs";

class MemoryKv {
  constructor() {
    this.values = new Map();
  }

  async get(key, options) {
    const value = this.values.get(key);
    if (value == null) return null;
    return options?.type === "json" ? JSON.parse(value) : value;
  }

  async put(key, value) {
    this.values.set(key, value);
  }
}

const jsonResponse = payload => new Response(JSON.stringify(payload), {
  headers: { "content-type": "application/json" },
});

test("the NHL route allowlist accepts only fixed endpoints and ten-digit game IDs", () => {
  assert.deepEqual(SCORE_NOW, { endpoint: "score:now", upstreamPath: "/v1/score/now" });
  assert.deepEqual(SCHEDULE_NOW, { endpoint: "schedule:now", upstreamPath: "/v1/schedule/now" });
  assert.deepEqual(gameRoute("2026020001", "landing"), {
    endpoint: "game:2026020001:landing",
    upstreamPath: "/v1/gamecenter/2026020001/landing",
  });
  assert.equal(gameRoute("../../admin", "landing"), null);
  assert.equal(gameRoute("2026020001", "play-by-play"), null);
});

test("cache policy gives live, intermission, final, and future games different lifetimes", () => {
  const now = Date.parse("2026-10-18T19:00:00Z");
  assert.deepEqual(cachePolicy({ gameState: "LIVE", startTimeUTC: "2026-10-18T18:00:00Z" }, now), {
    state: "live", freshSeconds: 15, staleSeconds: 900,
  });
  assert.deepEqual(cachePolicy({ gameState: "LIVE", clock: { inIntermission: true } }, now), {
    state: "intermission", freshSeconds: 30, staleSeconds: 1800,
  });
  assert.deepEqual(cachePolicy({ gameState: "FINAL", startTimeUTC: "2026-10-18T15:00:00Z" }, now), {
    state: "recent-final", freshSeconds: 600, staleSeconds: 604800,
  });
  assert.deepEqual(cachePolicy({ gameState: "FUT", startTimeUTC: "2026-10-20T19:00:00Z" }, now), {
    state: "scheduled", freshSeconds: 21600, staleSeconds: 86400,
  });
});

test("KV serves fresh hits and stale data after a bounded upstream failure", async () => {
  const namespace = new MemoryKv();
  const now = Date.parse("2026-10-18T19:00:00Z");
  let calls = 0;
  const fetchImpl = async url => {
    calls += 1;
    assert.equal(url, "https://api-web.nhle.com/v1/score/now");
    return jsonResponse({ games: [{ id: 2026020001, gameState: "LIVE", startTimeUTC: "2026-10-18T18:00:00Z" }] });
  };
  const first = await getNhlPayload({
    env: { NHL_CACHE: namespace }, ...SCORE_NOW, nowMs: now,
    fetchOptions: { fetchImpl, sleepImpl: async () => {}, randomImpl: () => 0 },
  });
  assert.equal(first.cacheStatus, "miss");
  assert.equal(first.envelope.meta.state, "live");
  assert.equal(calls, 1);

  const hit = await getNhlPayload({
    env: { NHL_CACHE: namespace }, ...SCORE_NOW, nowMs: now + 5000,
    fetchOptions: { fetchImpl: async () => { throw new Error("should not fetch"); } },
  });
  assert.equal(hit.cacheStatus, "hit");
  assert.equal(calls, 1);

  const stale = await getNhlPayload({
    env: { NHL_CACHE: namespace }, ...SCORE_NOW, nowMs: now + 16000,
    fetchOptions: {
      fetchImpl: async () => { throw new Error("network unavailable"); },
      sleepImpl: async () => {},
      randomImpl: () => 0,
    },
  });
  assert.equal(stale.cacheStatus, "stale");
  assert.equal(stale.envelope.meta.stale, true);
});

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

test("Access JWT validation checks signature, issuer, audience, and expiry", async () => {
  clearAccessKeyCacheForTests();
  const keyPair = await webcrypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const publicJwk = await webcrypto.subtle.exportKey("jwk", keyPair.publicKey);
  publicJwk.kid = "test-key";
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";
  const teamDomain = "nhl-tracker-private-pages";
  const audience = "test-audience";
  const header = base64Url(JSON.stringify({ alg: "RS256", kid: publicJwk.kid, typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    iss: `https://${teamDomain}.cloudflareaccess.com`,
    aud: [audience],
    sub: "owner",
    exp: Math.floor(Date.now() / 1000) + 300,
  }));
  const signature = await webcrypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keyPair.privateKey,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  const token = `${header}.${payload}.${Buffer.from(signature).toString("base64url")}`;
  const request = new Request("https://nhl-tracker-private.pages.dev/api/health", {
    headers: { "cf-access-jwt-assertion": token },
  });
  const result = await authenticateAccess(request, { AUTH_MODE: "access", TEAM_DOMAIN: teamDomain, POLICY_AUD: audience },
    async () => jsonResponse({ keys: [publicJwk] }));
  assert.deepEqual(result, { mode: "access", subject: "owner" });

  await assert.rejects(
    authenticateAccess(request, { AUTH_MODE: "access", TEAM_DOMAIN: teamDomain, POLICY_AUD: "wrong-audience" },
      async () => jsonResponse({ keys: [publicJwk] })),
    /invalid/,
  );
});

test("AUTH_MODE disabled is accepted only on a local development origin", async () => {
  assert.equal((await authenticateAccess(new Request("http://127.0.0.1:8788/api/health"), { AUTH_MODE: "disabled" })).mode, "local");
  await assert.rejects(
    authenticateAccess(new Request("https://nhl-tracker-private.pages.dev/api/health"), { AUTH_MODE: "disabled" }),
    /not configured/,
  );
});
