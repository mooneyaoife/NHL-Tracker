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

function accessTokenFor(request) {
  const assertion = request.headers.get("cf-access-jwt-assertion");
  if (assertion) return assertion;

  const cookieHeader = request.headers.get("cookie") || "";
  for (const cookie of cookieHeader.split(";")) {
    const separator = cookie.indexOf("=");
    if (separator < 0 || cookie.slice(0, separator).trim() !== "CF_Authorization") continue;
    return cookie.slice(separator + 1).trim();
  }
  return "";
}

async function fetchKeys(teamDomain, fetchImpl) {
  const now = Date.now();
  const cached = keyCache.get(teamDomain);
  if (cached && cached.expiresAt > now) return cached.keys;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    let response;
    try {
      response = await fetchImpl(
        `https://${teamDomain}.cloudflareaccess.com/cdn-cgi/access/certs`,
        { headers: { accept: "application/json" }, redirect: "follow", signal: controller.signal },
      );
    } catch {
      throw new Error("Access signing keys are unavailable");
    }
    if (!response.ok) throw new Error("Access signing keys are unavailable");
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error("Access signing keys are invalid");
    }
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

  const token = accessTokenFor(request);
  if (!token) throw new Error("Access authentication is required");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Access authentication token is malformed");

  let header;
  let payload;
  try {
    header = decodeJsonSegment(parts[0]);
    payload = decodeJsonSegment(parts[1]);
  } catch {
    throw new Error("Access authentication claims are invalid");
  }
  if (header.alg !== "RS256" || !header.kid) throw new Error("Access authentication header is invalid");

  let keys;
  try {
    keys = await fetchKeys(teamDomain, fetchImpl);
  } catch (error) {
    if (error.message.includes("signing keys")) throw error;
    throw new Error("Access signing keys are unavailable");
  }
  const jwk = keys.find(candidate => candidate.kid === header.kid && candidate.kty === "RSA");
  if (!jwk) throw new Error("Access authentication key is invalid");
  let validSignature;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    validSignature = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      decodeBase64Url(parts[2]),
      encoder.encode(`${parts[0]}.${parts[1]}`),
    );
  } catch {
    throw new Error("Access authentication cryptography is invalid");
  }
  const now = Math.floor(Date.now() / 1000);
  const issuer = `https://${teamDomain}.cloudflareaccess.com`;
  if (!validSignature) throw new Error("Access authentication signature is invalid");
  if (payload.iss !== issuer) throw new Error("Access authentication issuer is invalid");
  if (!audienceMatches(payload.aud, expectedAudience)) {
    throw new Error("Access authentication audience is invalid");
  }
  if (!Number.isFinite(payload.exp) || payload.exp <= now || Number.isFinite(payload.nbf) && payload.nbf > now + 30) {
    throw new Error("Access authentication has expired");
  }
  return { mode: "access", subject: String(payload.sub || "") };
}

export function clearAccessKeyCacheForTests() {
  keyCache.clear();
}
