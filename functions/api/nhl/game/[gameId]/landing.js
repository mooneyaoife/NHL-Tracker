import { handleNhlEndpoint } from "../../../../_shared/handler.mjs";
import { gameRoute } from "../../../../_shared/routes.mjs";

export const onRequestGet = context => handleNhlEndpoint(context, gameRoute(context.params.gameId, "landing"));
export const onRequestHead = onRequestGet;
