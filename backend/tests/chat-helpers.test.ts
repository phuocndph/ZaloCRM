import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockPrisma } from './test-helpers.js';

const prismaMock = mockPrisma();

vi.mock('../src/shared/database/prisma-client.js', () => ({ prisma: prismaMock }));

const { acquireMediaOutbox, createMediaMessage } = await import('../src/modules/chat/chat-helpers.js');

const baseInput = {
  conversationId: 'conv-1',
  zaloAccount: { zaloUid: 'own-zalo-1' },
  repliedByUserId: 'user-1',
  zaloMsgId: '9001',
  contentType: 'image' as const,
  content: JSON.stringify({ href: '/files/image.webp' }),
  metadata: { sendStatus: 'sent' },
  sentVia: 'user',
  clientEchoId: 'attachment-echo-1',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createMediaMessage', () => {
  it('finalizes the durable attachment placeholder by client echo id', async () => {
    prismaMock.message.findUnique.mockResolvedValueOnce({ id: 'placeholder-1' });
    prismaMock.message.update.mockResolvedValueOnce({ id: 'placeholder-1', ...baseInput });

    const result = await createMediaMessage(baseInput);

    expect(result.id).toBe('placeholder-1');
    expect(prismaMock.message.create).not.toHaveBeenCalled();
    expect(prismaMock.message.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'placeholder-1' },
      data: expect.objectContaining({
        zaloMsgId: '9001',
        zaloMsgIdNum: BigInt(9001),
        clientEchoId: 'attachment-echo-1',
        content: baseInput.content,
      }),
    }));
  });

  it('merges the placeholder when the Zalo listener inserted the accepted row first', async () => {
    prismaMock.message.findUnique.mockResolvedValueOnce({ id: 'placeholder-1' });
    prismaMock.message.update
      .mockRejectedValueOnce({ code: 'P2002' })
      .mockResolvedValueOnce({ id: 'listener-row-1', ...baseInput });
    prismaMock.message.findFirst.mockResolvedValueOnce({ id: 'listener-row-1' });
    prismaMock.message.delete.mockResolvedValueOnce({ id: 'placeholder-1' });

    const result = await createMediaMessage(baseInput);

    expect(result.id).toBe('listener-row-1');
    expect(prismaMock.message.delete).toHaveBeenCalledWith({ where: { id: 'placeholder-1' } });
    expect(prismaMock.message.update).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: 'listener-row-1' },
      data: expect.objectContaining({ clientEchoId: 'attachment-echo-1' }),
    }));
  });
});

describe('acquireMediaOutbox', () => {
  it('creates and owns a new durable outbox row before the Zalo call', async () => {
    const prepared = {
      id: 'outbox-1',
      ...baseInput,
      zaloMsgId: null,
      sentAt: new Date(),
      metadata: { outboundAttachment: { status: 'submitting' } },
    };
    prismaMock.message.create.mockResolvedValueOnce(prepared);

    const result = await acquireMediaOutbox({ ...baseInput, zaloMsgId: '', metadata: prepared.metadata });

    expect(result).toEqual({ state: 'acquired', message: prepared, leaseId: expect.any(String) });
    expect(prismaMock.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        zaloMsgId: null,
        clientEchoId: baseInput.clientEchoId,
        metadata: prepared.metadata,
      }),
    }));
  });

  it('does not let a concurrent request acquire a recent submitting row', async () => {
    const existing = {
      id: 'outbox-1',
      zaloMsgId: null,
      sentAt: new Date(),
      deliveryState: 'submitting',
      deliveryLeaseId: 'lease-active',
      deliveryLeaseUntil: new Date(Date.now() + 60_000),
      metadata: { outboundAttachment: { status: 'submitting' } },
    };
    prismaMock.message.create.mockRejectedValueOnce({ code: 'P2002' });
    prismaMock.message.findUnique.mockResolvedValueOnce(existing);

    const result = await acquireMediaOutbox({ ...baseInput, zaloMsgId: '', metadata: existing.metadata });

    expect(result).toEqual({ state: 'in_progress', message: existing, leaseId: null });
    expect(prismaMock.message.updateMany).not.toHaveBeenCalled();
  });

  it('returns an already accepted row without acquiring it again', async () => {
    const existing = {
      id: 'outbox-1',
      zaloMsgId: '9001',
      sentAt: new Date(),
      metadata: { outboundAttachment: { status: 'zalo_accepted' } },
    };
    prismaMock.message.create.mockRejectedValueOnce({ code: 'P2002' });
    prismaMock.message.findUnique.mockResolvedValueOnce(existing);

    const result = await acquireMediaOutbox({ ...baseInput, zaloMsgId: '', metadata: existing.metadata });

    expect(result).toEqual({ state: 'accepted', message: existing, leaseId: null });
    expect(prismaMock.message.updateMany).not.toHaveBeenCalled();
  });

  it('reclaims a stale failed row with compare-and-swap', async () => {
    const existing = {
      id: 'outbox-1',
      zaloMsgId: null,
      sentAt: new Date(Date.now() - 60_000),
      deliveryState: 'failed',
      deliveryLeaseId: null,
      deliveryLeaseUntil: null,
      metadata: { outboundAttachment: { status: 'failed' } },
    };
    const reclaimed = {
      ...existing,
      deliveryState: 'submitting',
      deliveryLeaseId: 'lease-retry',
      deliveryLeaseUntil: new Date(Date.now() + 60_000),
      metadata: { outboundAttachment: { status: 'submitting' } },
    };
    prismaMock.message.create.mockRejectedValueOnce({ code: 'P2002' });
    prismaMock.message.findUnique
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(reclaimed);
    prismaMock.message.updateMany.mockResolvedValueOnce({ count: 1 });

    const result = await acquireMediaOutbox({ ...baseInput, zaloMsgId: '', metadata: reclaimed.metadata });

    expect(result).toEqual({ state: 'acquired', message: reclaimed, leaseId: expect.any(String) });
    expect(prismaMock.message.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: existing.id, zaloMsgId: null, deliveryState: 'failed' }),
    }));
  });

  it('turns an expired submitting lease into uncertain instead of replaying it', async () => {
    const existing = {
      id: 'outbox-stale',
      zaloMsgId: null,
      sentAt: new Date(Date.now() - 700_000),
      deliveryState: 'submitting',
      deliveryLeaseId: 'lease-stale',
      deliveryLeaseUntil: new Date(Date.now() - 1_000),
      metadata: { outboundAttachment: { status: 'submitting' } },
    };
    const uncertain = {
      ...existing,
      deliveryState: 'uncertain',
      deliveryLeaseId: null,
      deliveryLeaseUntil: null,
    };
    prismaMock.message.create.mockRejectedValueOnce({ code: 'P2002' });
    prismaMock.message.findUnique
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(uncertain);
    prismaMock.message.updateMany.mockResolvedValueOnce({ count: 1 });

    const result = await acquireMediaOutbox({ ...baseInput, zaloMsgId: '', metadata: existing.metadata });

    expect(result).toEqual({ state: 'uncertain', message: uncertain, leaseId: null });
    expect(prismaMock.message.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ deliveryState: 'uncertain' }),
    }));
  });
});
