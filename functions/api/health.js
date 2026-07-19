import { jsonResponse } from "../_shared/http.mjs";

export function onRequestGet(context) {
  return jsonResponse({
    ok: true,
    service: "nhl-tracker-api",
    version: "1",
    time: new Date().toISOString(),
    auth: context.data?.access?.mode || "unknown",
    bindings: { nhlCache: Boolean(context.env.NHL_CACHE) },
  });
}

export const onRequestHead = onRequestGet;
