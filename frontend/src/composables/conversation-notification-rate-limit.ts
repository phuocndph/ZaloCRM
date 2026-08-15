export interface ConversationNotificationRateLimiter {
  allow(conversationId: string, now?: number): boolean;
  reset(): void;
}

interface RateLimitWindow {
  startedAt: number;
  count: number;
}

/** Limits noisy notification bursts independently for each conversation. */
export function createConversationNotificationRateLimiter(
  limit = 3,
  windowMs = 60_000,
): ConversationNotificationRateLimiter {
  const windows = new Map<string, RateLimitWindow>();

  return {
    allow(conversationId: string, now = Date.now()): boolean {
      const current = windows.get(conversationId);
      if (!current || now - current.startedAt >= windowMs) {
        windows.set(conversationId, { startedAt: now, count: 1 });
        return true;
      }

      if (current.count >= limit) return false;
      current.count += 1;
      return true;
    },
    reset() {
      windows.clear();
    },
  };
}
