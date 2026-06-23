/**
 * Zod validation middleware for API Gateway Lambda handlers.
 *
 * Validates the request body BEFORE any state change (R17.4).
 * On validation failure → VALIDATION_ERROR with field-level detail (R17.5).
 * On unparseable body → MALFORMED_REQUEST_BODY (R17.6).
 * Enforces a max body size of 300KB (R18.9 — DynamoDB item limit context).
 */

import type { ZodSchema } from 'zod';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import type { ApiResponse } from '../types.js';
import { success, error } from './envelope.js';
import { resolveRequestId } from './request-id.js';
import { createLogger } from './logger.js';

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Context passed to validated handlers, providing request metadata.
 */
export interface ValidationContext {
  /** Unique request identifier (from x-request-id or generated UUID v4) */
  requestId: string;
  /** ISO-8601 UTC timestamp of when the request was received */
  timestamp: string;
  /** Authenticated user ID extracted from JWT claims (undefined for unauthenticated endpoints) */
  userId: string | undefined;
}

/**
 * Lambda handler compatible with API Gateway Proxy integration.
 */
export type LambdaHandler = (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>;

/**
 * A validated handler receives the parsed+validated input and context.
 */
export type ValidatedHandler<I> = (
  input: I,
  context: ValidationContext,
) => Promise<ApiResponse<unknown>>;

// ─── Constants ──────────────────────────────────────────────────────────────

/** Maximum request body size in bytes (300KB) */
const MAX_BODY_BYTES = 300 * 1024;

// ─── Helpers ────────────────────────────────────────────────────────────────

const RESPONSE_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
};

function buildResult(statusCode: number, body: ApiResponse<unknown>): APIGatewayProxyResult {
  return {
    statusCode,
    headers: RESPONSE_HEADERS,
    body: JSON.stringify(body),
  };
}

function extractUserId(event: APIGatewayProxyEvent): string | undefined {
  const claims = event.requestContext?.authorizer?.claims as Record<string, string> | undefined;
  return claims?.['sub'] ?? undefined;
}

// ─── Middleware ─────────────────────────────────────────────────────────────

/**
 * Creates a Lambda handler that validates the request body against a Zod schema
 * before invoking the application handler.
 *
 * Validation runs BEFORE any state change. Failures produce structured
 * field-level error responses without touching downstream services.
 */
export function withValidation<I>(
  schema: ZodSchema<I>,
  handler: ValidatedHandler<I>,
): LambdaHandler {
  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const requestId = resolveRequestId(event.headers as Record<string, string | undefined>);
    const logger = createLogger(requestId);

    // Enforce max body length before any parsing
    const rawBody = event.body ?? '';
    if (Buffer.byteLength(rawBody, 'utf-8') > MAX_BODY_BYTES) {
      logger.warn('Request body exceeds maximum size', {
        maxBytes: MAX_BODY_BYTES,
        actualBytes: Buffer.byteLength(rawBody, 'utf-8'),
      });
      return buildResult(
        400,
        error(
          'MALFORMED_REQUEST_BODY',
          `Request body exceeds maximum allowed size of ${MAX_BODY_BYTES} bytes`,
          requestId,
        ),
      );
    }

    // Parse JSON — reject unparseable bodies
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      logger.warn('Failed to parse request body as JSON');
      return buildResult(
        400,
        error('MALFORMED_REQUEST_BODY', 'Request body is not valid JSON', requestId),
      );
    }

    // Validate against the Zod schema
    const result = schema.safeParse(parsed);

    if (!result.success) {
      const fieldErrors = result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));

      logger.warn('Request validation failed', { fieldErrors });

      return buildResult(
        400,
        error('VALIDATION_ERROR', 'Request validation failed', requestId, {
          fields: fieldErrors,
        }),
      );
    }

    // Build handler context
    const context: ValidationContext = {
      requestId,
      timestamp: new Date().toISOString(),
      userId: extractUserId(event),
    };

    // Invoke the validated handler
    const response = await handler(result.data, context);

    // Map response to appropriate HTTP status
    const statusCode = response.success ? 200 : 400;
    return buildResult(statusCode, response);
  };
}
