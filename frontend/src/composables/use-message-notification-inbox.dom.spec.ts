import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/index';
import { useMessageNotificationInbox } from './use-message-notification-inbox';

vi.mock('@/api/index', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
}));

const rows = [
  {
    id: 'notification-1', conversationId: 'conversation-a', messageId: 'message-1',
    zaloAccountId: 'account-1', title: 'Khách A', context: 'Tin nhắn riêng', preview: 'Xin báo giá',
    avatarUrl: null, readAt: null, createdAt: '2026-08-30T01:00:00.000Z',
  },
  {
    id: 'notification-2', conversationId: 'conversation-b', messageId: 'message-2',
    zaloAccountId: 'account-1', title: 'Khách B', context: 'Nhóm Bán hàng', preview: 'Đã chuyển khoản',
    avatarUrl: null, readAt: null, createdAt: '2026-08-30T00:59:00.000Z',
  },
];

describe('message notification inbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMessageNotificationInbox().stopAutoRefresh();
  });

  it('restores persisted notifications and unread count from the server', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { notifications: rows, unreadCount: 2 } } as any);
    const inbox = useMessageNotificationInbox();

    await inbox.refresh();

    expect(inbox.notifications.value).toHaveLength(2);
    expect(inbox.unreadCount.value).toBe(2);
    expect(inbox.notifications.value[0].preview).toBe('Xin báo giá');
  });

  it('marks every notification from the opened conversation as read', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { notifications: rows, unreadCount: 2 } } as any);
    vi.mocked(api.post).mockResolvedValue({ data: { updated: 1 } } as any);
    const inbox = useMessageNotificationInbox();
    await inbox.refresh();

    await inbox.markConversationRead('conversation-a');

    expect(inbox.notifications.value[0].readAt).toBeTruthy();
    expect(inbox.notifications.value[1].readAt).toBeNull();
    expect(inbox.unreadCount.value).toBe(1);
    expect(api.post).toHaveBeenCalledWith('/message-notifications/read-conversation', {
      conversationId: 'conversation-a',
    });
  });
});
