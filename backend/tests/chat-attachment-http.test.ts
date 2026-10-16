import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mockPrisma } from './test-helpers.js';

const db = mockPrisma();
let actor = { id: 'sender', orgId: 'org', role: 'admin' };
vi.mock('../src/shared/database/prisma-client.js', () => ({ prisma: db }));
vi.mock('../src/modules/auth/auth-middleware.js', () => ({ authMiddleware: async (request: any) => { request.user = actor; } }));
vi.mock('../src/modules/zalo/zalo-access-middleware.js', () => ({ requireZaloAccess: () => async () => {}, hasZaloAccess: vi.fn() }));
vi.mock('../src/modules/zalo/zalo-pool.js', () => ({ zaloPool: { getIO: () => null, getInstance: vi.fn() } }));
vi.mock('../src/shared/zalo-operations.js', () => ({ zaloOps: { sendFile: vi.fn(), sendImage: vi.fn() }, isZaloDeliveryUncertain: vi.fn(), isDeterministicZaloRejection: vi.fn(), ZaloDeliveryUncertainError: class extends Error {} }));
vi.mock('../src/modules/ai/conversation-analysis-queue.js', () => ({ enqueueConversationAnalysis: vi.fn() }));

const root = await mkdtemp(path.join(os.tmpdir(), 'zalocrm-attachments-test-'));
vi.stubEnv('CHAT_OUTBOX_DIR', root);
const { chatAttachmentRoutes } = await import('../src/modules/chat/chat-attachment-routes.js');
const { sourcePath, attachmentJob } = await import('../src/modules/chat/chat-attachment-outbox.js');
const { zaloOps } = await import('../src/shared/zalo-operations.js');
let app: FastifyInstance;
let rows: Map<string, any>;
let conversation: any;

beforeEach(async () => {
  vi.clearAllMocks();
  rows = new Map();
  actor = { id: 'sender', orgId: 'org', role: 'admin' };
  conversation = { id: 'conversation', orgId: 'org', externalThreadId: 'customer', zaloAccountId: 'nick',
    zaloAccount: { zaloUid: 'self', privacyMode: 'sub', archivedAt: null }, isPrivate: false };
  db.conversation.findFirst.mockImplementation(async ({ where }: any) => where.orgId === conversation.orgId && where.id === conversation.id ? conversation : null);
  db.user.findUnique.mockResolvedValue({ fullName: 'Sale' });
  db.message.findMany.mockImplementation(async ({ where }: any) => where.clientEchoId
    ? [...rows.values()].filter((row) => where.clientEchoId.in.includes(row.clientEchoId) && row.conversationId === where.conversationId) : []);
  db.message.findUnique.mockImplementation(async ({ where }: any) => where.id ? rows.get(where.id)
    : [...rows.values()].find((row) => row.conversationId === where.conversationId_clientEchoId.conversationId && row.clientEchoId === where.conversationId_clientEchoId.clientEchoId) ?? null);
  db.message.findUniqueOrThrow.mockImplementation(async (args: any) => db.message.findUnique(args));
  db.message.create.mockImplementation(async ({ data }: any) => {
    const row = { id: randomUUID(), zaloMsgId: null, ...data };
    rows.set(row.id, row);
    return row;
  });
  db.message.updateMany.mockImplementation(async ({ where, data }: any) => {
    const row = rows.get(where.id);
    if (!row || row.deliveryState !== where.deliveryState || (where.zaloMsgId === null && row.zaloMsgId)) return { count: 0 };
    rows.set(row.id, { ...row, ...data });
    return { count: 1 };
  });
  db.$transaction.mockImplementation(async (callback: (tx: any) => unknown) => callback(db));
  app = Fastify();
  await app.register(multipart);
  await app.register(chatAttachmentRoutes);
  await app.ready();
});

