import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ conversation: vi.fn(), states: vi.fn(), inbox: vi.fn(), targets: vi.fn(), web: vi.fn() }));
vi.mock('../../src/shared/database/prisma-client.js', () => ({ prisma: {
  conversation: { findUnique: mocks.conversation }, conversationUserState: { findMany: mocks.states }, messageNotification: { createMany: mocks.inbox },
} }));
vi.mock('../../src/modules/push/push-targets.js', () => ({ resolvePushTargetUserIds: mocks.targets }));
vi.mock('../../src/modules/push/web-push-service.js', () => ({ sendWebPushToUsers: mocks.web }));
vi.mock('../../src/modules/push/presence.js', () => ({ getUsersViewing: async () => new Set() }));
import { notifyNewInboundMessage } from '../../src/modules/push/push-service.js';

const args = { orgId: 'org', conversationId: 'conv', zaloAccountId: 'nick', privacyMode: 'sub', ownerUserId: null,
  conversationIsPrivate: false, conversationPrivateOwnerUserId: null, message: { id: 'msg', content: 'Hello' }, threadType: 'user' as const };
beforeEach(() => {
  vi.clearAllMocks(); delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON; delete process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  mocks.conversation.mockResolvedValue({ zaloNotificationsMuted: false, zaloMutedUntil: null });
  mocks.states.mockResolvedValue([]); mocks.targets.mockResolvedValue(['muted-user', 'other-user']);
});
describe('push conversation mute', () => {
  it.each(['user', 'group'] as const)('suppresses Zalo-muted %s chats before generating any notifications', async (threadType) => {
    mocks.conversation.mockResolvedValue({ zaloNotificationsMuted: true, zaloMutedUntil: null });
    await notifyNewInboundMessage({ ...args, threadType });
    expect(mocks.targets).not.toHaveBeenCalled(); expect(mocks.inbox).not.toHaveBeenCalled(); expect(mocks.web).not.toHaveBeenCalled();
  });
  it('allows notifications after Zalo mute expires', async () => {
    mocks.conversation.mockResolvedValue({ zaloNotificationsMuted: true, zaloMutedUntil: new Date(Date.now() - 1000) });
    await notifyNewInboundMessage(args);
    expect(mocks.inbox).toHaveBeenCalled(); expect(mocks.web).toHaveBeenCalled();
  });
  it('filters personal mute without affecting other employees', async () => {
    mocks.states.mockResolvedValue([{ userId: 'muted-user', flags: { notificationMute: { mode: 'forever' } } }]);
    await notifyNewInboundMessage(args);
    expect(mocks.inbox.mock.calls[0][0].data.map((row: any) => row.userId)).toEqual(['other-user']);
    expect(mocks.web.mock.calls[0][0]).toEqual(['other-user']);
  });
  it('allows expired personal mute without modifying stored settings', async () => {
    mocks.states.mockResolvedValue([{ userId: 'muted-user', flags: { notificationMute: { mode: 'until', until: new Date(Date.now() - 1000).toISOString() } } }]);
    await notifyNewInboundMessage(args);
    expect(mocks.web.mock.calls[0][0]).toEqual(['muted-user', 'other-user']);
  });
});
