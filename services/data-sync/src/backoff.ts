/**
 * Exponential backoff calculator for the Data Sync Service.
 *
 * Uses base 1s, doubling, cap 60s, max 5 attempts on rate-limit responses (R15.5).
 */

export interface BackoffConfig {
  /** Base delay in milliseconds. Default: 1000 (1s). */
  baseMs: number;
  /** Maximum delay cap in milliseconds. Default: 60000 (60s). */
  maxMs: number;
  /** Maximum number of retry attempts. Default: 5. */
  maxAttempts: number;
}

const DEFAULT_CONFIG: BackoffConfig = {
  baseMs: 1000,
  maxMs: 60000,
  maxAttempts: 5,
};

/**
 * Compute the backoff delay for a given attempt number.
 *
 * @param attempt - Zero-indexed attempt number (0 = first retry).
 * @param config - Optional partial configuration overrides.
 * @returns The delay in milliseconds, or `null` if retries are exhausted.
 *
 * Formula: min(baseMs × 2^attempt, maxMs)
 * Returns null when attempt >= maxAttempts (signaling stop).
 */
export function computeBackoffMs(attempt: number, config?: Partial<BackoffConfig>): number | null {
  const { baseMs, maxMs, maxAttempts } = { ...DEFAULT_CONFIG, ...config };

  if (attempt >= maxAttempts) {
    return null;
  }

  const delay = baseMs * Math.pow(2, attempt);
  return Math.min(delay, maxMs);
}

/**
 * Wrap an async function with exponential backoff retry logic.
 *
 * Calls `fn`, and on failure waits the computed backoff delay before retrying.
 * After `maxAttempts` failures, throws the last error.
 *
 * @param fn - The async operation to retry.
 * @param config - Optional partial configuration overrides.
 * @returns The resolved value of `fn` on success.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config?: Partial<BackoffConfig>,
): Promise<T> {
  const resolvedConfig = { ...DEFAULT_CONFIG, ...config };
  let lastError: unknown;

  for (let attempt = 0; attempt < resolvedConfig.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;

      // Only wait if there is a next attempt available
      const nextAttempt = attempt + 1;
      if (nextAttempt >= resolvedConfig.maxAttempts) {
        break;
      }

      const delayMs = computeBackoffMs(attempt, resolvedConfig);
      if (delayMs !== null) {
        await sleep(delayMs);
      }
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
