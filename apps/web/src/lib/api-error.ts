/**
 * Structured API error surfacing code, message, field-level details, and the request ID.
 */
export class ApiClientError extends Error {
  public readonly code: string;
  public readonly details?: Record<string, unknown>;
  public readonly requestId: string;

  constructor(opts: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    requestId: string;
  }) {
    super(opts.message);
    this.name = 'ApiClientError';
    this.code = opts.code;
    this.details = opts.details;
    this.requestId = opts.requestId;
  }

  /**
   * Returns field-level validation errors from the details object, if present.
   * Useful for surfacing inline form errors.
   */
  getFieldErrors(): Record<string, string> | undefined {
    if (!this.details) return undefined;
    const fields = this.details['fields'];
    if (fields && typeof fields === 'object') {
      return fields as Record<string, string>;
    }
    return undefined;
  }
}
