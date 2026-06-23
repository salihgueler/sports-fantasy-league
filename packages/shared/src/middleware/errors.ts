/**
 * Central error classification layer.
 * Maps application error codes to HTTP status codes and produces
 * the standard API error envelope.
 */

import { error as buildErrorEnvelope } from './envelope.js';

// ─── Error Code → HTTP Status Mapping ───────────────────────────────────────

const ERROR_STATUS_MAP: Record<string, number> = {
  // 400 Bad Request
  VALIDATION_ERROR: 400,
  MALFORMED_REQUEST_BODY: 400,
  INVALID_DISPLAY_NAME: 400,
  INVALID_NOTIFICATION_PREFERENCE: 400,
  INVALID_SQUAD_SIZE: 400,
  INVALID_POSITION_COUNT: 400,
  INVALID_PLAYER_SELECTION: 400,
  DUPLICATE_PLAYER: 400,
  BUDGET_EXCEEDED: 400,
  INVALID_CAPTAIN_SELECTION: 400,
  INVALID_FORMATION: 400,
  AUTO_PICK_INFEASIBLE: 400,
  MESSAGE_TOO_LONG: 400,
  EMPTY_MESSAGE: 400,
  CHIP_NOT_CONFIGURED: 400,
  CHIP_UNAVAILABLE: 400,
  CHIP_ALREADY_ACTIVE: 400,
  INVALID_TRANSFER: 400,

  // 401 Unauthorized
  INVALID_CREDENTIALS: 401,
  TOKEN_EXPIRED: 401,
  UNAUTHENTICATED: 401,

  // 403 Forbidden
  NOT_A_LEAGUE_MEMBER: 403,
  ACCOUNT_LOCKED: 403,

  // 404 Not Found
  COMPETITION_NOT_FOUND: 404,
  INVALID_JOIN_CODE: 404,
  LEAGUE_NOT_FOUND: 404,
  TEAM_NOT_FOUND: 404,
  USER_NOT_FOUND: 404,

  // 409 Conflict
  EMAIL_ALREADY_REGISTERED: 409,
  PLAYER_ALREADY_IN_SQUAD: 409,
  ALREADY_MEMBER: 409,
  TRANSFER_DEADLINE_PASSED: 409,
  LEAGUE_FULL: 409,
  NO_FANTASY_TEAM: 409,
  SCORE_ALREADY_CONFIRMED: 409,

  // 429 Too Many Requests
  RATE_LIMIT_EXCEEDED: 429,

  // 500 Internal Server Error
  INTERNAL_ERROR: 500,
};

// ─── AppError Class ─────────────────────────────────────────────────────────

export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = ERROR_STATUS_MAP[code] ?? 500;
    this.details = details;
  }
}

// ─── Error Classifier ───────────────────────────────────────────────────────

export interface ClassifiedError {
  code: string;
  statusCode: number;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Classify any thrown value into a structured error with HTTP status.
 */
export function classifyError(err: unknown): ClassifiedError {
  if (err instanceof AppError) {
    return {
      code: err.code,
      statusCode: err.statusCode,
      message: err.message,
      ...(err.details !== undefined && { details: err.details }),
    };
  }

  if (err instanceof Error) {
    return {
      code: 'INTERNAL_ERROR',
      statusCode: 500,
      message: err.message,
    };
  }

  return {
    code: 'INTERNAL_ERROR',
    statusCode: 500,
    message: 'An unexpected error occurred',
  };
}

// ─── Error Response Builder ─────────────────────────────────────────────────

/**
 * Convert any thrown value into a Lambda-compatible HTTP response
 * using the standard API error envelope.
 */
export function toErrorResponse(
  err: unknown,
  requestId: string,
): { statusCode: number; body: string } {
  const classified = classifyError(err);
  const envelope = buildErrorEnvelope(
    classified.code,
    classified.message,
    requestId,
    classified.details,
  );

  return {
    statusCode: classified.statusCode,
    body: JSON.stringify(envelope),
  };
}
