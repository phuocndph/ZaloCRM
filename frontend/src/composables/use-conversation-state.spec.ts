// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/index';
import { emptyConversationState, isConversationNotificationMuted, setConversationNotificationMute } from './use-conversation-state';

vi.mock('@/api/index', () => ({ api: { patch: vi.fn() } }));
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe('timed conversation mute', () => {
  it('expires by time without a delayed PATCH that could clear a newer device setting', async () => {
    vi.useFakeTimers();
    const until = new Date(Date.now() + 3600_000);
    const state = { ...emptyConversationState('conv'), flags: { notificationMute: { mode: 'until', until: until.toISOString() } } };
    vi.mocked(api.patch).mockResolvedValue({ data: state } as any);
    await setConversationNotificationMute('conv', until);
    expect(isConversationNotificationMuted(state)).toBe(true);
    await vi.advanceTimersByTimeAsync(3600_001);
    expect(isConversationNotificationMuted(state)).toBe(false);
    expect(api.patch).toHaveBeenCalledTimes(1);
  });
});
