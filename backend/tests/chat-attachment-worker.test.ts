import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockPrisma } from './test-helpers.js';

const db = mockPrisma();
vi.mock('../src/shared/database/prisma-client.js', () => ({ prisma: db }));
vi.mock('node:fs/promises', () => ({ access: vi.fn(), mkdir: vi.fn(), readFile: vi.fn(), rm: vi.fn(), copyFile: vi.fn(), readdir: vi.fn(), stat: vi.fn() }));
vi.mock('../src/shared/utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../src/modules/zalo/zalo-pool.js', () => ({ zaloPool: { getInstance: vi.fn(), getIO: vi.fn(), getAllStatuses: vi.fn() } }));
vi.mock('../src/modules/zalo/zalo-access-middleware.js', () => ({ hasZaloAccess: vi.fn() }));
vi.mock('../src/shared/zalo-operations.js', () => {
  class ZaloDeliveryUncertainError extends Error {}
  return { ZaloDeliveryUncertainError,
    isDeterministicZaloRejection: () => false,
    isZaloDeliveryUncertain: (error: unknown) => error instanceof ZaloDeliveryUncertainError,
    zaloOps: { sendFile: vi.fn(), sendImage: vi.fn() } };
});
vi.mock('../src/shared/storage/minio-client.js', () => ({ uploadBuffer: vi.fn(), uploadFile: vi.fn() }));
vi.mock('../src/shared/storage/storage-ledger.js', () => ({ recordMessageStorageReferences: vi.fn() }));
vi.mock('../src/modules/media/media-service.js', () => ({ compressImage: vi.fn() }));
vi.mock('../src/shared/video-processor.js', () => ({ generateThumbnail: vi.fn(), sendNativeVideo: vi.fn() }));
vi.mock('../src/modules/ai/conversation-analysis-queue.js', () => ({ enqueueConversationAnalysis: vi.fn() }));
vi.mock('../src/shared/realtime/emit-chat.js', () => ({ emitChatMessage: vi.fn() }));
vi.mock('../src/modules/chat/chat-helpers.js', async (original) => ({
  ...await original<typeof import('../src/modules/chat/chat-helpers.js')>(), createMediaMessage: vi.fn(),
}));

const { processAttachment, recoverAttachmentLeases, mirrorAttachment, sourcePath, queueAttachment } = await import('../src/modules/chat/chat-attachment-outbox.js');
const { zaloOps, ZaloDeliveryUncertainError } = await import('../src/shared/zalo-operations.js');
const { zaloPool } = await import('../src/modules/zalo/zalo-pool.js');
const { hasZaloAccess } = await import('../src/modules/zalo/zalo-access-middleware.js');
const { createMediaMessage } = await import('../src/modules/chat/chat-helpers.js');
const { access, readFile, rm } = await import('node:fs/promises');
const { uploadBuffer, uploadFile } = await import('../src/shared/storage/minio-client.js');
const { recordMessageStorageReferences } = await import('../src/shared/storage/storage-ledger.js');
const { enqueueConversationAnalysis } = await import('../src/modules/ai/conversation-analysis-queue.js');

const source = { sourceId: '12345678-1234-1234-1234-123456789abc', filename: 'quote.pdf', mime: 'application/pdf', size: 4, kind: 'file' as const };
const destination = { orgId: 'org', accountId: 'nick', threadId: 'customer-per-nick', threadType: 0 as const };
let row: any;

