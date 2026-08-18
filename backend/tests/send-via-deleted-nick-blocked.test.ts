/**
 * send-via-deleted-nick-blocked.test.ts — Hồi quy: CHẶN GỬI qua nick ĐÃ XÓA (archivedAt).
 *
 * Vòng đời nick Zalo (T7 YC2 2026-06-20): POST /:id/messages — nếu
 * conversation.zaloAccount.archivedAt != null → 409 NICK_ARCHIVED, ĐẶT TRƯỚC mọi nhánh
 * tạo Message. Bất biến:
 *   • nick đã xóa → 409, error chứa 'xóa', KHÔNG message.create / conversation.update /
 *     api.sendMessage.
 *   • nick còn sống → 200, message.create ĐƯỢC gọi.
 *
 * DRIVING qua Fastify inject (convention chat-operations-routes).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { mockUser, mockPrisma, mockIO } from './test-helpers.js';

const prismaMock = mockPrisma();
const sendMessageMock = vi.fn().mockResolvedValue({ message: { msgId: 'zmsg-1' } });
const getInstanceMock = vi.fn(() => ({ api: { sendMessage: sendMessageMock } }));

vi.mock('../src/shared/database/prisma-client.js', () => ({
  prisma: prismaMock,
  tenantTransaction: vi.fn(),
}));
vi.mock('@prisma/client', () => ({ Prisma: { JsonNull: 'JSON_NULL', DbNull: 'DB_NULL' } }));
vi.mock('../src/modules/auth/auth-middleware.js', () => ({
  authMiddleware: async (req: any) => { req.user = mockUser(); },
}));
vi.mock('../src/modules/rbac/rbac-middleware.js', () => ({ requireGrant: () => async () => {} }));
vi.mock('../src/modules/zalo/zalo-access-middleware.js', () => ({
  requireZaloAccess: () => async (req: any) => { req.user = req.user ?? mockUser(); },
}));
vi.mock('../src/modules/zalo/zalo-pool.js', () => ({
  zaloPool: { getInstance: getInstanceMock },
}));
vi.mock('../src/modules/zalo/zalo-rate-limiter.js', () => ({
  zaloRateLimiter: {
    checkLimits: vi.fn().mockResolvedValue({ allowed: true }),
    recordSend: vi.fn(),
  },
}));
vi.mock('../src/shared/realtime/emit-chat.js', () => ({ emitChatMessage: vi.fn() }));
vi.mock('../src/modules/contacts/contact-aggregate.js', () => ({
  applyContactAggregateFromMessage: vi.fn(), applyFriendAggregate: vi.fn(),
}));
vi.mock('../src/modules/ai/ai-virtual-chat-service.js', () => ({ triggerVirtualChatAiReply: vi.fn() }));
vi.mock('../src/modules/contacts/contact-scope.js', () => ({ attachContactCollaboratorByUser: vi.fn() }));
vi.mock('../src/modules/chat/chat-helpers.js', () => ({ getUserFullName: vi.fn().mockResolvedValue('Sale A') }));
vi.mock('../src/shared/zalo-operations.js', () => ({
  zaloOps: { sendMessage: sendMessageMock },
  ZaloOpError: class ZaloOpError extends Error {
    code = 'API_ERROR';
    statusCode = 500;
  },
}));
vi.mock('../src/shared/video-processor.js', () => ({ sendNativeVideo: vi.fn() }));
vi.mock('../src/modules/chat/chat-media-helpers.js', () => ({ downloadMediaToTemp: vi.fn(), extractZaloMsgId: vi.fn() }));
vi.mock('../src/modules/automation/blocks/resolve-block-content.js', () => ({ resolveBlockContent: vi.fn() }));
vi.mock('../src/modules/automation/blocks/render-template.js', () => ({
  renderTemplate: vi.fn(), renderTemplateDetailed: vi.fn(), shiftStylesForRender: vi.fn(),
}));
vi.mock('../src/modules/media/media-routes.js', () => ({ buildSendFileName: vi.fn() }));
vi.mock('../src/modules/media/media-service.js', () => ({ bumpUsage: vi.fn() }));
vi.mock('../src/modules/rbac/owner-scope.js', () => ({ getOwnerScope: vi.fn() }));
vi.mock('../src/modules/automation/blocks/block-visibility.js', () => ({ blockVisibilityWhere: vi.fn(() => ({})) }));

const { chatRoutes } = await import('../src/modules/chat/chat-routes.js');

const DELETED_CONV = {
  id: 'conv-del', orgId: 'org-1', isVirtual: false, externalThreadId: 'ext-1',
  threadType: 'user', zaloAccountId: 'za-del', contactId: 'c1',
  zaloAccount: {
    archivedAt: new Date(), zaloUid: 'x', privacyMode: 'sub',
    ownerUserId: 'user-1', status: 'disconnected',
  },
};
const LIVE_CONV = {
  id: 'conv-live', orgId: 'org-1', isVirtual: false, externalThreadId: 'ext-2',
  threadType: 'user', zaloAccountId: 'za-live', contactId: 'c2',
  zaloAccount: {
    archivedAt: null, zaloUid: 'y', privacyMode: 'sub',
    ownerUserId: 'user-1', status: 'connected',
  },
};

function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.decorate('io', mockIO());
  app.register(chatRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.message.findUnique.mockResolvedValue(null);
  prismaMock.message.create.mockImplementation(async ({ data }: any) => ({ ...data, repliedBy: null }));
  prismaMock.conversation.update.mockResolvedValue({});
});

describe('POST /:id/messages — CHẶN GỬI nick đã xóa', () => {
  it('nick đã XÓA → 409 NICK_ARCHIVED, KHÔNG create/update/sendMessage', async () => {
    prismaMock.conversation.findFirst.mockResolvedValue(DELETED_CONV);
    const app = buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/v1/conversations/conv-del/messages', payload: { content: 'hi' },
    });
    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.code).toBe('NICK_ARCHIVED');
    expect(body.error).toContain('xóa'); // "Nick này đã bị xóa — ..."
    expect(prismaMock.message.create).not.toHaveBeenCalled();
    expect(prismaMock.conversation.update).not.toHaveBeenCalled();
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('nick còn SỐNG → 200, message.create ĐƯỢC gọi', async () => {
    prismaMock.conversation.findFirst.mockResolvedValue(LIVE_CONV);
    const app = buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/v1/conversations/conv-live/messages', payload: { content: 'hi' },
    });
    expect(res.statusCode).toBe(200);
    expect(prismaMock.message.create).toHaveBeenCalled();
    expect(sendMessageMock).toHaveBeenCalled();
  });
});
