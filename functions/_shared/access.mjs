const encoder = new TextEncoder();
const keyCache = new Map();
const CERT_CACHE_MS = 10 * 60 * 1000;

function decodeBase64Url(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function decodeJsonSegment(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

function audienceMatches(value, expected) {
  return Array.isArray(value) ? value.includes(expected) : value === expected;
}

function isLocalRequest(request) {
  const hostname = new URL(request.url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

async function fetchKeys(teamDomain, fetchImpl) {
  const now = Date.now();
  const cached = keyCache.get(teamDomain);
  if (cached && cached.expiresAt > now) return cached.keys;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetchImpl(
      `https://${teamDomain}.cloudflareaccess.com/cdn-cgi/access/certs`,
      { headers: { accept: "application/json" }, redirect: "error", signal: controller.signal },
    );
    if (!response.ok) throw new Error("Access signing keys are unavailable");
    const payload = await response.json();
    if (!Array.isArray(payload.keys) || !payload.keys.length) throw new Error("Access signing keys are invalid");
    keyCache.set(teamDomain, { keys: payload.keys, expiresAt: now + CERT_CACHE_MS });
    return payload.keys;
  } finally {
    clearTimeout(timer);
  }
}

export async function authenticateAccess(request, env, fetchImpl = fetch) {
  const mode = String(env.AUTH_MODE || "access").toLowerCase();
  if (mode === "disabled" && isLocalRequest(request)) return { mode: "local", subject: "local-development" };
  if (mode !== "access") throw new Error("Access authentication is not configured");

  const teamDomain = String(env.TEAM_DOMAIN || "").trim();
  const expectedAudience = String(env.POLICY_AUD || "").trim();
  if (!teamDomain || !expectedAudience) throw new Error("Access authentication is not configured");

  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) throw new Error("Access authentication is required");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Access authentication is invalid");

  let header;
  let payload;
  try {
    header = decodeJsonSegment(parts[0]);
    payload = decodeJsonSegment(parts[1]);
  } catch {
    throw new Error("Access authentication is invalid");
  }
  if (header.alg !== "RS256" || !header.kid) throw new Error("Access authentication is invalid");

  const keys = await fetchKeys(teamDomain, fetchImpl);
  const jwk = keys.find(candidate => candidate.kid === header.kid && candidate.kty === "RSA");
  if (!jwk) throw new Error("Access authentication is invalid");
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const validSignature = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    decodeBase64Url(parts[2]),
    encoder.encode(`${parts[0]}.${parts[1]}`),
  );
  const now = Math.floor(Date.now() / 1000);
  const issuer = `https://${teamDomain}.cloudflareaccess.com`;
  if (!validSignature || payload.iss !== issuer || !audienceMatches(payload.aud, expectedAudience)) {
    throw new Error("Access authentication is invalid");
  }
  if (!Number.isFinite(payload.exp) || payload.exp <= now || Number.isFinite(payload.nbf) && payload.nbf > now + 30) {
    throw new Error("Access authentication has expired");
  }
  return { mode: "access", subject: String(payload.sub || "") };
}

export function clearAccessKeyCacheForTests() {
  keyCache.clear();
}
