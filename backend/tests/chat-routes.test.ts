/**
 * chat-routes.test.ts — Integration tests for conversation message send flow.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { mockUser, mockPrisma, mockIO } from './test-helpers.js';

const prismaMock = mockPrisma();
const sendMessageMock = vi.fn().mockResolvedValue({ msgId: 'zalo-msg-2' });
const zaloPoolMock = {
  getInstance: vi.fn(),
};


const zaloRateLimiterMock = {
  checkLimits: vi.fn(),
  recordSend: vi.fn(),
};

vi.mock('../src/shared/database/prisma-client.js', () => ({ prisma: prismaMock }));
vi.mock('../src/modules/auth/auth-middleware.js', () => ({
  authMiddleware: async (req: any) => { req.user = mockUser(); },
}));
vi.mock('../src/modules/zalo/zalo-access-middleware.js', () => ({
  requireZaloAccess: () => async () => {},
}));
vi.mock('../src/modules/zalo/zalo-pool.js', () => ({ zaloPool: zaloPoolMock }));
vi.mock('../src/modules/zalo/zalo-rate-limiter.js', () => ({ zaloRateLimiter: zaloRateLimiterMock }));
vi.mock('../src/shared/zalo-operations.js', () => ({
  zaloOps: { sendMessage: sendMessageMock },
  ZaloOpError: class ZaloOpError extends Error {
    code = 'API_ERROR';
    statusCode = 500;
    deliveryUncertain = false;
  },
  isZaloDeliveryUncertain: (error: { deliveryUncertain?: boolean; message?: string }) =>
    error?.deliveryUncertain === true || /socket timeout/i.test(error?.message ?? ''),
}));

const { chatRoutes } = await import('../src/modules/chat/chat-routes.js');

const CONV = {
  id: 'conv-1',
  orgId: 'org-1',
  threadType: 'user',
  externalThreadId: 'ext-1',
  zaloAccountId: 'za-1',
  zaloAccount: { id: 'za-1', zaloUid: 'own-1' },
};

function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.decorate('io', mockIO());
  app.register(chatRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  sendMessageMock.mockResolvedValue({ message: { msgId: 'zalo-msg-2' } });
  prismaMock.conversation.findFirst.mockResolvedValue(CONV);
  prismaMock.message.findFirst.mockResolvedValue({
    id: 'reply-1',
    zaloMsgId: 'zalo-reply-1',
    senderUid: 'contact-1',
    content: 'hello',
    contentType: 'text',
    sentAt: new Date('2026-04-17T10:00:00.000Z'),
  });
  prismaMock.message.create.mockImplementation(async ({ data }: any) => ({
    ...data,
    id: data.id || 'outbox-1',
    sentAt: data.sentAt || new Date(),
    createdAt: new Date(),
  }));
  prismaMock.message.update.mockImplementation(async ({ where, data }: any) => ({
    id: where.id,
    conversationId: CONV.id,
    senderType: 'self',
    senderName: 'Staff',
    sentAt: new Date(),
    ...data,
  }));
  prismaMock.message.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.message.findUnique.mockResolvedValue(null);
  prismaMock.conversation.update.mockResolvedValue({});
  zaloPoolMock.getInstance.mockReturnValue({
    api: {
      sendMessage: sendMessageMock,
    },
  });
  zaloRateLimiterMock.checkLimits.mockResolvedValue({ allowed: true });
  zaloRateLimiterMock.recordSend.mockReturnValue(undefined);
});

describe('POST /api/v1/conversations/:id/messages', () => {
  it('sends a reply quote when replyMessageId is provided', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations/conv-1/messages',
      payload: { content: 'thanks', replyMessageId: 'reply-1' },
    });

    expect(res.statusCode).toBe(200);
    expect(sendMessageMock).toHaveBeenCalledWith(
      'za-1',
      'ext-1',
      0,
      expect.objectContaining({
        msg: 'thanks',
        quote: expect.objectContaining({
          msgId: 'zalo-reply-1',
          cliMsgId: 'zalo-reply-1',
          uidFrom: 'contact-1',
          propertyExt: {},
        }),
      }),
      undefined,
      { maxAttempts: 1 },
    );
    expect(prismaMock.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ quote: expect.objectContaining({ msgId: 'zalo-reply-1' }) }),
    }));
  });

  it('creates a durable outbox row before sending and finalizes that same row', async () => {
    sendMessageMock.mockResolvedValueOnce({ message: { msgId: 'zalo-msg-race' } });

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations/conv-1/messages',
      payload: { content: 'thanks', echoId: 'echo-race-1' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(expect.objectContaining({
      zaloMsgId: 'zalo-msg-race',
      echoId: 'echo-race-1',
    }));
    expect(prismaMock.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        clientEchoId: 'echo-race-1',
        deliveryState: 'submitting',
      }),
    }));
    expect(prismaMock.message.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        clientEchoId: 'echo-race-1',
        sentVia: 'user',
        deliveryState: 'completed',
      }),
    }));
  });

  it('merges a self-listener row that wins the finalization race', async () => {
    const outbox = {
      id: 'outbox-race-1',
      conversationId: CONV.id,
      senderType: 'self',
      content: 'race message',
      contentType: 'text',
      sentAt: new Date(),
      zaloMsgId: null,
      zaloMsgIdNum: null,
      clientEchoId: 'echo-listener-race-1',
      deliveryState: 'submitting',
    };
    const listenerRow = {
      ...outbox,
      id: 'listener-race-1',
      zaloMsgId: 'zalo-listener-race-1',
      clientEchoId: 'echo-listener-race-1',
      deliveryState: 'completed',
    };
    sendMessageMock.mockResolvedValueOnce({ message: { msgId: listenerRow.zaloMsgId } });
    prismaMock.message.create.mockResolvedValueOnce(outbox);
    prismaMock.message.update
      .mockRejectedValueOnce({ code: 'P2002' })
      .mockResolvedValueOnce(listenerRow);
    prismaMock.message.findFirst.mockResolvedValueOnce({ id: listenerRow.id });
    prismaMock.message.delete.mockResolvedValueOnce(outbox);

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations/conv-1/messages',
      payload: { content: 'race message', echoId: 'echo-listener-race-1' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(expect.objectContaining({
      id: listenerRow.id,
      zaloMsgId: listenerRow.zaloMsgId,
      echoId: 'echo-listener-race-1',
    }));
    expect(prismaMock.message.delete).toHaveBeenCalledWith({ where: { id: outbox.id } });
    expect(prismaMock.message.update).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: listenerRow.id },
      data: expect.objectContaining({ clientEchoId: 'echo-listener-race-1' }),
    }));
  });

  it('accepts a top-level msgId returned by the Zalo SDK', async () => {
    sendMessageMock.mockResolvedValueOnce({ msgId: 'zalo-top-level-1' });

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations/conv-1/messages',
      payload: { content: 'top level response', echoId: 'echo-top-level-1' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(expect.objectContaining({
      zaloMsgId: 'zalo-top-level-1',
      echoId: 'echo-top-level-1',
    }));
  });

  it('treats a lost SDK response as success when self-listener confirms the send', async () => {
    const accepted = {
      id: 'listener-confirmed-1',
      content: 'sent despite timeout',
      contentType: 'text',
      zaloMsgId: 'zalo-confirmed-1',
      zaloMsgIdNum: BigInt(456),
      sentAt: new Date(),
      senderType: 'self',
      clientEchoId: 'echo-confirmed-1',
    };
    sendMessageMock.mockRejectedValueOnce(new Error('socket timeout'));
    prismaMock.message.create.mockResolvedValueOnce({
      ...accepted,
      zaloMsgId: null,
      zaloMsgIdNum: null,
      deliveryState: 'submitting',
    });
    prismaMock.message.findUnique.mockResolvedValueOnce({
      id: accepted.id,
      zaloMsgId: accepted.zaloMsgId,
      deliveryState: 'accepted',
    });
    prismaMock.message.update.mockResolvedValueOnce(accepted);

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations/conv-1/messages',
      payload: { content: 'sent despite timeout', echoId: 'echo-confirmed-1' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(expect.objectContaining({
      id: accepted.id,
      zaloMsgId: accepted.zaloMsgId,
      zaloMsgIdNum: '456',
      echoId: 'echo-confirmed-1',
    }));
    expect(prismaMock.message.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.message.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: accepted.id },
      data: expect.objectContaining({ clientEchoId: 'echo-confirmed-1', sentVia: 'user' }),
    }));
  });

  it('returns pending confirmation instead of a false 500 for an ambiguous timeout', async () => {
    const placeholder = {
      id: 'outbox-uncertain-1',
      conversationId: CONV.id,
      content: 'timeout message',
      contentType: 'text',
      zaloMsgId: null,
      zaloMsgIdNum: null,
      senderType: 'self',
      sentAt: new Date(),
      clientEchoId: 'echo-uncertain-1',
      deliveryState: 'submitting',
      deliveryLeaseId: 'lease-uncertain-1',
    };
    sendMessageMock.mockRejectedValueOnce(new Error('socket timeout'));
    prismaMock.message.create.mockResolvedValueOnce(placeholder);
    prismaMock.message.findUnique.mockResolvedValue(placeholder);

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations/conv-1/messages',
      payload: { content: 'timeout message', echoId: 'echo-uncertain-1' },
    });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual(expect.objectContaining({
      id: placeholder.id,
      echoId: 'echo-uncertain-1',
      pendingConfirmation: true,
    }));
    expect(prismaMock.message.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ deliveryState: 'uncertain' }),
    }));
  });

  it('sends equal text twice when the client echo ids are different', async () => {
    const app = buildApp();
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations/conv-1/messages',
      payload: { content: 'Ok', echoId: 'echo-ok-1' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations/conv-1/messages',
      payload: { content: 'Ok', echoId: 'echo-ok-2' },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(sendMessageMock).toHaveBeenCalledTimes(2);
    expect(prismaMock.message.create).toHaveBeenCalledTimes(2);
  });
});

describe('GET /api/v1/conversations/:id/messages', () => {
  it('returns and consumes a stable timestamp/Snowflake/id cursor', async () => {
    const sentAt = new Date('2026-08-18T03:00:00.000Z');
    prismaMock.conversation.findFirst.mockResolvedValueOnce({
      id: CONV.id,
      isPrivate: false,
      privateOwnerUserId: null,
      zaloAccount: {
        privacyMode: 'sub',
        ownerUserId: 'user-1',
        displayName: 'Nick A',
        avatarUrl: null,
      },
    });
    prismaMock.message.findMany.mockResolvedValueOnce(Array.from({ length: 26 }, (_, index) => ({
      id: `message-${String(26 - index).padStart(2, '0')}`,
      zaloMsgId: String(1026 - index),
      zaloMsgIdNum: BigInt(1026 - index),
      senderUid: null,
      senderName: 'Staff',
      content: `message ${index}`,
      contentType: 'text',
      senderType: 'self',
      sentAt,
      isDeleted: false,
      originalContent: null,
      editedAt: null,
      deliveredAt: null,
      seenAt: null,
      quote: null,
      attachments: [],
      albumKey: null,
      albumIndex: null,
      albumTotal: null,
      reactions: [],
      repliedByUserId: null,
      repliedBy: null,
      isLocal: false,
      metadata: null,
      sentVia: 'user',
      mentions: [],
    })));

    const app = buildApp();
    const first = await app.inject({
      method: 'GET',
      url: '/api/v1/conversations/conv-1/messages?limit=25',
    });

    expect(first.statusCode).toBe(200);
    const firstBody = first.json();
    expect(firstBody.hasMore).toBe(true);
    const decoded = JSON.parse(Buffer.from(firstBody.nextCursor, 'base64url').toString('utf8'));
    expect(decoded).toEqual({
      id: 'message-02',
      sentAt: sentAt.toISOString(),
      zaloMsgIdNum: '1002',
    });
    expect(prismaMock.message.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [
        { sentAt: 'desc' },
        { zaloMsgIdNum: { sort: 'desc', nulls: 'first' } },
        { id: 'desc' },
      ],
      take: 26,
    }));

    prismaMock.conversation.findFirst.mockResolvedValueOnce({
      id: CONV.id,
      isPrivate: false,
      privateOwnerUserId: null,
      zaloAccount: { privacyMode: 'sub', ownerUserId: 'user-1', displayName: 'Nick A', avatarUrl: null },
    });
    prismaMock.message.findMany.mockResolvedValueOnce([]);
    const second = await app.inject({
      method: 'GET',
      url: `/api/v1/conversations/conv-1/messages?limit=25&cursor=${encodeURIComponent(firstBody.nextCursor)}`,
    });

    expect(second.statusCode).toBe(200);
    expect(prismaMock.message.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        conversationId: CONV.id,
        OR: [
          { sentAt: { lt: sentAt } },
          {
            sentAt,
            AND: [{
              OR: [
                { zaloMsgIdNum: { lt: BigInt(1002) } },
                { zaloMsgIdNum: BigInt(1002), id: { lt: 'message-02' } },
              ],
            }],
          },
        ],
      }),
      skip: 0,
    }));
    await app.close();
  });
});
