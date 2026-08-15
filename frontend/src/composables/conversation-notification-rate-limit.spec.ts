import { describe, expect, it } from 'vitest';
import { createConversationNotificationRateLimiter } from './conversation-notification-rate-limit';

describe('conversation notification rate limiter', () => {
  it('only allows three notifications from one conversation per minute', () => {
    const limiter = createConversationNotificationRateLimiter();

    expect(limiter.allow('group-a', 0)).toBe(true);
    expect(limiter.allow('group-a', 5_000)).toBe(true);
    expect(limiter.allow('group-a', 10_000)).toBe(true);
    expect(limiter.allow('group-a', 15_000)).toBe(false);
  });

  it('keeps each conversation in an independent window', () => {
    const limiter = createConversationNotificationRateLimiter();

    limiter.allow('group-a', 0);
    limiter.allow('group-a', 1);
    limiter.allow('group-a', 2);
    expect(limiter.allow('group-a', 3)).toBe(false);
    expect(limiter.allow('group-b', 3)).toBe(true);
  });

  it('allows notifications again after the window expires', () => {
    const limiter = createConversationNotificationRateLimiter();

    limiter.allow('group-a', 0);
    limiter.allow('group-a', 1);
    limiter.allow('group-a', 2);
    expect(limiter.allow('group-a', 60_000)).toBe(true);
  });
});
