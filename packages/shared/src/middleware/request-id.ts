/**
 * Request ID resolution.
 * Reuses the client-supplied `x-request-id` header if it's a valid UUID v4,
 * otherwise generates a new UUID v4.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Resolves a request ID from incoming headers.
 * Performs a case-insensitive lookup for `x-request-id`. If found and valid UUID v4,
 * it is reused; otherwise a fresh UUID v4 is generated.
 */
export function resolveRequestId(
  headers: Record<string, string | undefined>,
): string {
  const key = Object.keys(headers).find(
    (k) => k.toLowerCase() === 'x-request-id',
  );

  const clientId = key ? headers[key] : undefined;

  if (clientId && UUID_RE.test(clientId)) {
    return clientId;
  }

  return crypto.randomUUID();
}
