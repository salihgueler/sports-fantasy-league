/**
 * CORS middleware for Lambda handlers.
 *
 * Validates the Origin header against the configured allowed-origins list
 * (sourced from the ALLOWED_ORIGINS environment variable, comma-separated).
 * Returns appropriate CORS headers on successful validation,
 * or omits the Access-Control-Allow-Origin header for denied origins.
 */

// ─── Configuration ──────────────────────────────────────────────────────────

/**
 * Parse the allowed origins from a comma-separated environment variable.
 * Returns an empty array if the value is undefined or empty.
 */
export function parseAllowedOrigins(envValue: string | undefined): string[] {
  if (!envValue || envValue.trim() === '') {
    return [];
  }
  return envValue
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

// ─── CORS Headers ───────────────────────────────────────────────────────────

export interface CorsHeaders {
  'Access-Control-Allow-Origin'?: string;
  'Access-Control-Allow-Methods'?: string;
  'Access-Control-Allow-Headers'?: string;
  'Access-Control-Max-Age'?: string;
  Vary?: string;
}

/**
 * Build CORS response headers for a given request origin.
 * Returns headers with Access-Control-Allow-Origin set only if the origin
 * is in the allowed list. Always includes Vary: Origin.
 */
export function buildCorsHeaders(
  requestOrigin: string | undefined,
  allowedOrigins: string[],
): CorsHeaders {
  const headers: CorsHeaders = {
    Vary: 'Origin',
  };

  if (!requestOrigin || allowedOrigins.length === 0) {
    return headers;
  }

  if (allowedOrigins.includes(requestOrigin)) {
    headers['Access-Control-Allow-Origin'] = requestOrigin;
    headers['Access-Control-Allow-Methods'] = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type,Authorization,X-Request-Id';
    headers['Access-Control-Max-Age'] = '86400';
  }

  return headers;
}

/**
 * Check if the given origin is allowed.
 * Returns true if the origin is in the allowed list, false otherwise.
 */
export function isOriginAllowed(
  origin: string | undefined,
  allowedOrigins: string[],
): boolean {
  if (!origin || allowedOrigins.length === 0) {
    return false;
  }
  return allowedOrigins.includes(origin);
}
