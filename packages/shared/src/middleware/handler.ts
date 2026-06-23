/**
 * Lambda handler factory.
 * Composes: request-id resolution → CORS → auth extraction → rate limiting →
 * optional validation → handler execution → error classification → response envelope.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import type { ZodSchema } from 'zod';

import { resolveRequestId } from './request-id.js';
import { extractUserContext, type UserContext } from './auth.js';
import { createLogger, type Logger } from './logger.js';
import { success } from './envelope.js';
import { AppError, toErrorResponse } from './errors.js';
import { RateLimiter } from './rate-limiter.js';
import { buildCorsHeaders, parseAllowedOrigins } from './cors.js';

// ─── Handler Context ────────────────────────────────────────────────────────

export interface HandlerContext<TBody = unknown> {
  event: APIGatewayProxyEvent;
  requestId: string;
  logger: Logger;
  user: UserContext | null;
  body: TBody;
}

// ─── Handler Config ─────────────────────────────────────────────────────────

export interface HandlerConfig<TBody = unknown> {
  /** Zod schema for request body validation. If omitted, body is passed as-is. */
  schema?: ZodSchema<TBody>;
  /** Whether authentication is required. Defaults to true. */
  requireAuth?: boolean;
  /** Whether rate limiting is enabled. Defaults to true for authenticated routes. */
  rateLimit?: boolean;
  /** The actual handler logic. */
  handler: (ctx: HandlerContext<TBody>) => Promise<unknown>;
}

// ─── Shared Rate Limiter Instance ───────────────────────────────────────────

let rateLimiterInstance: RateLimiter | null = null;

function getRateLimiter(): RateLimiter | null {
  if (rateLimiterInstance) return rateLimiterInstance;

  const tableName = process.env.TABLE_NAME;
  if (!tableName) return null;

  rateLimiterInstance = new RateLimiter({ tableName });
  return rateLimiterInstance;
}

// ─── Shared Allowed Origins ─────────────────────────────────────────────────

let allowedOriginsCache: string[] | null = null;

function getAllowedOrigins(): string[] {
  if (allowedOriginsCache !== null) return allowedOriginsCache;
  allowedOriginsCache = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);
  return allowedOriginsCache;
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Creates an API Gateway Lambda handler with built-in middleware:
 * request-id, CORS, logging, auth extraction, rate limiting, validation, and error handling.
 */
export function createHandler<TBody = unknown>(
  config: HandlerConfig<TBody>,
): (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult> {
  const { schema, requireAuth = true, rateLimit = true, handler } = config;

  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const requestId = resolveRequestId(event.headers ?? {});
    const logger = createLogger(requestId);

    // Resolve CORS headers for this request
    const requestOrigin = event.headers?.['Origin'] ?? event.headers?.['origin'];
    const allowedOrigins = getAllowedOrigins();
    const corsHeaders = buildCorsHeaders(requestOrigin, allowedOrigins);

    try {
      // Auth extraction
      const user = await extractUserContext(event);

      if (requireAuth && !user) {
        throw new AppError('UNAUTHENTICATED', 'Authentication is required');
      }

      // Per-user rate limiting (only for authenticated users)
      if (rateLimit && user) {
        const limiter = getRateLimiter();
        if (limiter) {
          await limiter.check(user.userId);
        }
      }

      // Body parsing and validation
      let body: TBody = undefined as unknown as TBody;

      if (schema) {
        // Enforce max body size (300KB) before parsing
        const rawBodyStr = event.body ?? '';
        if (Buffer.byteLength(rawBodyStr, 'utf-8') > 300 * 1024) {
          throw new AppError(
            'MALFORMED_REQUEST_BODY',
            `Request body exceeds maximum allowed size of ${300 * 1024} bytes`,
          );
        }

        let rawBody: unknown;
        try {
          rawBody = rawBodyStr ? JSON.parse(rawBodyStr) : {};
        } catch {
          throw new AppError('MALFORMED_REQUEST_BODY', 'Request body is not valid JSON');
        }

        const result = schema.safeParse(rawBody);
        if (!result.success) {
          const fieldErrors: Record<string, string[]> = {};
          for (const issue of result.error.issues) {
            const path = issue.path.join('.');
            if (!fieldErrors[path]) {
              fieldErrors[path] = [];
            }
            fieldErrors[path].push(issue.message);
          }
          throw new AppError('VALIDATION_ERROR', 'Request validation failed', {
            fields: fieldErrors,
          });
        }
        body = result.data;
      }

      // Execute handler
      logger.info('Handler invoked', { path: event.path, method: event.httpMethod });
      const data = await handler({ event, requestId, logger, user, body });

      // Build success response
      const envelope = success(data, requestId);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
        body: JSON.stringify(envelope),
      };
    } catch (err: unknown) {
      const isAppError = err instanceof AppError;
      if (!isAppError) {
        logger.error('Unhandled error', {
          error: err instanceof Error ? err.message : String(err),
        });
      } else {
        logger.warn('Application error', { code: (err as AppError).code });
      }

      const response = toErrorResponse(err, requestId);
      return {
        statusCode: response.statusCode,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
        body: response.body,
      };
    }
  };
}
