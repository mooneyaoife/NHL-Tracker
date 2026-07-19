export const SCORE_NOW = Object.freeze({ endpoint: "score:now", upstreamPath: "/v1/score/now" });
export const SCHEDULE_NOW = Object.freeze({ endpoint: "schedule:now", upstreamPath: "/v1/schedule/now" });

export function gameRoute(gameId, resource) {
  const id = String(gameId || "");
  if (!/^\d{10}$/.test(id)) return null;
  if (!new Set(["landing", "boxscore"]).has(resource)) return null;
  return { endpoint: `game:${id}:${resource}`, upstreamPath: `/v1/gamecenter/${id}/${resource}` };
}