beforeEach(() => {
  vi.resetAllMocks();
  row = { id: 'outbox', conversationId: 'conversation', clientEchoId: 'echo', repliedByUserId: 'sender',
    contentType: 'file', senderUid: 'self', content: JSON.stringify({ title: 'caption', name: 'quote.pdf', href: '' }),
    sentAt: new Date(), zaloMsgId: null, deliveryState: 'prepared', deliveryLeaseId: null, deliveryLeaseUntil: null,
    metadata: { outboundAttachment: { ...source, destination, status: 'queued' }, sendStatus: 'queued' } };
  db.$transaction.mockImplementation(async (callback: (tx: any) => unknown) => callback(db));
  db.message.findFirst.mockResolvedValue(null);
  db.message.findUnique.mockImplementation(async () => ({ ...row }));
  db.message.findUniqueOrThrow.mockImplementation(async () => ({ ...row }));
  db.message.findMany.mockImplementation(async () => [{ ...row }]);
  db.message.updateMany.mockImplementation(async ({ where, data }: any) => {
    for (const field of ['id', 'zaloMsgId', 'deliveryState', 'deliveryLeaseId', 'deliveryLeaseUntil']) {
      if (!(field in where)) continue;
      if (where[field]?.in ? !where[field].in.includes(row[field]) : String(where[field]) !== String(row[field])) return { count: 0 };
    }
    row = { ...row, ...data };
    return { count: 1 };
  });
  db.message.update.mockImplementation(async ({ data }: any) => (row = { ...row, ...data }));
  const conversation = { id: 'conversation', orgId: 'org', zaloAccountId: 'nick', externalThreadId: 'customer-per-nick', threadType: 'user',
    isPrivate: false, zaloAccount: { zaloUid: 'self', privacyMode: 'sub', archivedAt: null } };
  db.conversation.findUnique.mockResolvedValue(conversation);
  db.conversation.findUniqueOrThrow.mockResolvedValue(conversation);
  db.conversation.update.mockResolvedValue({});
  db.user.findUnique.mockResolvedValue({ id: 'sender', orgId: 'org', role: 'admin', isActive: true });
  vi.mocked(zaloPool.getInstance).mockReturnValue({ api: {}, status: 'connected' } as any);
  vi.mocked(hasZaloAccess).mockResolvedValue(true);
  vi.mocked(access).mockResolvedValue(undefined);
  vi.mocked(readFile).mockResolvedValue(Buffer.from('data') as never);
  vi.mocked(rm).mockResolvedValue(undefined);
  vi.mocked(zaloOps.sendFile).mockResolvedValue({ message: { msgId: 'caption-id' }, attachment: [{ msgId: 'file-id' }] } as never);
  vi.mocked(createMediaMessage).mockImplementation(async (input) => {
    row = { ...row, zaloMsgId: input.zaloMsgId, deliveryState: 'accepted', deliveryLeaseId: null, deliveryLeaseUntil: null,
      metadata: input.metadata, content: input.content };
    return { ...row };
  });
  vi.mocked(uploadBuffer).mockResolvedValue({ url: '/files/media/quote.pdf', key: 'media/quote.pdf', size: 4, mimeType: 'application/pdf', contentHash: 'hash', deduped: false });
  vi.mocked(uploadFile).mockResolvedValue({ url: '/files/media/quote.pdf', key: 'media/quote.pdf', size: 4, mimeType: 'application/pdf', contentHash: 'hash', deduped: false });
  vi.mocked(recordMessageStorageReferences).mockResolvedValue(undefined as never);
  vi.mocked(enqueueConversationAnalysis).mockResolvedValue(undefined as never);
});

