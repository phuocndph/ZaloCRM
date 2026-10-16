// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { stat, access, open } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireZaloAccess } from '../zalo/zalo-access-middleware.js';
import { getUserFullName, outboundDeliveryState } from './chat-helpers.js';
import {
  allocateAttachmentSource, attachmentJob, attachmentMetadata, queueAttachment,
  recoverAttachmentLeases, removeAttachmentSource, sourcePath, type AttachmentSource,
} from './chat-attachment-outbox.js';
import { attachmentMime, attachmentKind, validAttachmentHeader, IMAGE_MAX, VIDEO_MAX, FILE_MAX, ATTACHMENT_BATCH_MAX } from './chat-attachment-policy.js';

export { IMAGE_MAX, VIDEO_MAX, FILE_MAX, ALLOWED_IMAGE, ALLOWED_VIDEO, ALLOWED_FILE } from './chat-attachment-policy.js';

export function resolveAttachmentEchoIds(suppliedEchoIds: string[], batchEchoId: string, fileCount: number): Array<string | null> {
  return Array.from({ length: fileCount }, (_, index) => suppliedEchoIds[index] || (batchEchoId ? `${batchEchoId}:${index}` : null));
}

export function failedAttachmentIndices(fileCount: number, completedIndices: Iterable<number>): number[] {
  const completed = new Set(completedIndices);
  return Array.from({ length: fileCount }, (_, index) => index).filter((index) => !completed.has(index));
}

export function attachmentOutboxStatus(message: { metadata?: unknown }): string | null {
  const outbound = (message.metadata as { outboundAttachment?: { status?: unknown } } | null)?.outboundAttachment;
  return typeof outbound?.status === 'string' ? outbound.status : null;
}

export function attachmentDeliveryAccepted(message: { zaloMsgId?: string | null; metadata?: unknown; deliveryState?: string | null }): boolean {
  return ['accepted', 'completed'].includes(outboundDeliveryState(message) ?? '');
}

function echoIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > ATTACHMENT_BATCH_MAX) return [];
  if (!value.every((id) => typeof id === 'string' && id.trim().length > 0 && id.length <= 180)) return [];
  const ids = value.map((id) => id.trim());
  return new Set(ids).size === ids.length ? ids : [];
}

export function attachmentResponse(ids: string[], messages: Array<{ clientEchoId: string | null; deliveryState?: string | null; zaloMsgId?: string | null; metadata?: unknown }>) {
  const indexed = new Map(messages.map((message) => [message.clientEchoId, message]));
  const failedIndices: number[] = [];
  const missingIndices: number[] = [];
  const pendingConfirmationIndices: number[] = [];
  ids.forEach((id, index) => {
    const row = indexed.get(id);
    if (!row) missingIndices.push(index);
    else if (outboundDeliveryState(row) === 'failed') failedIndices.push(index);
    else if (!attachmentDeliveryAccepted(row)) pendingConfirmationIndices.push(index);
  });
  return { messages, failedIndices, missingIndices, pendingConfirmationIndices, pendingConfirmation: pendingConfirmationIndices.length > 0 };
}

async function authorizedConversation(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user!;
  const { id } = request.params as { id: string };
  const conversation = await prisma.conversation.findFirst({ where: { id, orgId: user.orgId }, include: { zaloAccount: true } });
  if (!conversation) { reply.status(404).send({ error: 'Conversation not found' }); return null; }
  if ((conversation.isPrivate && conversation.privateOwnerUserId !== user.id)
    || (conversation.zaloAccount.privacyMode === 'main' && conversation.zaloAccount.ownerUserId !== user.id)) {
    reply.status(403).send({ error: 'Conversation is private', code: 'CONVERSATION_PRIVATE' }); return null;
  }
  return conversation;
}

