import { handleNhlEndpoint } from "../../../../_shared/handler.mjs";
import { gameRoute } from "../../../../_shared/routes.mjs";

export const onRequestGet = context => handleNhlEndpoint(context, gameRoute(context.params.gameId, "boxscore"));
export const onRequestHead = onRequestGet;
