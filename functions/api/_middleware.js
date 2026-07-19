import { authenticateAccess } from "../_shared/access.mjs";
import { errorResponse, requestIdFor, secureResponse, validateApiRequest } from "../_shared/http.mjs";

export async function onRequest(context) {
  const requestId = requestIdFor(context.request);
  const invalid = validateApiRequest(context.request, requestId);
  if (invalid) return secureResponse(invalid, context.request, requestId);

  try {
    context.data.access = await authenticateAccess(context.request, context.env);
    context.data.requestId = requestId;
  } catch (error) {
    const configurationError = error.message.includes("not configured");
    const response = errorResponse(
      configurationError ? "access_not_configured" : "access_denied",
      configurationError ? "Cloudflare Access validation is not configured" : "Cloudflare Access authentication is required",
      configurationError ? 503 : 401,
      requestId,
    );
    return secureResponse(response, context.request, requestId);
  }

  const response = await context.next();
  return secureResponse(response, context.request, requestId);
}
