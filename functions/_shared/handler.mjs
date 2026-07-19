import { errorResponse, jsonResponse, requestIdFor } from "./http.mjs";
import { getNhlPayload } from "./proxy.mjs";

export async function handleNhlEndpoint(context, descriptor) {
  const requestId = context.data?.requestId || requestIdFor(context.request);
  if (!descriptor) return errorResponse("invalid_route", "The requested NHL resource is not allowlisted", 404, requestId);
  if (!context.env.NHL_CACHE) return errorResponse("cache_unavailable", "The NHL cache binding is unavailable", 503, requestId);

  try {
    const result = await getNhlPayload({ env: context.env, ...descriptor });
    const headers = {
      "x-cache-status": result.cacheStatus,
      "x-data-age": String(result.envelope.meta.ageSeconds),
    };
    if (result.cacheStatus === "stale") headers.warning = '110 - "Response is stale"';
    if (result.error) console.warn(JSON.stringify({ event: "nhl_proxy_stale", endpoint: descriptor.endpoint, requestId }));
    return jsonResponse({ ...result.envelope, meta: { ...result.envelope.meta, requestId } }, 200, headers);
  } catch (error) {
    console.warn(JSON.stringify({ event: "nhl_proxy_error", endpoint: descriptor.endpoint, requestId, message: error.message }));
    return errorResponse("upstream_unavailable", "Live NHL data is temporarily unavailable", 503, requestId);
  }
}