describe('durable attachment worker', () => {
  it('persists acceptance before mirroring and uses the actual file ID', async () => {
    await processAttachment('outbox', 'nick');
    expect(zaloOps.sendFile).toHaveBeenCalledTimes(1);
    expect(row.deliveryState).toBe('accepted');
    expect(row.zaloMsgId).toBe('file-id');
    expect(uploadBuffer).not.toHaveBeenCalled();
    expect(rm).not.toHaveBeenCalled();
  });
  it('saves the exact client ID and retains an observed image acceptance after an SDK error', async () => {
    row.contentType = 'image';
    row.metadata.outboundAttachment = { ...row.metadata.outboundAttachment, kind: 'image', filename: 'image.png', mime: 'image/png' };
    vi.mocked(zaloOps.sendImage).mockImplementation(async (...args) => {
      const observer = args[6]!.deliveryObserver!;
      const request = { kind: 'image' as const, index: 0, clientId: '1700000000000' };
      await observer.beforeSend!(request);
      expect(row.zaloCliMsgId).toBe(request.clientId);
      await observer.accepted!(request, '3001');
      throw new ZaloDeliveryUncertainError('Another SDK continuation lost its response');
    });
    await processAttachment('outbox', 'nick');
    expect(row.zaloMsgId).toBe('3001'); expect(row.deliveryState).toBe('accepted');
    expect(row.zaloCliMsgId).toBe('1700000000000');
    expect(zaloOps.sendImage).toHaveBeenCalledTimes(1);
    expect(zaloOps.sendFile).not.toHaveBeenCalled();
  });
  it('keeps callback loss uncertain and will not resend on another worker tick', async () => {
    vi.mocked(zaloOps.sendFile).mockRejectedValue(new ZaloDeliveryUncertainError('lost response'));
    await processAttachment('outbox', 'nick');
    expect(row.deliveryState).toBe('uncertain');
    await processAttachment('outbox', 'nick');
    expect(zaloOps.sendFile).toHaveBeenCalledTimes(1);
    expect(rm).not.toHaveBeenCalled();
  });
  it('does not accept a caption ID as proof of file acceptance', async () => {
    vi.mocked(zaloOps.sendFile).mockResolvedValue({ message: { msgId: 'caption-id' }, attachment: [] } as never);
    await processAttachment('outbox', 'nick');
    expect(row.deliveryState).toBe('uncertain');
    expect(row.zaloMsgId).toBeNull();
  });
  it('marks a deterministic rejection as failed, without automatically replaying', async () => {
    vi.mocked(zaloOps.sendFile).mockRejectedValue(new Error('rejected'));
    await processAttachment('outbox', 'nick');
    await processAttachment('outbox', 'nick');
    expect(row.deliveryState).toBe('failed');
    expect(zaloOps.sendFile).toHaveBeenCalledTimes(1);
  });
  it('rechecks permissions before external delivery', async () => {
    vi.mocked(hasZaloAccess).mockResolvedValue(false);
    await processAttachment('outbox', 'nick');
    expect(row.deliveryState).toBe('failed');
    expect(zaloOps.sendFile).not.toHaveBeenCalled();
  });
  it('does not send from a different nick', async () => {
    await processAttachment('outbox', 'other-nick');
    expect(row.deliveryState).toBe('failed');
    expect(zaloOps.sendFile).not.toHaveBeenCalled();
  });
  it('does not redirect a queued file if the conversation recipient changed', async () => {
    row.metadata.outboundAttachment.destination = { ...destination, threadId: 'previous-recipient' };
    await processAttachment('outbox', 'nick');
    expect(row.deliveryState).toBe('failed');
    expect(zaloOps.sendFile).not.toHaveBeenCalled();
  });
  it('leaves disconnected jobs queued without crossing the send boundary', async () => {
    vi.mocked(zaloPool.getInstance).mockReturnValue({ status: 'disconnected' } as any);
    await processAttachment('outbox', 'nick');
    expect(row.deliveryState).toBe('prepared');
    expect(row.deliveryLeaseId).toBeNull();
    expect(zaloOps.sendFile).not.toHaveBeenCalled();
  });
  it('does not run a second delivery while this nick has an active lease', async () => {
    db.message.findFirst.mockResolvedValue({ id: 'another-job' });
    await processAttachment('outbox', 'nick');
    expect(zaloOps.sendFile).not.toHaveBeenCalled();
  });
  it('does not send a queued message that was deleted before delivery', async () => {
    row.isDeleted = true;
    await processAttachment('outbox', 'nick');
    expect(zaloOps.sendFile).not.toHaveBeenCalled();
  });
  it('does not call Zalo if durable source bytes are missing', async () => {
    vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
    await processAttachment('outbox', 'nick');
    expect(row.deliveryState).toBe('failed');
    expect(zaloOps.sendFile).not.toHaveBeenCalled();
  });
  it('recovers an interrupted preparing lease as safely queued', async () => {
    row.deliveryLeaseId = 'old-process'; row.deliveryLeaseUntil = new Date(0);
    row.metadata.outboundAttachment.status = 'preparing';
    await recoverAttachmentLeases();
    expect(row.deliveryState).toBe('prepared');
    expect(row.deliveryLeaseId).toBeNull();
    expect(row.metadata.outboundAttachment.status).toBe('queued');
    expect(zaloOps.sendFile).not.toHaveBeenCalled();
  });
  it('recovers an interrupted external send as uncertain, never queued', async () => {
    row.deliveryState = 'submitting'; row.deliveryLeaseId = 'old-process'; row.deliveryLeaseUntil = new Date(0);
    row.metadata.outboundAttachment.status = 'sending';
    await recoverAttachmentLeases();
    expect(row.deliveryState).toBe('uncertain');
    expect(zaloOps.sendFile).not.toHaveBeenCalled();
  });
  it('also settles stale text leases without inventing attachment metadata', async () => {
    row.contentType = 'text'; row.deliveryState = 'submitting'; row.deliveryLeaseId = 'old-process'; row.deliveryLeaseUntil = new Date(0);
    row.metadata = { outboundText: { status: 'submitting', echo: 'text-echo' } };
    await recoverAttachmentLeases();
    expect(row.deliveryState).toBe('uncertain');
    expect(row.metadata.outboundText).toEqual({ status: 'uncertain', echo: 'text-echo' });
    expect(row.metadata.outboundAttachment).toBeUndefined();
  });
  it('retains accepted state and bytes when storage is unavailable', async () => {
    await processAttachment('outbox', 'nick');
    vi.mocked(uploadFile).mockRejectedValue(new Error('storage unavailable'));
    await mirrorAttachment({ ...row });
    expect(row.deliveryState).toBe('accepted');
    expect(row.mediaMirrorNextAttemptAt).toBeInstanceOf(Date);
    expect(rm).not.toHaveBeenCalled();
    expect(zaloOps.sendFile).toHaveBeenCalledTimes(1);
  });
  it('cleans source bytes only after the mirror and ledger are persisted', async () => {
    await processAttachment('outbox', 'nick');
    await mirrorAttachment({ ...row });
    expect(row.deliveryState).toBe('completed');
    expect(JSON.parse(row.content).href).toBe('/files/media/quote.pdf');
    expect(recordMessageStorageReferences).toHaveBeenCalledTimes(1);
    expect(rm).toHaveBeenCalledTimes(1);
  });
  it('does not delete source bytes when reference persistence fails', async () => {
    await processAttachment('outbox', 'nick');
    vi.mocked(recordMessageStorageReferences).mockRejectedValue(new Error('database unavailable'));
    await mirrorAttachment({ ...row });
    expect(row.deliveryState).toBe('accepted');
    expect(rm).not.toHaveBeenCalled();
  });
  it('uses SERIALIZABLE for per-nick claiming', async () => {
    await processAttachment('outbox', 'nick');
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  });
  it.each([false, true])('confirms only proven image members, including partial transport replies: %s', async (partialReply) => {
    const images = [0, 1, 2].map((index) => ({ ...row, id: `image-${index}`, clientEchoId: `echo-${index}`, contentType: 'image',
      metadata: { sendStatus: 'queued', outboundAttachment: { ...source, destination, filename: `${index}.png`, kind: 'image', mime: 'image/png', batchId: 'album', status: 'queued' } } }));
    const store = new Map(images.map((image) => [image.id, image]));
    db.message.findUnique.mockImplementation(async ({ where }: any) => ({ ...store.get(where.id) }));
    db.message.findUniqueOrThrow.mockImplementation(async ({ where }: any) => ({ ...store.get(where.id) }));
    db.message.findMany.mockImplementation(async () => [...store.values()].filter((image) => image.deliveryState === 'prepared'));
    db.message.update.mockImplementation(async ({ where, data }: any) => {
      store.set(where.id, { ...store.get(where.id), ...data }); return store.get(where.id);
    });
    db.message.updateMany.mockImplementation(async ({ where, data }: any) => {
      const current = store.get(where.id);
      if (!current || ('deliveryState' in where && current.deliveryState !== where.deliveryState)
        || ('deliveryLeaseId' in where && current.deliveryLeaseId !== where.deliveryLeaseId)
        || ('zaloMsgId' in where && current.zaloMsgId !== where.zaloMsgId)) return { count: 0 };
      store.set(where.id, { ...current, ...data }); return { count: 1 };
    });
    vi.mocked(createMediaMessage).mockImplementation(async (input) => {
      const current = [...store.values()].find((image) => image.clientEchoId === input.clientEchoId)!;
      store.set(current.id, { ...current, zaloMsgId: input.zaloMsgId, deliveryState: 'accepted', deliveryLeaseId: null, metadata: input.metadata });
      return store.get(current.id);
    });
    if (partialReply) {
      vi.mocked(zaloOps.sendImage).mockImplementation(async (...args) => {
        const observer = args[6]!.deliveryObserver!;
        for (let index = 0; index < 3; index++) await observer.beforeSend!({ kind: 'image', index, clientId: String(1700000000000 + index) });
        await observer.accepted!({ kind: 'image', index: 0, clientId: '1700000000000' }, 'remote-0');
        await observer.accepted!({ kind: 'image', index: 2, clientId: '1700000000002' }, 'remote-2');
        // One sibling got a deterministic rejection, but the other submitted
        // sibling results must never become retryable based on that alone.
        throw Object.assign(new Error('One image was rejected'), { code: 112, deliveryPhase: 'after_send' });
      });
    } else vi.mocked(zaloOps.sendImage).mockResolvedValue({ attachment: [{ msgId: 'remote-0' }, {}, { msgId: 'remote-2' }] } as never);
    await processAttachment('image-0', 'nick');
    expect(zaloOps.sendImage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(zaloOps.sendImage).mock.calls[0][3]).toHaveLength(3);
    expect(store.get('image-0')?.zaloMsgId).toBe('remote-0');
    expect(store.get('image-1')?.deliveryState).toBe('uncertain');
    expect(store.get('image-2')?.zaloMsgId).toBe('remote-2');
    expect(zaloOps.sendFile).not.toHaveBeenCalled();
  });
});

describe('durable source identity', () => {
  it('rejects traversal and paths outside the spool', () => {
    expect(() => sourcePath({ ...source, sourceId: '../files' })).toThrow();
    expect(() => sourcePath({ ...source, filename: '../secret.pdf' })).toThrow();
    expect(() => sourcePath({ ...source, filename: 'C:\\secret.pdf' })).toThrow();
  });
  it('deduplicates a request whose result is uncertain instead of creating another send', async () => {
    row.deliveryState = 'uncertain';
    const result = await queueAttachment({ conversationId: 'conversation', zaloUid: 'self', userId: 'sender', userName: 'Sale', echoId: 'echo', caption: '', source, destination });
    expect(result.deliveryState).toBe('uncertain');
    expect(db.message.create).not.toHaveBeenCalled();
    expect(zaloOps.sendFile).not.toHaveBeenCalled();
  });
});
