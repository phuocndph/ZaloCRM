import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rm, copyFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { Prisma, type Message } from '@prisma/client';
import { prisma } from '../../shared/database/prisma-client.js';
import { config } from '../../config/index.js';
import { runSystemQuery, withTenant } from '../../shared/tenant/tenant-context.js';
import { emitChatMessage } from '../../shared/realtime/emit-chat.js';
import { logger } from '../../shared/utils/logger.js';
import { zaloPool } from '../zalo/zalo-pool.js';
import { hasZaloAccess } from '../zalo/zalo-access-middleware.js';
import { isZaloDeliveryUncertain, isDeterministicZaloRejection, zaloOps, ZaloDeliveryUncertainError } from '../../shared/zalo-operations.js';
import { createMediaMessage, outboundDeliveryState, OUTBOUND_DELIVERY_LEASE_MS } from './chat-helpers.js';
import { uploadBuffer, uploadFile } from '../../shared/storage/minio-client.js';
import { withDeliveryDeadline } from '../../shared/zalo-delivery-context.js';
import { recordMessageStorageReferences } from '../../shared/storage/storage-ledger.js';
import { compressImage } from '../media/media-service.js';
import { generateThumbnail, sendNativeVideo } from '../../shared/video-processor.js';
import { attachmentMessageId } from './chat-attachment-policy.js';
import { enqueueConversationAnalysis } from '../ai/conversation-analysis-queue.js';

export interface AttachmentSource {
  sourceId: string;
  filename: string;
  mime: string;
  size: number;
  kind: 'image' | 'video' | 'file';
}

type AttachmentDestination = {
  orgId: string;
  accountId: string;
  threadId: string;
  threadType: 0 | 1;
};

type AttachmentJob = AttachmentSource & {
  status: string;
  batchId?: string;
  thumbnailName?: string;
  destination?: AttachmentDestination;
  mirrorAttempts?: number;
  mirrorNextAt?: string;
};

const ROOT = path.resolve(config.chatOutboxDir);
const PUBLIC_ROOT = path.resolve(config.uploadDir);
if (ROOT === PUBLIC_ROOT || ROOT.startsWith(PUBLIC_ROOT + path.sep)) throw new Error('Chat outbox must not be inside public file storage');
const TICK_MS = 3_000;
let timer: ReturnType<typeof setInterval> | undefined;
let running = false;
let stopped = false;
let accountCursor = 0;
let lastGcAt = 0;
let gcCursor = 0;

