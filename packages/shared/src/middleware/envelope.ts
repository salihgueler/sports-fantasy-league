/**
 * API response envelope builders.
 * Produces ApiSuccess / ApiError shapes with meta (requestId + UTC ISO-8601 timestamp).
 */

import type { ApiSuccess, ApiError } from '../types.js';

/**
 * Build a successful API response envelope.
 */
export function success<T>(data: T, requestId: string): ApiSuccess<T> {
  return {
    success: true,
    data,
    meta: {
      requestId,
      timestamp: new Date().toISOString(),
    },
  };
}

/**
 * Build an error API response envelope.
 */
export function error(
  code: string,
  message: string,
  requestId: string,
  details?: Record<string, unknown>,
): ApiError {
  return {
    success: false,
    error: {
      code,
      message,
      ...(details !== undefined && { details }),
    },
    meta: {
      requestId,
      timestamp: new Date().toISOString(),
    },
  };
}
