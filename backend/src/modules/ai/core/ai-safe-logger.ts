import { createHash } from 'node:crypto';
import { logger } from '../../../shared/utils/logger.js';

type SafeLogFields = {
  requestId?: string;
  orgId?: string;
  provider?: string;
  model?: string;
  taskType?: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  status?: string;
  errorCode?: string;
  attempt?: number;
  contentHash?: string;
};

const SECRET_PATTERN = /(api[-_ ]?key|authorization|token|secret|password|credential)/i;

export class AISafeLogger {
  static hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  static sanitize(fields: Record<string, unknown>): SafeLogFields {
    const safe: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (SECRET_PATTERN.test(key)) continue;
      if (['prompt', 'messages', 'content', 'response', 'raw', 'body'].includes(key.toLowerCase())) continue;
      if (value === undefined || value === null || ['string', 'number', 'boolean'].includes(typeof value)) safe[key] = value;
    }
    return safe as SafeLogFields;
  }

  info(event: string, fields: Record<string, unknown> = {}) {
    logger.info('[ai-core]', event, AISafeLogger.sanitize(fields));
  }

  warn(event: string, fields: Record<string, unknown> = {}) {
    logger.warn('[ai-core]', event, AISafeLogger.sanitize(fields));
  }

  error(event: string, fields: Record<string, unknown> = {}) {
    logger.error('[ai-core]', event, AISafeLogger.sanitize(fields));
  }
}

export const aiSafeLogger = new AISafeLogger();