export async function gcOrphanAttachmentSources(): Promise<void> {
  const directories = (await readdir(ROOT, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory() && /^[a-f0-9-]{36}$/.test(entry.name));
  const candidates = [...directories.slice(gcCursor), ...directories.slice(0, gcCursor)].slice(0, 50);
  gcCursor = directories.length ? (gcCursor + candidates.length) % directories.length : 0;
  for (const directory of candidates) {
    const source = { sourceId: directory.name, filename: 'orphan' } as AttachmentSource;
    const info = await stat(path.dirname(sourcePath(source))).catch(() => null);
    if (!info || Date.now() - info.mtimeMs < 24 * 60 * 60_000) continue;
    const reference = await prisma.message.findFirst({
      where: { metadata: { path: ['outboundAttachment', 'sourceId'], equals: directory.name } },
      select: { deliveryState: true, metadata: true },
    });
    // Never expire unresolved/failed sources automatically. Completed chat bytes are already in the permanent store.
    if (!reference || (reference.deliveryState === 'completed' && attachmentJob(reference)?.status === 'mirrored')) {
      await removeAttachmentSource(source);
    }
  }
}

export function sourcePath(source: AttachmentSource): string {
  if (!/^[a-f0-9-]{36}$/.test(source.sourceId)
    || !source.filename || path.basename(source.filename) !== source.filename
    || /[\\/:\x00-\x1f]/.test(source.filename) || source.filename === '.' || source.filename === '..') {
    throw new Error('Invalid attachment source');
  }
  return path.join(ROOT, source.sourceId, source.filename);
}

export async function allocateAttachmentSource(filename: string): Promise<{ sourceId: string; filePath: string }> {
  const sourceId = randomUUID();
  const filePath = sourcePath({ sourceId, filename } as AttachmentSource);
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  return { sourceId, filePath };
}

export async function removeAttachmentSource(source: AttachmentSource): Promise<void> {
  // The UUID directory is validated before a recursive removal.
  const directory = path.dirname(sourcePath(source));
  if (path.dirname(directory) !== ROOT) throw new Error('Invalid source directory');
  await rm(directory, { recursive: true, force: true });
}

export function attachmentJob(message: { metadata?: unknown }): AttachmentJob | null {
  const value = (message.metadata as { outboundAttachment?: AttachmentJob } | null)?.outboundAttachment;
  if (!value || typeof value !== 'object' || typeof value.sourceId !== 'string'
    || typeof value.filename !== 'string' || typeof value.mime !== 'string'
    || typeof value.size !== 'number' || !['image', 'video', 'file'].includes(value.kind)) return null;
  try { sourcePath(value); } catch { return null; }
  return value;
}

export function attachmentMetadata(message: { metadata?: unknown }, job: AttachmentJob, sendStatus: string, reason?: string) {
  const previous = message.metadata && typeof message.metadata === 'object' && !Array.isArray(message.metadata)
    ? message.metadata as Record<string, unknown> : {};
  return { ...previous, sendStatus, failReason: reason ?? null, outboundAttachment: { ...job } } as Prisma.InputJsonValue;
}

async function publish(message: Message): Promise<void> {
  const conversation = await prisma.conversation.findUnique({ where: { id: message.conversationId }, include: { zaloAccount: true } });
  const io = zaloPool.getIO();
  if (!conversation || !io) return;
  await emitChatMessage({
    io, orgId: conversation.orgId, accountId: conversation.zaloAccountId,
    conversationId: conversation.id, message,
    privacyMode: conversation.zaloAccount.privacyMode,
    ownerUserId: conversation.zaloAccount.ownerUserId,
    isPrivate: conversation.isPrivate, privateOwnerUserId: conversation.privateOwnerUserId,
  });
}

/** Recover leases without ever replaying a send whose result may have been lost. */
export async function recoverAttachmentLeases(conversationId?: string): Promise<void> {
  const rows = await prisma.message.findMany({
    where: {
      ...(conversationId ? { conversationId } : {}), senderType: 'self', zaloMsgId: null,
      contentType: { in: ['image', 'video', 'file', 'text', 'rich'] },
      deliveryState: { in: ['prepared', 'submitting'] },
      OR: [{ deliveryLeaseUntil: { lte: new Date() } }, { deliveryLeaseUntil: null, deliveryState: 'submitting' }],
    }, take: 100, orderBy: { sentAt: 'asc' },
  });
  for (const row of rows) {
    const job = attachmentJob(row);
    const safeToResume = row.deliveryState === 'prepared' && !!job;
    const previous = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? row.metadata as Record<string, unknown> : {};
    const transport = ['image', 'video', 'file'].includes(row.contentType) ? 'outboundAttachment' : 'outboundText';
    const previousTransport = previous[transport] && typeof previous[transport] === 'object' ? previous[transport] as object : {};
    const metadata = job
      ? attachmentMetadata(row, { ...job, status: safeToResume ? 'queued' : 'uncertain' }, safeToResume ? 'queued' : 'uncertain')
      : { ...previous, sendStatus: 'uncertain', [transport]: { ...previousTransport, status: 'uncertain' } };
    const changed = await prisma.message.updateMany({
      where: { id: row.id, zaloMsgId: null, deliveryState: row.deliveryState, deliveryLeaseId: row.deliveryLeaseId, deliveryLeaseUntil: row.deliveryLeaseUntil },
      data: { deliveryState: safeToResume ? 'prepared' : 'uncertain', deliveryLeaseId: null, deliveryLeaseUntil: null, metadata },
    });
    if (changed.count) {
      const fresh = await prisma.message.findUnique({ where: { id: row.id } });
      if (fresh) await publish(fresh).catch(() => {});
    }
  }
}

export async function queueAttachment(input: {
  conversationId: string; zaloUid: string | null; userId: string; userName: string;
  echoId: string; caption: string; source: AttachmentSource;
  batchId?: string; sentAt?: Date;
  destination: AttachmentDestination;
}, db: Pick<typeof prisma, 'message'> = prisma): Promise<Message> {
  const { source } = input;
  const content = JSON.stringify({ href: '', name: source.filename, size: source.size, mime: source.mime, title: input.caption });
  const metadata = {
    sender: { kind: 'user_crm', name: input.userName }, sendStatus: 'queued',
    outboundAttachment: { ...source, status: 'queued', destination: { ...input.destination }, ...(input.batchId ? { batchId: input.batchId } : {}) },
  };
  const existing = await db.message.findUnique({ where: {
    conversationId_clientEchoId: { conversationId: input.conversationId, clientEchoId: input.echoId },
  } });
  if (!existing) {
    return await db.message.create({ data: {
      conversationId: input.conversationId, senderType: 'self', senderUid: input.zaloUid || '', senderName: input.userName,
      repliedByUserId: input.userId, sentVia: 'user', contentType: source.kind, content, metadata,
      clientEchoId: input.echoId, deliveryState: 'prepared', sentAt: input.sentAt ?? new Date(),
    } });
  } else {
    // An explicit retry may replace the bytes only after a deterministic failure.
    if (outboundDeliveryState(existing) !== 'failed') return existing;
    await db.message.updateMany({
      where: { id: existing.id, deliveryState: 'failed', zaloMsgId: null },
      data: { content, metadata, repliedByUserId: input.userId, senderUid: input.zaloUid || '', senderName: input.userName,
        contentType: source.kind, deliveryState: 'prepared', deliveryLeaseId: null, deliveryLeaseUntil: null },
    });
    return db.message.findUniqueOrThrow({ where: { id: existing.id } });
  }
}

async function claimAttachment(id: string, accountId: string): Promise<Message[]> {
  try {
    return await prisma.$transaction(async (tx) => {
      // SERIALIZABLE also protects the absence of an active job on this nick.
      const active = await tx.message.findFirst({ where: {
        conversation: { zaloAccountId: accountId }, deliveryLeaseUntil: { gt: new Date() },
        deliveryState: { in: ['prepared', 'submitting'] },
      }, select: { id: true } });
      if (active) return [];
      const row = await tx.message.findUnique({ where: { id } });
      const job = row && attachmentJob(row);
      if (!row || !job || row.isDeleted || row.deliveryState !== 'prepared') return [];
      const siblings = job.kind === 'image' && job.batchId ? await tx.message.findMany({
        where: { conversationId: row.conversationId, repliedByUserId: row.repliedByUserId,
          contentType: 'image', deliveryState: 'prepared', deliveryLeaseId: null, isDeleted: false,
          metadata: { path: ['outboundAttachment', 'batchId'], equals: job.batchId } },
        orderBy: [{ sentAt: 'asc' }, { id: 'asc' }], take: 3,
      }) : [row];
      // The SDK moves GIFs after normal photos internally. Never mix those response orderings.
      const ordered = siblings.filter((candidate) => (attachmentJob(candidate)?.mime === 'image/gif') === (job.mime === 'image/gif'));
      const leaseId = randomUUID();
      const until = new Date(Date.now() + OUTBOUND_DELIVERY_LEASE_MS);
      const claimed: Message[] = [];
      for (const candidate of ordered) {
        const source = attachmentJob(candidate);
        if (!source) continue;
        const metadata = attachmentMetadata(candidate, { ...source, status: 'preparing' }, 'preparing');
        const changed = await tx.message.updateMany({
          where: { id: candidate.id, deliveryState: 'prepared', deliveryLeaseId: null },
          data: { deliveryLeaseId: leaseId, deliveryLeaseUntil: until, metadata },
        });
        if (!changed.count) throw Object.assign(new Error('Attachment claim conflict'), { code: 'P2034' });
        claimed.push({ ...candidate, metadata: metadata as Prisma.JsonValue, deliveryLeaseId: leaseId, deliveryLeaseUntil: until });
      }
      return claimed;
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2034') return [];
    throw error;
  }
}

export async function processAttachment(id: string, accountId: string): Promise<void> {
  const rows = await claimAttachment(id, accountId);
  const row = rows[0];
  const job = row && attachmentJob(row);
  if (!row || !job) return;
  let attempted = false;
  const remoteIds = new Map<string, string>();
  let thumbnail: Awaited<ReturnType<typeof generateThumbnail>> | null = null;
  try {
    const conversation = await prisma.conversation.findUnique({ where: { id: row.conversationId }, include: { zaloAccount: true } });
    const user = row.repliedByUserId ? await prisma.user.findUnique({ where: { id: row.repliedByUserId } }) : null;
    if (!conversation || !user || !user.isActive || user.orgId !== conversation.orgId || conversation.zaloAccount.archivedAt
      || conversation.zaloAccountId !== accountId || !conversation.externalThreadId
      || rows.some((candidate) => {
        const destination = attachmentJob(candidate)?.destination;
        return !destination || destination.orgId !== conversation.orgId || destination.accountId !== accountId
          || destination.threadId !== conversation.externalThreadId || destination.threadType !== (conversation.threadType === 'group' ? 1 : 0)
          || candidate.senderUid !== conversation.zaloAccount.zaloUid;
      })
      || (conversation.isPrivate && conversation.privateOwnerUserId !== user.id)
      || (conversation.zaloAccount.privacyMode === 'main' && conversation.zaloAccount.ownerUserId !== user.id)
      || !await hasZaloAccess({ userId: user.id, orgId: user.orgId, role: user.role, zaloAccountId: accountId, minPermission: 'chat' })) {
      throw new Error('Attachment send permission is no longer valid');
    }
    for (const candidate of rows) await access(sourcePath(attachmentJob(candidate)!));
    const instance = zaloPool.getInstance(accountId);
    if (!instance?.api || instance.status !== 'connected') {
      // No external call has started; reconnect may safely resume this job.
      for (const candidate of rows) await prisma.message.updateMany({ where: { id: candidate.id, deliveryState: 'prepared', deliveryLeaseId: candidate.deliveryLeaseId }, data: {
        deliveryLeaseId: null, deliveryLeaseUntil: null, metadata: attachmentMetadata(candidate, { ...attachmentJob(candidate)!, status: 'queued' }, 'queued'),
      } });
      return;
    }
    const caption = (JSON.parse(row.content || '{}') as { title?: string }).title || '';
    const threadType = conversation.threadType === 'group' ? 1 : 0;
    if (job.kind === 'video') {
      thumbnail = await generateThumbnail(sourcePath(job)).catch(() => null);
      if (thumbnail) {
        await copyFile(thumbnail.path, sourcePath({ ...job, filename: 'thumbnail.jpg' }));
        job.thumbnailName = 'thumbnail.jpg';
        // Keep the generated preview in the same durable job metadata as the source.
        row.metadata = attachmentMetadata(row, job, 'preparing') as Prisma.JsonValue;
      }
    }
    // Persist the external-send boundary before calling Zalo. A crash after this point is ambiguous.
    await prisma.$transaction(async (tx) => {
      for (const candidate of rows) {
        const marked = await tx.message.updateMany({
          where: { id: candidate.id, isDeleted: false, deliveryState: 'prepared', deliveryLeaseId: candidate.deliveryLeaseId },
          data: { deliveryState: 'submitting', metadata: attachmentMetadata(candidate, { ...attachmentJob(candidate)!, status: 'sending' }, 'sending') },
        });
        if (!marked.count) throw new Error('Attachment lease lost before send');
      }
    });
    for (const candidate of rows) await publish(await prisma.message.findUniqueOrThrow({ where: { id: candidate.id } })).catch(() => {});
    attempted = true;
    let result: unknown;
    if (job.kind === 'image') {
      result = await zaloOps.sendImage(accountId, conversation.externalThreadId, threadType, rows.map((candidate) => sourcePath(attachmentJob(candidate)!)), null, caption, { maxAttempts: 1 });
    } else if (job.kind === 'video' && thumbnail) {
      try {
        result = await sendNativeVideo({ api: instance.api, accountId, videoPath: sourcePath(job), thumbnailPath: thumbnail.path,
          threadId: conversation.externalThreadId, threadType, message: caption, maxAttempts: 1 });
      } catch (error) {
        if (isZaloDeliveryUncertain(error) || !isDeterministicZaloRejection(error)) throw error;
        result = await zaloOps.sendFile(accountId, conversation.externalThreadId, threadType, [sourcePath(job)], null, caption, { maxAttempts: 1 });
      }
    } else {
      result = await zaloOps.sendFile(accountId, conversation.externalThreadId, threadType, [sourcePath(job)], null, caption, { maxAttempts: 1 });
    }
    const ids = rows.map((_, index) => attachmentMessageId(result, index));
    rows.forEach((candidate, index) => {
      if (ids[index] && ids.filter((value) => value === ids[index]).length === 1) remoteIds.set(candidate.id, ids[index]);
    });
    for (const candidate of rows) {
      const remoteId = remoteIds.get(candidate.id);
      if (!remoteId) continue;
      const source = attachmentJob(candidate)!;
      const accepted = await createMediaMessage({
        conversationId: candidate.conversationId, zaloAccount: conversation.zaloAccount, repliedByUserId: user.id,
        zaloMsgId: remoteId, contentType: source.kind, content: candidate.content || '', clientEchoId: candidate.clientEchoId,
        metadata: attachmentMetadata(candidate, { ...source, status: 'accepted_pending_mirror' }, 'sent') as Record<string, unknown>, sentVia: 'user',
      });
      await prisma.message.update({ where: { id: accepted.id }, data: { mediaMirrorState: 'outbound_pending', mediaMirrorNextAttemptAt: new Date() } });
      await publish(accepted).catch(() => {});
      void enqueueConversationAnalysis({ orgId: user.orgId, conversationId: conversation.id, messageId: accepted.id }).catch(() => {});
    }
    if (remoteIds.size !== rows.length) throw new ZaloDeliveryUncertainError('Zalo did not return unique IDs for every attachment');
    await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date(), isReplied: true } });
    logger.info('[chat-outbox] accepted', { messages: remoteIds.size, accountId });
  } catch (error) {
    for (const candidate of rows) {
      const remoteId = remoteIds.get(candidate.id) || '';
      const source = attachmentJob(candidate)!;
      const current = candidate.clientEchoId ? await prisma.message.findUnique({ where: {
        conversationId_clientEchoId: { conversationId: candidate.conversationId, clientEchoId: candidate.clientEchoId },
      } }).catch(() => null) : null;
      if (current && ['accepted', 'completed'].includes(outboundDeliveryState(current) || '')) continue;
      // Preserve the exact ID through listener races and retry persistence, never the Zalo send.
      if (remoteId) {
        await createMediaMessage({ conversationId: candidate.conversationId, zaloAccount: { zaloUid: candidate.senderUid },
          repliedByUserId: candidate.repliedByUserId!, zaloMsgId: remoteId, contentType: source.kind,
          content: candidate.content || '', clientEchoId: candidate.clientEchoId, sentVia: 'user',
          metadata: attachmentMetadata(candidate, { ...source, status: 'accepted_pending_mirror' }, 'sent') as Record<string, unknown>,
        }).then((accepted) => publish(accepted)).catch(() => logger.error('[chat-outbox] acceptance persistence failed', { messageId: candidate.id }));
        continue;
      }
      const uncertain = attempted && isZaloDeliveryUncertain(error);
      const state = uncertain ? 'uncertain' : 'failed';
      const reason = uncertain ? 'Zalo chưa xác nhận kết quả. Không tự gửi lại để tránh trùng tin.'
        : error instanceof Error ? error.message.slice(0, 300) : 'Attachment send failed';
      const updated = await prisma.message.updateMany({
        where: { id: candidate.id, zaloMsgId: null, deliveryLeaseId: candidate.deliveryLeaseId },
        data: { deliveryState: state, deliveryLeaseId: null, deliveryLeaseUntil: null,
          metadata: attachmentMetadata(candidate, { ...source, status: state }, state, reason) },
      }).catch(() => ({ count: 0 }));
      if (updated.count) await publish(await prisma.message.findUniqueOrThrow({ where: { id: candidate.id } })).catch(() => {});
      logger.warn('[chat-outbox] send settled', { messageId: candidate.id, accountId, state });
    }
  } finally {
    await thumbnail?.cleanup().catch(() => {});
  }
}

