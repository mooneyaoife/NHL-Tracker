import { handleNhlEndpoint } from "../../../_shared/handler.mjs";
import { SCHEDULE_NOW } from "../../../_shared/routes.mjs";

export const onRequestGet = context => handleNhlEndpoint(context, SCHEDULE_NOW);
export const onRequestHead = onRequestGet;