export async function chatAttachmentRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  // Status remains readable while a nick is disconnected; it never initiates a send.
  app.get('/api/v1/conversations/:id/attachments/status', { preHandler: requireZaloAccess('read') }, async (request, reply) => {
    const conversation = await authorizedConversation(request, reply);
    if (!conversation) return;
    let ids: string[] = [];
    try { ids = echoIds(JSON.parse(String((request.query as { echoIds?: string }).echoIds || '[]'))); } catch { /* validated below */ }
    if (!ids.length) return reply.status(400).send({ error: 'Invalid attachment echo IDs' });
    await recoverAttachmentLeases(conversation.id);
    const messages = await prisma.message.findMany({ where: { conversationId: conversation.id, senderType: 'self', clientEchoId: { in: ids } } });
    return attachmentResponse(ids, messages);
  });

  app.post('/api/v1/conversations/:id/attachments/retry', { preHandler: requireZaloAccess('chat') }, async (request, reply) => {
    const conversation = await authorizedConversation(request, reply);
    if (!conversation) return;
    if (conversation.zaloAccount.archivedAt) return reply.status(409).send({ error: 'Nick archived', code: 'NICK_ARCHIVED' });
    const ids = echoIds((request.body as { echoIds?: unknown } | null)?.echoIds);
    if (!ids.length) return reply.status(400).send({ error: 'Invalid attachment echo IDs' });
    const rows = await prisma.message.findMany({ where: { conversationId: conversation.id, senderType: 'self', clientEchoId: { in: ids } } });
    for (const row of rows) {
      const job = attachmentJob(row);
      // Unknown delivery is not a retryable failure. Never change its identity or replay it.
      if (!job || outboundDeliveryState(row) !== 'failed') continue;
      try { await access(sourcePath(job)); } catch { continue; }
      await prisma.message.updateMany({ where: { id: row.id, deliveryState: 'failed', zaloMsgId: null }, data: {
        deliveryState: 'prepared', deliveryLeaseId: null, deliveryLeaseUntil: null,
        metadata: attachmentMetadata(row, { ...job, status: 'queued' }, 'queued'),
      } });
    }
    const messages = await prisma.message.findMany({ where: { conversationId: conversation.id, senderType: 'self', clientEchoId: { in: ids } } });
    return reply.status(202).send(attachmentResponse(ids, messages));
  });

  app.post('/api/v1/conversations/:id/attachments', { preHandler: requireZaloAccess('chat') }, async (request, reply) => {
    const conversation = await authorizedConversation(request, reply);
    if (!conversation) return;
    if (conversation.zaloAccount.archivedAt) return reply.status(409).send({ error: 'Nick archived', code: 'NICK_ARCHIVED' });
    if (!conversation.externalThreadId) return reply.status(400).send({ error: 'Missing Zalo thread' });
    const count = Number(request.headers['x-attachment-count'] || 0);
    if (count > ATTACHMENT_BATCH_MAX) return reply.status(413).send({ error: `Maximum ${ATTACHMENT_BATCH_MAX} files per upload` });
    let suppliedIds: string[] = [];
    try { suppliedIds = echoIds(JSON.parse(String(request.headers['x-attachment-echo-ids'] || '[]'))); } catch { /* multipart fallback */ }
    let batchId = String(request.headers['x-attachment-echo-id'] || '').trim().slice(0, 150);
    await recoverAttachmentLeases(conversation.id);
    if (suppliedIds.length === count && count > 0) {
      const existing = await prisma.message.findMany({ where: { conversationId: conversation.id, clientEchoId: { in: suppliedIds } } });
      if (existing.length === count && existing.every((row) => outboundDeliveryState(row) !== 'failed')) {
        const body = attachmentResponse(suppliedIds, existing);
        return reply.status(body.pendingConfirmation ? 202 : 200).send({ ...body, deduplicated: true });
      }
    }
    const files: AttachmentSource[] = [];
    const retained = new Set<string>();
    let caption = '';
    try {
      for await (const part of request.parts({ limits: { fileSize: FILE_MAX, files: ATTACHMENT_BATCH_MAX, fieldSize: 64 * 1024 } })) {
        if (part.type === 'field') {
          if (part.fieldname === 'caption') caption = String(part.value || '').slice(0, 10_000);
          if (part.fieldname === 'echoId' && !batchId) batchId = String(part.value || '').trim().slice(0, 150);
          if (part.fieldname === 'echoIds' && !suppliedIds.length) {
            try { suppliedIds = echoIds(JSON.parse(String(part.value || '[]'))); } catch { /* validate after parsing */ }
          }
          continue;
        }
        const filename = path.basename((part.filename || 'upload').replace(/\\/g, '/'));
        if (/[\x00-\x1f:]/.test(filename) || filename.length > 220 || filename === '.' || filename === '..') {
          return reply.status(400).send({ error: 'Invalid filename' });
        }
        const mime = attachmentMime(part.mimetype, filename);
        if (!mime) return reply.status(415).send({ error: `Unsupported file type: ${part.mimetype}` });
        const kind = attachmentKind(mime);
        const source = await allocateAttachmentSource(filename);
        const file = { sourceId: source.sourceId, filename, mime, kind, size: 0 };
        files.push(file);
        await pipeline(part.file, createWriteStream(source.filePath, { flags: 'wx', mode: 0o600 }));
        file.size = (await stat(source.filePath)).size;
        const max = kind === 'image' ? IMAGE_MAX : kind === 'video' ? VIDEO_MAX : FILE_MAX;
        if (part.file.truncated || file.size > max) return reply.status(413).send({ error: `File exceeds ${max / 1024 / 1024} MB` });
        if (file.size === 0) return reply.status(400).send({ error: 'Empty file' });
        const handle = await open(source.filePath, 'r');
        try {
          const bytes = Buffer.alloc(1024);
          const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
          if (!validAttachmentHeader(bytes.subarray(0, bytesRead), mime)) return reply.status(415).send({ error: 'File contents do not match its format' });
        } finally { await handle.close(); }
      }
      if (!files.length || (count > 0 && files.length !== count) || (suppliedIds.length > 0 && suppliedIds.length !== files.length)) {
        return reply.status(400).send({ error: 'Attachment count mismatch' });
      }
      const ids = resolveAttachmentEchoIds(suppliedIds, batchId || randomUUID(), files.length) as string[];
      if (new Set(ids).size !== ids.length) return reply.status(400).send({ error: 'Duplicate attachment echo IDs' });
      const userName = await getUserFullName(request.user!.id);
      // Publish the entire batch atomically. A request failure cannot leave only half queued.
      // Retain bytes even if a connection loss makes the commit result ambiguous.
      files.forEach((file) => retained.add(file.sourceId));
      const queuedAt = Date.now();
      const messages = await prisma.$transaction(async (tx) => {
        const result = [];
        for (let index = 0; index < files.length; index++) {
          result.push(await queueAttachment({ conversationId: conversation.id, zaloUid: conversation.zaloAccount.zaloUid,
            userId: request.user!.id, userName, echoId: ids[index], caption, source: files[index],
            destination: { orgId: request.user!.orgId, accountId: conversation.zaloAccountId,
              threadId: conversation.externalThreadId!, threadType: conversation.threadType === 'group' ? 1 : 0 },
            batchId: batchId || ids[0], sentAt: new Date(queuedAt + index) }, tx));
        }
        return result;
      });
      messages.forEach((message, index) => {
        if (attachmentJob(message)?.sourceId !== files[index].sourceId) retained.delete(files[index].sourceId);
      });
      return reply.status(202).send(attachmentResponse(ids, messages));
    } catch (error) {
      const code = (error as { code?: string }).code;
      return reply.status(code === 'FST_REQ_FILE_TOO_LARGE' || code === 'FST_FILES_LIMIT' ? 413 : 500).send({
        error: code === 'FST_REQ_FILE_TOO_LARGE' || code === 'FST_FILES_LIMIT' ? 'Upload limit exceeded' : 'Could not persist attachment upload; check send status before retrying',
      });
    } finally {
      for (const file of files) if (!retained.has(file.sourceId)) await removeAttachmentSource(file).catch(() => {});
    }
  });
}