export async function mirrorAttachment(row: Message, signal?: AbortSignal): Promise<void> {
  const job = attachmentJob(row);
  if (!job || job.status !== 'accepted_pending_mirror' || !row.zaloMsgId
    || (job.mirrorNextAt && new Date(job.mirrorNextAt).getTime() > Date.now())) return;
  try {
    const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: row.conversationId } });
    const processed = job.kind === 'image' ? await compressImage(await readFile(sourcePath(job), { signal }), job.mime) : null;
    signal?.throwIfAborted();
    const upload = processed
      ? await uploadBuffer(processed.buffer, processed.mimeType, job.filename, signal)
      : await uploadFile(sourcePath(job), job.mime, job.filename, signal);
    const thumbnail = job.thumbnailName === 'thumbnail.jpg'
      ? await uploadBuffer(await readFile(sourcePath({ ...job, filename: 'thumbnail.jpg' }), { signal }), 'image/jpeg', `${path.parse(job.filename).name}-thumbnail.jpg`, signal)
      : null;
    await recordMessageStorageReferences({ orgId: conversation.orgId, zaloAccountId: conversation.zaloAccountId,
      conversationId: conversation.id, messageId: row.id, createdAt: row.sentAt,
      uploads: [{ upload, purpose: 'primary' }, ...(thumbnail ? [{ upload: thumbnail, purpose: 'thumbnail' }] : [])] });
    const content = { ...JSON.parse(row.content || '{}'), href: upload.url, size: upload.size,
      ...(job.kind === 'image' ? { thumb: upload.url } : {}),
      ...(thumbnail ? { thumb: thumbnail.url, thumbUrl: thumbnail.url, thumbnail: thumbnail.url } : {}) };
    const updated = await prisma.message.updateMany({ where: { id: row.id, zaloMsgId: row.zaloMsgId, deliveryState: { in: ['accepted', 'completed'] } }, data: {
      content: JSON.stringify(content), deliveryState: 'completed', mediaMirrorState: 'mirrored', mediaMirrorNextAttemptAt: null,
      metadata: attachmentMetadata(row, { ...job, status: 'mirrored' }, 'sent'),
    } });
    if (updated.count) {
      await publish(await prisma.message.findUniqueOrThrow({ where: { id: row.id } })).catch(() => {});
      await removeAttachmentSource(job);
    }
  } catch {
    const attempts = (job.mirrorAttempts || 0) + 1;
    await prisma.message.updateMany({ where: { id: row.id, deliveryState: 'accepted' }, data: {
      mediaMirrorState: 'outbound_pending',
      mediaMirrorNextAttemptAt: new Date(Date.now() + Math.min(3_600_000, 5_000 * 2 ** Math.min(attempts, 10))),
      metadata: attachmentMetadata(row, { ...job, mirrorAttempts: attempts,
        mirrorNextAt: new Date(Date.now() + Math.min(3_600_000, 5_000 * 2 ** Math.min(attempts, 10))).toISOString() }, 'sent'),
    } });
    logger.warn('[chat-outbox] mirror retry scheduled', { messageId: row.id, attempts });
  }
}

