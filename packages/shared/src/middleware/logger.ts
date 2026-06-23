/**
 * Structured JSON logger with correlation ID support.
 * Every log entry includes the requestId for distributed tracing.
 */

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  requestId: string;
  timestamp: string;
  [key: string]: unknown;
}

export interface Logger {
  info(message: string, extra?: Record<string, unknown>): void;
  warn(message: string, extra?: Record<string, unknown>): void;
  error(message: string, extra?: Record<string, unknown>): void;
}

/**
 * Creates a structured logger bound to a specific requestId.
 * All log output is JSON written to stdout.
 */
export function createLogger(requestId: string): Logger {
  function emit(
    level: LogLevel,
    message: string,
    extra?: Record<string, unknown>,
  ): void {
    const entry: LogEntry = {
      level,
      message,
      requestId,
      timestamp: new Date().toISOString(),
      ...extra,
    };
    process.stdout.write(JSON.stringify(entry) + '\n');
  }

  return {
    info: (message, extra) => emit('info', message, extra),
    warn: (message, extra) => emit('warn', message, extra),
    error: (message, extra) => emit('error', message, extra),
  };
}