afterEach(async () => { await app.close(); });
afterAll(async () => {
  const absolute = path.resolve(root);
  if (!absolute.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(absolute).startsWith('zalocrm-attachments-test-')) throw new Error('Unsafe test cleanup');
  await rm(absolute, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

function upload(ids = ['echo-a'], filename = 'quote.pdf', contents = '%PDF-1.4\nexample', mime = 'application/pdf') {
  const boundary = 'zalocrm-test-boundary';
  const payload = ids.map((_, index) => `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${index ? `${index}-${filename}` : filename}"\r\nContent-Type: ${mime}\r\n\r\n${contents}\r\n`).join('') + `--${boundary}--\r\n`;
  return app.inject({ method: 'POST', url: '/api/v1/conversations/conversation/attachments',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'x-attachment-echo-ids': JSON.stringify(ids), 'x-attachment-count': String(ids.length) }, payload });
}

describe('attachment multipart API', () => {
  it('persists the entire batch and returns queued 202 without invoking Zalo', async () => {
    const response = await upload(['a', 'b']);
    expect(response.statusCode).toBe(202);
    expect(response.json().messages).toHaveLength(2);
    expect(response.json().pendingConfirmationIndices).toEqual([0, 1]);
    expect(rows.size).toBe(2);
    for (const row of rows.values()) {
      expect(row.deliveryState).toBe('prepared');
      await expect(access(sourcePath(attachmentJob(row)!))).resolves.toBeUndefined();
    }
    expect(zaloOps.sendFile).not.toHaveBeenCalled();
  });
  it('deduplicates repeated uploads before accepting another copy', async () => {
    await upload();
    const response = await upload();
    expect(response.statusCode).toBe(202);
    expect(response.json().deduplicated).toBe(true);
    expect(rows.size).toBe(1);
    expect(db.message.create).toHaveBeenCalledTimes(1);
  });
  it('accepts Windows generic MIME for a recognized file extension', async () => {
    const response = await upload(['opaque'], 'quote.xlsx', 'PK\u0003\u0004example', 'application/octet-stream');
    expect(response.statusCode).toBe(202);
    expect(attachmentJob(response.json().messages[0])?.filename).toBe('quote.xlsx');
  });
  it('rejects spoofed image/PDF content before queuing any send', async () => {
    const response = await upload(['bad'], 'fake.pdf', 'MZ executable');
    expect(response.statusCode).toBe(415);
    expect(rows.size).toBe(0);
    expect(zaloOps.sendFile).not.toHaveBeenCalled();
  });
  it('rejects too many files with a clear 413', async () => {
    const response = await upload(Array.from({ length: 11 }, (_, index) => `echo-${index}`));
    expect(response.statusCode).toBe(413);
    expect(rows.size).toBe(0);
  });
  it('retains source bytes if the transaction commit response is lost', async () => {
    db.$transaction.mockImplementation(async (callback: (tx: any) => unknown) => { await callback(db); throw new Error('commit response lost'); });
    const response = await upload();
    expect(response.statusCode).toBe(500);
    const row = [...rows.values()][0];
    await expect(access(sourcePath(attachmentJob(row)!))).resolves.toBeUndefined();
    const status = await app.inject({ url: `/api/v1/conversations/conversation/attachments/status?echoIds=${encodeURIComponent('["echo-a"]')}` });
    expect(status.statusCode).toBe(200);
    expect(status.json().messages).toHaveLength(1);
    expect(status.json().failedIndices).toEqual([]);
  });
  it('rejects private conversations and cross-organization status probes', async () => {
    conversation.isPrivate = true; conversation.privateOwnerUserId = 'someone-else';
    expect((await upload()).statusCode).toBe(403);
    actor.orgId = 'other-org';
    const response = await app.inject({ url: `/api/v1/conversations/conversation/attachments/status?echoIds=${encodeURIComponent('["echo-a"]')}` });
    expect(response.statusCode).toBe(404);
  });
  it('refuses to queue files on an archived nick', async () => {
    conversation.zaloAccount.archivedAt = new Date();
    expect((await upload()).statusCode).toBe(409);
    expect(rows.size).toBe(0);
  });
  it('does not retry a delivery whose outcome is uncertain', async () => {
    await upload();
    const row = [...rows.values()][0];
    row.deliveryState = 'uncertain';
    const response = await app.inject({ method: 'POST', url: '/api/v1/conversations/conversation/attachments/retry', payload: { echoIds: ['echo-a'] } });
    expect(response.statusCode).toBe(202);
    expect(response.json().messages[0].deliveryState).toBe('uncertain');
    expect(db.message.updateMany).not.toHaveBeenCalled();
  });
  it('requeues only a deterministic failure using its existing bytes and echo ID', async () => {
    await upload();
    const row = [...rows.values()][0];
    row.deliveryState = 'failed';
    const sourceId = attachmentJob(row)!.sourceId;
    const response = await app.inject({ method: 'POST', url: '/api/v1/conversations/conversation/attachments/retry', payload: { echoIds: ['echo-a'] } });
    expect(response.statusCode).toBe(202);
    expect(response.json().messages[0].deliveryState).toBe('prepared');
    expect(attachmentJob(response.json().messages[0])?.sourceId).toBe(sourceId);
    expect(db.message.create).toHaveBeenCalledTimes(1);
  });
});