export async function runChatAttachmentBatch(): Promise<void> {
  if (running || stopped) return;
  running = true;
  try {
    await runSystemQuery(() => recoverAttachmentLeases());
    const connected = Object.entries(zaloPool.getAllStatuses()).filter(([, status]) => status === 'connected').map(([id]) => id).sort();
    const rotated = [...connected.slice(accountCursor), ...connected.slice(0, accountCursor)].slice(0, 10);
    accountCursor = connected.length ? (accountCursor + Math.min(2, connected.length)) % connected.length : 0;
    const rows = await runSystemQuery(() => Promise.all(rotated.map((accountId) => prisma.message.findFirst({
      where: { senderType: 'self', isDeleted: false, deliveryState: 'prepared', deliveryLeaseId: null, conversation: { zaloAccountId: accountId },
        metadata: { path: ['outboundAttachment', 'sourceId'], not: Prisma.JsonNull } },
      include: { conversation: { select: { orgId: true, zaloAccountId: true } } },
      orderBy: [{ sentAt: 'asc' }, { id: 'asc' }],
    }))));
    let admittedBytes = 0;
    const sends = rows.filter((row): row is NonNullable<typeof row> => {
      if (!row) return false;
      const source = attachmentJob(row);
      if (!source) return false;
      const estimated = source.size * (source.kind === 'image' ? 3 : 1);
      if (admittedBytes > 0 && admittedBytes + estimated > 256 * 1024 * 1024) return false;
      admittedBytes += estimated;
      return true;
    }).slice(0, 2);
    const mirrors = await runSystemQuery(() => prisma.message.findMany({
      where: { senderType: 'self', deliveryState: 'accepted',
        metadata: { path: ['outboundAttachment', 'status'], equals: 'accepted_pending_mirror' },
        OR: [{ mediaMirrorNextAttemptAt: null }, { mediaMirrorNextAttemptAt: { lte: new Date() } }],
      }, include: { conversation: { select: { orgId: true } } }, orderBy: { sentAt: 'asc' }, take: 2,
    }));
    await Promise.all([
      ...sends.map((row) => withTenant(row.conversation.orgId, () => processAttachment(row.id, row.conversation.zaloAccountId))),
      ...mirrors.map((row) => withTenant(row.conversation.orgId, () => withDeliveryDeadline((signal) => mirrorAttachment(row, signal), 60_000).catch(() => {}))),
    ]);
  } finally { running = false; }
}

export function startChatAttachmentWorker(): void {
  stopped = false;
  if (timer) return;
  const gc = () => {
    if (Date.now() - lastGcAt < 60 * 60_000) return;
    lastGcAt = Date.now();
    void runSystemQuery(gcOrphanAttachmentSources).catch(() => logger.warn('[chat-outbox] source cleanup failed'));
  };
  gc();
  // Cleanup is intentionally separate from delivery; slow storage must not delay sends.
  timer = setInterval(() => {
    gc();
    void runChatAttachmentBatch().catch(() => logger.error('[chat-outbox] batch failed'));
  }, TICK_MS);
  timer.unref?.();
}

export function stopChatAttachmentWorker(): void {
  stopped = true;
  if (timer) clearInterval(timer);
  timer = undefined;
}
