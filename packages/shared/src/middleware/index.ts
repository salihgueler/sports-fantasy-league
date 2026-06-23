/**
 * Shared API middleware — barrel exports.
 */

export { resolveRequestId } from './request-id.js';
export { success, error } from './envelope.js';
export { createLogger, type Logger, type LogLevel, type LogEntry } from './logger.js';
export { extractUserContext, type UserContext } from './auth.js';
export { AppError, classifyError, toErrorResponse, type ClassifiedError } from './errors.js';
export { createHandler, type HandlerConfig, type HandlerContext } from './handler.js';
export { withValidation } from './validation.js';
export type { LambdaHandler, ValidatedHandler, ValidationContext } from './validation.js';
export { RateLimiter, type RateLimiterConfig } from './rate-limiter.js';
export {
  parseAllowedOrigins,
  buildCorsHeaders,
  isOriginAllowed,
  type CorsHeaders,
} from './cors.js';
