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
    const signingKeysUnavailable = error.message.includes("signing keys");
    const tokenMissing = error.message.includes("required");
    const invalidSignature = error.message.includes("signature");
    const invalidIssuer = error.message.includes("issuer");
    const invalidAudience = error.message.includes("audience");
    const errorCode = configurationError
      ? "access_not_configured"
      : signingKeysUnavailable
        ? "access_keys_unavailable"
        : tokenMissing
          ? "access_token_missing"
          : invalidSignature
            ? "access_token_signature_invalid"
            : invalidIssuer
              ? "access_token_issuer_invalid"
              : invalidAudience
                ? "access_token_audience_invalid"
                : "access_token_invalid";
    console.warn(JSON.stringify({ event: "access_denied", requestId, reason: errorCode }));
    const response = errorResponse(
      errorCode,
      configurationError || signingKeysUnavailable
        ? "Cloudflare Access validation is temporarily unavailable"
        : "Cloudflare Access authentication is required",
      configurationError || signingKeysUnavailable ? 503 : 401,
      requestId,
    );
    return secureResponse(response, context.request, requestId);
  }

  const response = await context.next();
  return secureResponse(response, context.request, requestId);
}
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
    const signingKeysUnavailable = error.message.includes("signing keys");
    const tokenMissing = error.message.includes("required");
    const errorCode = configurationError
      ? "access_not_configured"
      : signingKeysUnavailable
        ? "access_keys_unavailable"
        : tokenMissing
          ? "access_token_missing"
          : "access_token_invalid";
    console.warn(JSON.stringify({ event: "access_denied", requestId, reason: errorCode }));
    const response = errorResponse(
      errorCode,
      configurationError || signingKeysUnavailable
        ? "Cloudflare Access validation is temporarily unavailable"
        : "Cloudflare Access authentication is required",
      configurationError || signingKeysUnavailable ? 503 : 401,
      requestId,
    );
    return secureResponse(response, context.request, requestId);
  }

  const response = await context.next();
  return secureResponse(response, context.request, requestId);
}
