import { cachePolicy } from "./cache-policy.mjs";

const NHL_ORIGIN = "https://api-web.nhle.com";
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const RETRYABLE = new Set([408, 425, 429]);

function retryableStatus(status) {
  return RETRYABLE.has(status) || status >= 500;
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function fetchAttempt(url, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "error",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchNhlJson(path, options = {}) {
  if (!path.startsWith("/v1/") || path.includes("?") || path.includes("#")) throw new Error("NHL path is not allowlisted");
  const url = `${NHL_ORIGIN}${path}`;
  const fetchImpl = options.fetchImpl || fetch;
  const sleepImpl = options.sleepImpl || sleep;
  const randomImpl = options.randomImpl || Math.random;
  let lastError;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchAttempt(url, fetchImpl, 4000);
      if (!response.ok) {
        const error = new Error(`NHL upstream returned ${response.status}`);
        error.retryable = retryableStatus(response.status);
        response.body?.cancel();
        throw error;
      }
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.toLowerCase().includes("application/json")) {
        const error = new Error("NHL upstream returned a non-JSON response");
        error.retryable = false;
        throw error;
      }
      const contentLength = Number(response.headers.get("content-length") || 0);
      if (contentLength > MAX_RESPONSE_BYTES) {
        const error = new Error("NHL upstream response is too large");
        error.retryable = false;
        throw error;
      }
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > MAX_RESPONSE_BYTES) {
        const error = new Error("NHL upstream response is too large");
        error.retryable = false;
        throw error;
      }
      try {
        return JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        const error = new Error("NHL upstream returned invalid JSON");
        error.retryable = false;
        throw error;
      }
    } catch (error) {
      lastError = error;
      if (attempt === 0 && error.retryable !== false) {
        await sleepImpl(250 + Math.floor(randomImpl() * 100));
        continue;
      }
      throw error;
    }
  }
  throw lastError || new Error("NHL upstream is unavailable");
}

function cacheEnvelope(entry, cacheStatus, nowMs) {
  return {
    ok: true,
    data: entry.data,
    meta: {
      endpoint: entry.endpoint,
      state: entry.state,
      fetchedAt: entry.fetchedAt,
      freshUntil: entry.freshUntil,
      staleUntil: entry.staleUntil,
      stale: cacheStatus === "stale",
      cache: cacheStatus,
      ageSeconds: Math.max(0, Math.floor((nowMs - Date.parse(entry.fetchedAt)) / 1000)),
    },
  };
}

async function readCache(namespace, key) {
  if (!namespace) return null;
  try {
    return await namespace.get(key, { type: "json" });
  } catch {
    return null;
  }
}

async function writeCache(namespace, key, entry, expirationTtl) {
  if (!namespace) return;
  await namespace.put(key, JSON.stringify(entry), { expirationTtl });
}

export async function getNhlPayload({ env, endpoint, upstreamPath, nowMs = Date.now(), fetchOptions = {} }) {
  const cacheKey = `nhl:v1:${endpoint}`;
  const cached = await readCache(env.NHL_CACHE, cacheKey);
  if (cached && Number(cached.freshUntilMs) > nowMs) {
    return { envelope: cacheEnvelope(cached, "hit", nowMs), cacheStatus: "hit" };
  }

  try {
    const data = await fetchNhlJson(upstreamPath, fetchOptions);
    const policy = cachePolicy(data, nowMs);
    const fetchedAt = new Date(nowMs).toISOString();
    const entry = {
      endpoint,
      data,
      state: policy.state,
      fetchedAt,
      freshUntil: new Date(nowMs + policy.freshSeconds * 1000).toISOString(),
      staleUntil: new Date(nowMs + policy.staleSeconds * 1000).toISOString(),
      freshUntilMs: nowMs + policy.freshSeconds * 1000,
      staleUntilMs: nowMs + policy.staleSeconds * 1000,
    };
    await writeCache(env.NHL_CACHE, cacheKey, entry, Math.max(60, policy.staleSeconds + 3600));
    return { envelope: cacheEnvelope(entry, cached ? "refresh" : "miss", nowMs), cacheStatus: cached ? "refresh" : "miss" };
  } catch (error) {
    if (cached && Number(cached.staleUntilMs) > nowMs) {
      return { envelope: cacheEnvelope(cached, "stale", nowMs), cacheStatus: "stale", error };
    }
    throw error;
  }
}
