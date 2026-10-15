import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { mockPrisma, mockUser } from './test-helpers.js';

const prisma = mockPrisma();
const scope = vi.fn();
vi.mock('../src/shared/database/prisma-client.js', () => ({ prisma }));
vi.mock('../src/modules/auth/auth-middleware.js', () => ({ authMiddleware: async (request: any) => { request.user = mockUser(); } }));
vi.mock('../src/modules/zalo/zalo-scope.js', () => ({ DISPLAYABLE_NICK_WHERE: {}, getZaloScope: scope }));
vi.mock('../src/modules/chat/conversation-state-service.js', () => ({ getState: async () => ({ flags: {} }) }));
vi.mock('../src/modules/privacy/redact.js', async (original) => ({
  ...await original<typeof import('../src/modules/privacy/redact.js')>(),
  buildPrivacyContext: async () => ({ viewerUserId: 'user-1', orgId: 'org-1', privacyUnlocked: false }),
}));
const { chatRoutes } = await import('../src/modules/chat/chat-routes.js');
beforeEach(() => {
  vi.clearAllMocks();
  scope.mockResolvedValue({ isOrgAdmin: false, displayableIds: ['nick'] });
  prisma.conversation.findFirst.mockResolvedValue({ id: 'conv', orgId: 'org-1', threadType: 'user', contactId: 'customer', externalThreadId: 'customer-uid',
    zaloAccountId: 'nick', zaloAccount: { id: 'nick', privacyMode: 'sub' }, isPrivate: false, contact: { id: 'customer', avatarUrl: null }, pins: [] });
  const friend: Record<string, unknown> = { id: 'friend', aliasInNick: 'Khách Lan', zaloDisplayName: 'Lan', zaloAvatarUrl: 'https://cdn.example.com/lan.jpg' };
  prisma.friend.findUnique.mockImplementation(async ({ select }: { select: Record<string, boolean> }) =>
    Object.fromEntries(Object.keys(select).map((key) => [key, friend[key] ?? null])));
});
describe('conversation profile for desktop notifications', () => {
  it('returns per-nick avatar/name even when the contact avatar is missing', async () => {
    const app = Fastify(); app.register(chatRoutes);
    try {
      const response = await app.inject({ method: 'GET', url: '/api/v1/conversations/conv' });
      expect(response.statusCode).toBe(200);
      expect(response.json().friendship).toMatchObject({ zaloDisplayName: 'Lan', zaloAvatarUrl: 'https://cdn.example.com/lan.jpg' });
      expect(prisma.friend.findUnique).toHaveBeenCalledWith(expect.objectContaining({
        where: { zaloAccountId_zaloUidInNick: { zaloAccountId: 'nick', zaloUidInNick: 'customer-uid' } },
        select: expect.objectContaining({ zaloDisplayName: true, zaloAvatarUrl: true }),
      }));
    } finally { await app.close(); }
  });
  it('does not return or fetch a friend avatar outside the viewer nick scope', async () => {
    scope.mockResolvedValue({ isOrgAdmin: false, displayableIds: [] });
    const app = Fastify(); app.register(chatRoutes);
    try {
      const response = await app.inject({ method: 'GET', url: '/api/v1/conversations/conv' });
      expect(response.statusCode).toBe(403); expect(prisma.friend.findUnique).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});
