const SECURITY_HEADERS = {
  "cache-control": "private, no-store",
  "content-security-policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "x-robots-tag": "noindex, nofollow, noarchive",
};

export function jsonResponse(payload, status = 200, extraHeaders = {}) {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8", ...SECURITY_HEADERS, ...extraHeaders });
  return new Response(JSON.stringify(payload), { status, headers });
}

export function errorResponse(code, message, status, requestId) {
  return jsonResponse({ ok: false, error: { code, message }, meta: { requestId } }, status);
}

export function requestIdFor(request) {
  return request.headers.get("cf-ray") || crypto.randomUUID();
}

export function validateApiRequest(request, requestId) {
  if (!["GET", "HEAD"].includes(request.method)) {
    return errorResponse("method_not_allowed", "Only GET and HEAD are supported", 405, requestId);
  }
  const url = new URL(request.url);
  if (url.search) return errorResponse("query_not_allowed", "Query parameters are not supported", 400, requestId);
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return errorResponse("cross_origin_denied", "Cross-origin requests are not supported", 403, requestId);
  return null;
}

export function secureResponse(response, request, requestId) {
  const headers = new Headers(response.headers);
  Object.entries(SECURITY_HEADERS).forEach(([name, value]) => headers.set(name, value));
  headers.set("vary", "Origin");
  headers.set("x-request-id", requestId);
  return new Response(request.method === "HEAD" ? null : response.body, { status: response.status, headers });
}
