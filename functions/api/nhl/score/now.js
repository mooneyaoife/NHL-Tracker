import { handleNhlEndpoint } from "../../../_shared/handler.mjs";
import { SCORE_NOW } from "../../../_shared/routes.mjs";

export const onRequestGet = context => handleNhlEndpoint(context, SCORE_NOW);
export const onRequestHead = onRequestGet;
