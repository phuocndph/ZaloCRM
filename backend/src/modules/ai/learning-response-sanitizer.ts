const OMITTED_KEY =
  /(?:encrypted|cipher|credential|authorization|cookie|password|secret|api.?key|access.?token|refresh.?token)/i;

const PHONE = /\b(?:\+?84|0)(?:\d[ .-]?){8,10}\b/g;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const SECRET =
  /\b(?:otp|mã xác thực|password|mật khẩu|token|api[_ -]?key)\s*[:=]?\s*\S+/gi;
const LONG_NUMBER = /\b(?:\d[ -]?){12,19}\b/g;

function redactString(value: string) {
  return value
    .replace(PHONE, '[PHONE_REDACTED]')
    .replace(EMAIL, '[EMAIL_REDACTED]')
    .replace(SECRET, '[SECRET_REDACTED]')
    .replace(LONG_NUMBER, '[NUMBER_REDACTED]')
    .slice(0, 4_000);
}

/**
 * Defense-in-depth sanitizer for every Learning API response.
 * It handles legacy candidate payloads that predate recursive redaction and
 * prevents encrypted buffers or credentials from crossing the HTTP boundary.
 */
export function sanitizeLearningResponse(
  value: unknown,
  depth = 0,
): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 8) return '[MAX_DEPTH_REDACTED]';
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) return undefined;

  if (Array.isArray(value)) {
    return value
      .slice(0, 100)
      .map((item) => sanitizeLearningResponse(item, depth + 1))
      .filter((item) => item !== undefined);
  }

  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>).slice(
      0,
      150,
    );

    for (const [key, item] of entries) {
      if (OMITTED_KEY.test(key)) continue;
      const sanitized = sanitizeLearningResponse(item, depth + 1);
      if (sanitized !== undefined) output[key] = sanitized;
    }

    return output;
  }

  return undefined;
}
