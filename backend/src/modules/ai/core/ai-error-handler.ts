export type AIErrorCode =
  | 'AUTHENTICATION'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'PROVIDER_UNAVAILABLE'
  | 'INVALID_REQUEST'
  | 'INVALID_RESPONSE'
  | 'CIRCUIT_OPEN'
  | 'CONFIGURATION'
  | 'UNKNOWN';

export class AIError extends Error {
  constructor(
    public readonly code: AIErrorCode,
    message: string,
    public readonly retryable: boolean,
    public readonly statusCode = 500,
    public readonly provider?: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AIError';
  }
}

function statusFromUnknown(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = Number((error as { status?: unknown }).status);
    return Number.isFinite(status) ? status : undefined;
  }
  const match = (error instanceof Error ? error.message : String(error)).match(/\b(4\d\d|5\d\d)\b/);
  return match ? Number(match[1]) : undefined;
}

export class AIErrorHandler {
  static normalize(error: unknown, provider?: string): AIError {
    if (error instanceof AIError) return error;
    const status = statusFromUnknown(error);
    const name = error instanceof Error ? error.name : '';
    if (name === 'AbortError') return new AIError('TIMEOUT', 'AI provider request timed out', true, 504, provider, error);
    if (status === 401 || status === 403) return new AIError('AUTHENTICATION', 'AI provider authentication failed', false, 502, provider, error);
    if (status === 429) return new AIError('RATE_LIMITED', 'AI provider rate limit exceeded', true, 429, provider, error);
    if (status === 400 || status === 404 || status === 422) return new AIError('INVALID_REQUEST', 'AI provider rejected the request', false, 400, provider, error);
    if (status !== undefined && status >= 500) return new AIError('PROVIDER_UNAVAILABLE', 'AI provider is temporarily unavailable', true, 503, provider, error);
    if (error instanceof SyntaxError) return new AIError('INVALID_RESPONSE', 'AI provider returned invalid structured output', false, 502, provider, error);
    return new AIError('UNKNOWN', 'AI provider request failed', true, 502, provider, error);
  }

  static publicBody(error: unknown) {
    const normalized = this.normalize(error);
    return { code: normalized.code, message: normalized.message, retryable: normalized.retryable };
  }
}
