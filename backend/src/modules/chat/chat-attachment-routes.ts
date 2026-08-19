// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * chat-attachment-routes.ts — Upload chat attachments (image/video) and send via Zalo.
 * Accepts multipart form with 1+ files + optional caption.
 * Flow: validate → save to tmp → upload to MinIO → call zca-js sendImage/sendVideo with local path → persist Message rows.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { unlink, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'socket.io';
import { emitChatMessage } from '../../shared/realtime/emit-chat.js';
import { extractZaloMsgId } from './chat-media-helpers.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireZaloAccess } from '../zalo/zalo-access-middleware.js';
import { zaloPool } from '../zalo/zalo-pool.js';
import { zaloRateLimiter } from '../zalo/zalo-rate-limiter.js';
import { isZaloDeliveryUncertain, zaloOps } from '../../shared/zalo-operations.js';
import { generateThumbnail, sendNativeVideo } from '../../shared/video-processor.js';
import { uploadBuffer, type UploadResult } from '../../shared/storage/minio-client.js';
import { recordMessageStorageReferences } from '../../shared/storage/storage-ledger.js';
import { compressImage } from '../media/media-service.js';
import { logger } from '../../shared/utils/logger.js';
// Fix 2026-06-03 — M11 optimistic badge cache (Anh báo "Sale CRM · Staff")
// 2026-06-11 — createMediaMessage gộp 4 block message.create lặp (DRY, eng review E4).
import {
  acquireMediaOutbox,
  createMediaMessage,
  getUserFullName,
  outboundDeliveryState,
  renewOutboundDeliveryLease,
} from './chat-helpers.js';

export const IMAGE_MAX = 100 * 1024 * 1024;
export const VIDEO_MAX = 500 * 1024 * 1024;
export const FILE_MAX = 1024 * 1024 * 1024;
const MIRROR_CONCURRENCY = 2;
const IMAGE_BATCH_SIZE = 3;
const DURABLE_STEP_ATTEMPTS = 3;
let activeMirrorTasks = 0;
const pendingMirrorTasks: Array<() => void> = [];

/** Keep Sharp/R2 work bounded across all concurrent chat requests. */
function withMirrorSlot<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      activeMirrorTasks += 1;
      task().then(resolve, reject).finally(() => {
        activeMirrorTasks -= 1;
        pendingMirrorTasks.shift()?.();
      });
    };
    if (activeMirrorTasks < MIRROR_CONCURRENCY) run();
    else pendingMirrorTasks.push(run);
  });
}

async function retryDurableStep<T>(label: string, task: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= DURABLE_STEP_ATTEMPTS; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt === DURABLE_STEP_ATTEMPTS) break;
      logger.warn(`[chat-attachment] ${label} failed (${attempt}/${DURABLE_STEP_ATTEMPTS}), retrying`, error);
      await new Promise((resolve) => setTimeout(resolve, attempt * 200));
    }
  }
  throw lastError;
}
export const ALLOWED_IMAGE = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const ALLOWED_VIDEO = ['video/mp4', 'video/quicktime', 'video/webm'];
export const ALLOWED_FILE = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'application/zip', 'application/x-zip-compressed',
  'application/gzip', 'application/x-gzip',
  'application/x-rar-compressed', 'application/vnd.rar',
  'application/x-tar', 'application/x-gtar',
];

function isAllowed(mime: string): boolean {
  return ALLOWED_IMAGE.includes(mime) || ALLOWED_VIDEO.includes(mime) || ALLOWED_FILE.includes(mime);
}

interface ParsedFile {
  filename: string;
  mimeType: string;
  kind: 'image' | 'video' | 'file';
  size: number;
}

function classify(mime: string): 'image' | 'video' | 'file' {
  if (ALLOWED_IMAGE.includes(mime)) return 'image';
  if (ALLOWED_VIDEO.includes(mime)) return 'video';
  return 'file';
}

export function resolveAttachmentEchoIds(
  suppliedEchoIds: string[],
  batchEchoId: string,
  fileCount: number,
): Array<string | null> {
  return Array.from({ length: fileCount }, (_, index) =>
    suppliedEchoIds[index] || (batchEchoId ? `${batchEchoId}:${index}` : null),
  );
}

export function failedAttachmentIndices(fileCount: number, completedIndices: Iterable<number>): number[] {
  const completed = new Set(completedIndices);
  return Array.from({ length: fileCount }, (_, index) => index).filter((index) => !completed.has(index));
}

type AttachmentOutboxRow = {
  zaloMsgId?: string | null;
  sentAt?: Date | string;
  metadata?: unknown;
  deliveryState?: string | null;
  deliveryLeaseUntil?: Date | string | null;
};

export function attachmentOutboxStatus(message: AttachmentOutboxRow): string | null {
  const metadata = message.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const outbound = (metadata as { outboundAttachment?: unknown }).outboundAttachment;
  if (!outbound || typeof outbound !== 'object' || Array.isArray(outbound)) return null;
  const status = (outbound as { status?: unknown }).status;
  return typeof status === 'string' ? status : null;
}

export function attachmentDeliveryAccepted(message: AttachmentOutboxRow): boolean {
  const state = outboundDeliveryState(message);
  return state === 'accepted' || state === 'completed';
}

function attachmentDeliveryPending(message: AttachmentOutboxRow): boolean {
  const state = outboundDeliveryState(message);
  return state === 'submitting' || state === 'uncertain';
}

export async function chatAttachmentRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  app.post(
    '/api/v1/conversations/:id/attachments',
    { preHandler: requireZaloAccess('chat') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const requestStartedAt = Date.now();
      const user = request.user!;
      const { id } = request.params as { id: string };

      const conversation = await prisma.conversation.findFirst({
        where: { id, orgId: user.orgId },
        include: { zaloAccount: true },
      });
      if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

      // T7b (YC2 2026-06-20): chặn gửi file/ảnh qua nick ĐÃ XÓA (archivedAt).
      if (conversation.zaloAccount.archivedAt) {
        return reply.status(409).send({ error: 'Nick này đã bị xóa — chỉ xem lại lịch sử, không gửi được.', code: 'NICK_ARCHIVED' });
      }

      // Fix 2026-06-03 — optimistic badge "Sale CRM · {tên}"
      const userFullName = await getUserFullName(user.id);

      const instance = zaloPool.getInstance(conversation.zaloAccountId);
      if (!instance?.api) return reply.status(400).send({ error: 'Zalo account not connected' });

      // PRIVACY GUARD cấp HỘI THOẠI 2026-07-09: "Chỉ mình tôi xem" → người khác không gửi.
      if (conversation.isPrivate && conversation.privateOwnerUserId !== ((user as any).userId ?? user.id)) {
        return reply.status(403).send({
          error: 'Cuộc hội thoại này đang ở chế độ riêng tư.',
          code: 'CONVERSATION_PRIVATE',
        });
      }

      // PRIVACY GUARD 2026-05-22: nick privacy=main → chỉ chính chủ upload được
      if (conversation.zaloAccount.privacyMode === 'main') {
        const senderUserId = (user as any).userId ?? user.id;
        if (conversation.zaloAccount.ownerUserId !== senderUserId) {
          return reply.status(403).send({
            error: 'Nick này đang bật Riêng tư — chỉ chính chủ mới gửi được file/ảnh.',
            code: 'PRIVACY_LOCKED',
          });
        }
      }

      // The key/count are headers so a retry can be deduplicated before the
      // browser uploads the bytes again.
      const headerEchoId = String(request.headers['x-attachment-echo-id'] ?? '').trim().slice(0, 180);
      const headerFileCount = Number(request.headers['x-attachment-count'] ?? 0);
      const headerEchoIds = (() => {
        try {
          const parsed = JSON.parse(String(request.headers['x-attachment-echo-ids'] ?? '[]'));
          if (!Array.isArray(parsed)) return [];
          return parsed.map((value) => String(value).trim().slice(0, 180)).filter(Boolean).slice(0, 50);
        } catch {
          return [];
        }
      })();
      const preflightEchoIds = headerEchoIds.length === headerFileCount
        ? headerEchoIds
        : headerEchoId && Number.isInteger(headerFileCount) && headerFileCount > 0 && headerFileCount <= 50
          ? Array.from({ length: headerFileCount }, (_, index) => `${headerEchoId}:${index}`)
          : [];
      if (preflightEchoIds.length > 0) {
        const existing = await prisma.message.findMany({
          where: { conversationId: id, clientEchoId: { in: preflightEchoIds } },
          orderBy: { sentAt: 'asc' },
        });
        if (
          existing.length === preflightEchoIds.length
          && existing.every(attachmentDeliveryAccepted)
        ) {
          return { messages: existing, deduplicated: true };
        }
        const pendingIndexes = preflightEchoIds
          .map((echoId, index) => existing.some((message) => message.clientEchoId === echoId && attachmentDeliveryPending(message)) ? index : -1)
          .filter((index) => index >= 0);
        if (pendingIndexes.length > 0) {
          const resolved = new Set(existing.map((message) => message.clientEchoId).filter(Boolean));
          const failedIndices = preflightEchoIds
            .map((echoId, index) => resolved.has(echoId) ? -1 : index)
            .filter((index) => index >= 0);
          return reply.status(failedIndices.length > 0 ? 207 : 202).send({
            messages: existing,
            deduplicated: true,
            pendingConfirmation: true,
            pendingConfirmationIndices: pendingIndexes,
            ...(failedIndices.length > 0 ? { partial: true, failedIndices } : {}),
          });
        }
      }

      // A retry for an already accepted batch must be allowed through even if
      // the account is currently rate-limited. Only new Zalo sends consume the
      // limiter budget.
      const limits = await zaloRateLimiter.checkLimits(conversation.zaloAccountId);
      if (!limits.allowed) return reply.status(429).send({ error: limits.reason });

      // Parse multipart parts
      let caption = '';
      let echoId = headerEchoId;
      let suppliedEchoIds = headerEchoIds;
      const files: ParsedFile[] = [];
      const tmpRoot = path.join(tmpdir(), 'zalocrm-upload', randomUUID());
      const tmpPaths: string[] = [];
      await mkdir(tmpRoot, { recursive: true });
      try {
        for await (const part of request.parts()) {
          if (part.type === 'field' && part.fieldname === 'caption') {
            caption = String(part.value ?? '');
          } else if (part.type === 'field' && part.fieldname === 'echoId') {
            echoId = String(part.value ?? '').trim().slice(0, 180);
          } else if (part.type === 'field' && part.fieldname === 'echoIds') {
            try {
              const parsed = JSON.parse(String(part.value ?? '[]'));
              if (Array.isArray(parsed)) {
                suppliedEchoIds = parsed.map((value) => String(value).trim().slice(0, 180)).filter(Boolean).slice(0, 50);
              }
            } catch {
              suppliedEchoIds = [];
            }
          } else if (part.type === 'file') {
            if (!isAllowed(part.mimetype)) {
              await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
              return reply.status(415).send({ error: `Unsupported file type: ${part.mimetype}` });
            }
            const kind = classify(part.mimetype);
            const safeFilename = path.basename(part.filename || 'upload');
            const tmpPath = path.join(tmpRoot, `${files.length}-${safeFilename}`);
            await pipeline(part.file, createWriteStream(tmpPath, { flags: 'wx' }));
            if (part.file.truncated) {
              await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
              return reply.status(413).send({ error: 'File exceeds the server upload limit' });
            }
            const { size } = await stat(tmpPath);
            const max = kind === 'image' ? IMAGE_MAX : kind === 'video' ? VIDEO_MAX : FILE_MAX;
            if (size > max) {
              await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
              return reply.status(413).send({ error: `${kind} exceeds ${max / 1024 / 1024}MB` });
            }
            tmpPaths.push(tmpPath);
            files.push({ filename: safeFilename, mimeType: part.mimetype, kind, size });
          }
        }
      } catch (err: any) {
        await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
        return reply.status(400).send({ error: `multipart parse error: ${err?.message ?? err}` });
      }

      if (files.length === 0) {
        await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
        return reply.status(400).send({ error: 'No files uploaded' });
      }

      // Mỗi file có một echoId ổn định. Khi một lô chỉ gửi thành công một phần,
      // lần retry có thể chỉ upload các file lỗi mà không đổi danh tính/index.
      const fileEchoIds = resolveAttachmentEchoIds(suppliedEchoIds, echoId, files.length);
      const expectedEchoIds = fileEchoIds.filter((value): value is string => !!value);
      const existing = expectedEchoIds.length > 0
        ? await prisma.message.findMany({
            where: { conversationId: id, clientEchoId: { in: expectedEchoIds } },
            orderBy: { sentAt: 'asc' },
          })
        : [];
      const acceptedExisting = existing.filter(attachmentDeliveryAccepted);
      const pendingExisting = existing.filter(attachmentDeliveryPending);
      const existingByEchoId = new Map(
        [...acceptedExisting, ...pendingExisting]
          .filter((message) => message.clientEchoId)
          .map((message) => [message.clientEchoId!, message]),
      );
      if (expectedEchoIds.length === files.length && acceptedExisting.length === expectedEchoIds.length) {
        await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
        return { messages: acceptedExisting, deduplicated: true };
      }
      if (expectedEchoIds.length === files.length && existingByEchoId.size === expectedEchoIds.length) {
        await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
        return reply.status(202).send({
          messages: files.map((_, index) => existingByEchoId.get(fileEchoIds[index] ?? '')).filter(Boolean),
          deduplicated: true,
          pendingConfirmation: true,
        });
      }

      const threadId = conversation.externalThreadId || '';
      const threadType = conversation.threadType === 'group' ? 1 : 0;
      const io = (app as any).io as Server;

      // Files are already streamed to tmp. Mirroring can overlap with the Zalo upload.
      const mirrors: UploadResult[] = [];
      const completedByIndex = new Map<number, any>();
      const acceptedByIndex = new Map<number, any>();
      const zaloAcceptedIndices = new Set<number>();
      const acceptedZaloMsgIds = new Map<number, string>();
      const pendingConfirmationByIndex = new Map<number, any>();
      const acquiredIndices = new Set<number>();
      const acquiredMessageIds: string[] = [];
      const attemptedIndices = new Set<number>();
      fileEchoIds.forEach((fileEchoId, index) => {
        if (fileEchoId && existingByEchoId.has(fileEchoId)) {
          completedByIndex.set(index, existingByEchoId.get(fileEchoId));
        }
      });
      let newlyCreatedCount = 0;
      const deliveryLeaseId = randomUUID();
      let leaseHeartbeat: ReturnType<typeof setInterval> | null = null;
      try {
        const tmpReadyAt = Date.now();

        const pendingFileContent = (index: number) => {
          const file = files[index];
          return file.kind === 'file'
            ? JSON.stringify({ href: '', name: file.filename, size: file.size, mime: file.mimeType, title: caption })
            : JSON.stringify({ href: '', thumb: '', size: file.size, name: file.filename, title: caption });
        };
        // Claim every per-file echo id before touching Zalo. A concurrent retry
        // can observe the row, but only this request receives `acquired`.
        for (let index = 0; index < files.length; index += 1) {
          if (completedByIndex.has(index)) continue;
          const acquired = await retryDurableStep(`acquire outbound file ${index}`, () => acquireMediaOutbox({
            conversationId: id,
            zaloAccount: conversation.zaloAccount,
            repliedByUserId: user.id,
            zaloMsgId: '',
            contentType: files[index].kind,
            content: pendingFileContent(index),
            metadata: {
              sender: { kind: 'user_crm', name: userFullName },
              sendStatus: 'sending',
              outboundAttachment: { status: 'submitting' },
            },
            sentVia: 'user',
            clientEchoId: fileEchoIds[index],
            sentAt: new Date(),
            deliveryLeaseId,
          }));
          if (acquired.state === 'accepted') {
            acceptedByIndex.set(index, acquired.message);
            completedByIndex.set(index, acquired.message);
          } else if (acquired.state === 'in_progress' || acquired.state === 'uncertain') {
            pendingConfirmationByIndex.set(index, acquired.message);
            completedByIndex.set(index, acquired.message);
          } else {
            acquiredIndices.add(index);
            acquiredMessageIds.push(acquired.message.id);
          }
        }
        if (acquiredMessageIds.length > 0) {
          leaseHeartbeat = setInterval(() => {
            void renewOutboundDeliveryLease(acquiredMessageIds, deliveryLeaseId)
              .catch((error) => logger.warn('[chat-attachment] delivery lease heartbeat failed', error));
          }, 60_000);
          leaseHeartbeat.unref?.();
        }

        // The CRM mirror is not required by the Zalo API. Running it concurrently
        // removes a full storage/nén wait from the perceived send latency.
        const mirrorTasks = files.map((f, i) => {
          if (completedByIndex.has(i)) return Promise.resolve();
          return withMirrorSlot(() => retryDurableStep(`mirror file ${i}`, async () => {
          // 2026-06-22: NÉN ảnh trước khi LƯU mirror (R2) — giảm dung lượng. Ảnh GỬI khách dùng
          // tmpPath (bytes GỐC) nên khách vẫn nhận ảnh nét; chỉ bản lưu/hiển thị-CRM là webp nhẹ.
          // compressImage tự bỏ qua video/file + gif/định dạng lạ + fallback gốc nếu sharp lỗi.
            const source = await readFile(tmpPaths[i]);
            const proc = f.kind === 'image'
              ? await compressImage(source, f.mimeType)
              : { buffer: source, mimeType: f.mimeType };
            mirrors[i] = await uploadBuffer(proc.buffer, proc.mimeType, f.filename);
          }));
        });
        // A Zalo failure can return before a mirror task finishes. Attach a
        // rejection handler now so that such a late storage error is logged,
        // rather than becoming an unhandled promise rejection.
        void Promise.all(mirrorTasks).catch((err) => logger.error('[chat-attachment] mirror failed:', err));

        const recordStorage = async (
          message: { id: string; sentAt?: Date },
          uploads: Array<{ upload: UploadResult; purpose: string }>,
        ) => {
          await recordMessageStorageReferences({
            orgId: user.orgId,
            zaloAccountId: conversation.zaloAccountId,
            conversationId: id,
            messageId: message.id,
            uploads,
            createdAt: message.sentAt,
          }).catch((err) => logger.error('[storage-ledger] outbound message reference failed', {
            messageId: message.id,
            err,
          }));
        };
        const completeFile = async (index: number, message: any) => {
          completedByIndex.set(index, message);
          newlyCreatedCount += 1;
          await emitChatMessage({
            io,
            orgId: user.orgId,
            accountId: conversation.zaloAccountId,
            conversationId: id,
            message,
            privacyMode: conversation.zaloAccount.privacyMode,
            ownerUserId: conversation.zaloAccount.ownerUserId,
            isPrivate: conversation.isPrivate,
            privateOwnerUserId: conversation.privateOwnerUserId,
          });
        };
        const prepareAcceptedFile = async (index: number, zaloMsgId: string) => {
          const message = await retryDurableStep(`persist accepted file ${index}`, () => createMediaMessage({
            conversationId: id,
            zaloAccount: conversation.zaloAccount,
            repliedByUserId: user.id,
            zaloMsgId,
            contentType: files[index].kind,
            content: pendingFileContent(index),
            metadata: {
              sender: { kind: 'user_crm', name: userFullName },
              sendStatus: 'sending',
              outboundAttachment: { status: 'zalo_accepted' },
            },
            sentVia: 'user',
            clientEchoId: fileEchoIds[index],
          }));
          acceptedByIndex.set(index, message);
          return message;
        };

        // Split by kind — image batch vs video one-by-one vs file one-by-one
        const imageIndexes: number[] = [];
        const videoIndexes: number[] = [];
        const fileIndexes: number[] = [];
        files.forEach((f, i) => {
          if (completedByIndex.has(i)) return;
          if (f.kind === 'image') imageIndexes.push(i);
          else if (f.kind === 'video') videoIndexes.push(i);
          else fileIndexes.push(i);
        });

        // Send images as one zca-js call (supports multiple paths at once)
        if (imageIndexes.length > 0) {
          // zca-js uploads every path in a call concurrently. Small batches avoid
          // the known socket-close failure of larger albums while preserving order.
          for (let start = 0; start < imageIndexes.length; start += IMAGE_BATCH_SIZE) {
            const batchIndexes = imageIndexes.slice(start, start + IMAGE_BATCH_SIZE);
            const paths = batchIndexes.map((i) => tmpPaths[i]);
            batchIndexes.forEach((index) => {
              attemptedIndices.add(index);
            });
            const sendResult: any = await zaloOps.sendImage(
              conversation.zaloAccountId, threadId, threadType as 0 | 1, paths, io, caption,
              { maxAttempts: 1 },
            );
          // FIX 2026-07-13 — msgId PER ẢNH. Gửi lô N ảnh = 1 lệnh sendMessage, zca-js trả
          // `attachment: [{msgId}, ...]` mỗi phần tử ứng 1 ảnh. Nếu dùng CHUNG 1 msgId cho
          // mọi ảnh thì message thứ 2 vi phạm UNIQUE(conversation_id, zalo_msg_id) → create
          // văng lỗi → KHÔNG tin nào được tạo → ảnh "không hiện". Thiếu msgId → '' (lưu NULL,
          // NULL không đụng UNIQUE).
            const attachArr: any[] = Array.isArray(sendResult?.attachment) ? sendResult.attachment : [];
            const usedMsgIds = new Set<string>();
            const batchZaloMsgIds = batchIndexes.map((_, k) => {
              let zaloMsgId = String(attachArr[k]?.msgId ?? '');
            // Lô 1 ảnh: một số shape chỉ trả msgId ở cấp ngoài.
              if (!zaloMsgId && batchIndexes.length === 1) zaloMsgId = extractZaloMsgId(sendResult);
            // Chống trùng trong cùng lô (an toàn tuyệt đối với UNIQUE).
              if (zaloMsgId && usedMsgIds.has(zaloMsgId)) zaloMsgId = '';
              if (zaloMsgId) usedMsgIds.add(zaloMsgId);
              return zaloMsgId;
            });
            batchIndexes.forEach((index, position) => {
              zaloAcceptedIndices.add(index);
              acceptedZaloMsgIds.set(index, batchZaloMsgIds[position]);
            });

            // Persist Zalo acceptance before waiting for compression/storage.
            // A retry can now recover this row without delivering the image twice.
            await Promise.all(batchIndexes.map((i, k) => prepareAcceptedFile(i, batchZaloMsgIds[k])));
            await Promise.all(batchIndexes.map((i) => mirrorTasks[i]));

            for (const [k, i] of batchIndexes.entries()) {
              const zaloMsgId = batchZaloMsgIds[k];
              const mirror = mirrors[i];
              const msg = await retryDurableStep(`finalize image ${i}`, () => createMediaMessage({
                conversationId: id,
                zaloAccount: conversation.zaloAccount,
                repliedByUserId: user.id,
                zaloMsgId,
                contentType: 'image',
                content: JSON.stringify({ href: mirror.url, thumb: mirror.url, size: mirror.size, title: caption }),
                metadata: {
                  sender: { kind: 'user_crm', name: userFullName },
                  sendStatus: 'sent',
                  outboundAttachment: { status: 'mirrored' },
                },
                sentVia: 'user',
                clientEchoId: fileEchoIds[i],
              }));
              await recordStorage(msg, [{ upload: mirror, purpose: 'primary' }]);
              await completeFile(i, msg);
            }
          }
        }

        // Send videos one-by-one using native sendVideo
        for (const i of videoIndexes) {
          let generatedThumbnail: Awaited<ReturnType<typeof generateThumbnail>> | null = null;
          let thumbnailMirror: UploadResult | null = null;
          let thumbnailMirrorTask: Promise<UploadResult> | null = null;
          let nativeDeliveryAccepted = false;
          try {
            generatedThumbnail = await generateThumbnail(tmpPaths[i]);
            thumbnailMirrorTask = withMirrorSlot(async () => {
              const thumbnailBuffer = await readFile(generatedThumbnail!.path);
              const baseName = path.parse(files[i].filename || 'video').name || 'video';
              return uploadBuffer(thumbnailBuffer, 'image/jpeg', `${baseName}-thumbnail.jpg`);
            });
          } catch (err) {
            logger.warn('[chat-attachment] Video thumbnail generation failed:', err);
          }
          try {
            attemptedIndices.add(i);
            const sendResult: any = await sendNativeVideo({
              api: instance.api as any,
              accountId: conversation.zaloAccountId,
              videoPath: tmpPaths[i],
              thumbnailPath: generatedThumbnail?.path,
              threadId,
              threadType: threadType as 0 | 1,
              message: caption,
              maxAttempts: 1,
            });
            nativeDeliveryAccepted = true;
            const zaloMsgId = extractZaloMsgId(sendResult);
            zaloAcceptedIndices.add(i);
            acceptedZaloMsgIds.set(i, zaloMsgId);
            await prepareAcceptedFile(i, zaloMsgId);
            const [, mirroredThumbnail] = await Promise.all([mirrorTasks[i], thumbnailMirrorTask]).catch((error) => {
              throw new Error(`VIDEO_SEND_UNCERTAIN: mirror failed after send: ${(error as Error)?.message ?? error}`);
            });
            thumbnailMirror = mirroredThumbnail ?? null;
            const mirror = mirrors[i];
            const thumbUrl = thumbnailMirror?.url ?? mirror.url;
            const msg = await retryDurableStep(`finalize video ${i}`, () => createMediaMessage({
              conversationId: id,
              zaloAccount: conversation.zaloAccount,
              repliedByUserId: user.id,
              zaloMsgId,
              contentType: 'video',
              content: JSON.stringify({ href: mirror.url, thumb: thumbUrl, thumbUrl, thumbnail: thumbUrl, size: mirror.size, title: caption }),
              metadata: {
                sender: { kind: 'user_crm', name: userFullName },
                sendStatus: 'sent',
                outboundAttachment: { status: 'mirrored' },
              },
              sentVia: 'user',
              clientEchoId: fileEchoIds[i],
            }));
            await recordStorage(msg, [
              { upload: mirror, purpose: 'primary' },
              ...(thumbnailMirror ? [{ upload: thumbnailMirror, purpose: 'thumbnail' }] : []),
            ]);
            await completeFile(i, msg);
          } catch (err) {
            if (
              nativeDeliveryAccepted
              || isZaloDeliveryUncertain(err)
              || String((err as Error)?.message || err).includes('VIDEO_SEND_UNCERTAIN')
            ) {
              throw err;
            }
            logger.error('[chat-attachment] Native video send failed, trying fallback:', err);
            // Fallback: regular attachment send
            const sendResult: any = await zaloOps.sendFile(
              conversation.zaloAccountId,
              threadId,
              threadType as 0 | 1,
              [tmpPaths[i]],
              io,
              '',
              { maxAttempts: 1 },
            );
            const zaloMsgId = extractZaloMsgId(sendResult);
            zaloAcceptedIndices.add(i);
            acceptedZaloMsgIds.set(i, zaloMsgId);
            await prepareAcceptedFile(i, zaloMsgId);
            const [, mirroredThumbnail] = await Promise.all([mirrorTasks[i], thumbnailMirrorTask]);
            thumbnailMirror = mirroredThumbnail ?? null;
            const mirror = mirrors[i];
            const thumbUrl = thumbnailMirror?.url ?? mirror.url;
            const msg = await retryDurableStep(`finalize fallback video ${i}`, () => createMediaMessage({
              conversationId: id,
              zaloAccount: conversation.zaloAccount,
              repliedByUserId: user.id,
              zaloMsgId,
              contentType: 'video',
              content: JSON.stringify({ href: mirror.url, thumb: thumbUrl, thumbUrl, thumbnail: thumbUrl, size: mirror.size, title: caption }),
              metadata: {
                sender: { kind: 'user_crm', name: userFullName },
                sendStatus: 'sent',
                outboundAttachment: { status: 'mirrored' },
              },
              sentVia: 'user',
              clientEchoId: fileEchoIds[i],
            }));
            await recordStorage(msg, [
              { upload: mirror, purpose: 'primary' },
              ...(thumbnailMirror ? [{ upload: thumbnailMirror, purpose: 'thumbnail' }] : []),
            ]);
            await completeFile(i, msg);
          } finally {
            await generatedThumbnail?.cleanup().catch(() => {});
          }
        }

        // Send files (generic) one-by-one
        for (const i of fileIndexes) {
          attemptedIndices.add(i);
          const sendResult: any = await zaloOps.sendFile(
            conversation.zaloAccountId,
            threadId,
            threadType as 0 | 1,
            [tmpPaths[i]],
            io,
            caption,
            { maxAttempts: 1 },
          );
          const zaloMsgId = extractZaloMsgId(sendResult);
          zaloAcceptedIndices.add(i);
          acceptedZaloMsgIds.set(i, zaloMsgId);
          await prepareAcceptedFile(i, zaloMsgId);
          await mirrorTasks[i];
          const mirror = mirrors[i];
          const f = files[i];
          const msg = await retryDurableStep(`finalize file ${i}`, () => createMediaMessage({
            conversationId: id,
            zaloAccount: conversation.zaloAccount,
            repliedByUserId: user.id,
            zaloMsgId,
            contentType: 'file',
            content: JSON.stringify({ href: mirror.url, name: f.filename, size: mirror.size, mime: f.mimeType, title: caption }),
            metadata: {
              sender: { kind: 'user_crm', name: userFullName },
              sendStatus: 'sent',
              outboundAttachment: { status: 'mirrored' },
            },
            sentVia: 'user',
            clientEchoId: fileEchoIds[i],
          }));
          await recordStorage(msg, [{ upload: mirror, purpose: 'primary' }]);
          await completeFile(i, msg);
        }

        await prisma.conversation.update({
          where: { id },
          data: { lastMessageAt: new Date(), isReplied: true, unreadCount: 0 },
        });

        logger.info('[chat-perf] attachment send', {
          conversationId: id,
          files: files.length,
          kinds: files.map((file) => file.kind),
          tmpMs: tmpReadyAt - requestStartedAt,
          totalMs: Date.now() - requestStartedAt,
        });

        const responseBody = {
          messages: files.map((_, index) => completedByIndex.get(index)).filter(Boolean),
          deduplicated: acceptedExisting.length > 0,
        };
        if (pendingConfirmationByIndex.size > 0) {
          return reply.status(202).send({
            ...responseBody,
            pendingConfirmation: true,
            pendingConfirmationIndices: Array.from(pendingConfirmationByIndex.keys()),
            code: 'ATTACHMENT_IN_PROGRESS',
            message: 'Một số tệp đang được Zalo xác nhận.',
          });
        }
        return responseBody;
      } catch (err: any) {
        logger.error('[chat-attachment] upload error:', err);
        // The listener may already have claimed the durable row created before
        // the Zalo call. Resolve exact echo ids before using the looser fallback.
        for (const index of attemptedIndices) {
          if (acceptedByIndex.has(index) || !fileEchoIds[index]) continue;
          const persisted = await prisma.message.findUnique({
            where: {
              conversationId_clientEchoId: {
                conversationId: id,
                clientEchoId: fileEchoIds[index]!,
              },
            },
          }).catch(() => null);
          if (persisted && (zaloAcceptedIndices.has(index) || attachmentDeliveryAccepted(persisted))) {
            acceptedByIndex.set(index, persisted);
          }
        }
        // A socket timeout can hide a successful Zalo delivery. The listener now
        // claims the exact durable row, so poll those echo ids only. Never adopt
        // a nearby native-Zalo upload by type/time.
        for (let poll = 0; poll < 8; poll += 1) {
          const missing = Array.from(attemptedIndices).filter((index) => !acceptedByIndex.has(index));
          if (missing.length === 0) break;
          if (poll > 0) await new Promise((resolve) => setTimeout(resolve, 500));
          for (const index of missing) {
            const echoId = fileEchoIds[index];
            if (!echoId) continue;
            const persisted = await prisma.message.findUnique({
              where: { conversationId_clientEchoId: { conversationId: id, clientEchoId: echoId } },
            }).catch(() => null);
            if (persisted && attachmentDeliveryAccepted(persisted)) acceptedByIndex.set(index, persisted);
          }
        }
        // Zalo already acknowledged these files. Keep their durable rows and
        // never put them back into the client retry queue, even if mirroring or
        // a later persistence step failed.
        for (const [index, accepted] of acceptedByIndex) {
          if (completedByIndex.has(index)) continue;
          const echoId = fileEchoIds[index];
          const current = echoId
            ? await prisma.message.findUnique({
                where: { conversationId_clientEchoId: { conversationId: id, clientEchoId: echoId } },
              }).catch(() => null)
            : await prisma.message.findUnique({ where: { id: accepted.id } }).catch(() => null);
          if (!current) continue;
          const currentMetadata = current.metadata && typeof current.metadata === 'object' && !Array.isArray(current.metadata)
            ? current.metadata as Record<string, unknown>
            : {};
          const acceptedZaloMsgId = acceptedZaloMsgIds.get(index) || '';
          const settled = await prisma.message.update({
            where: { id: current.id },
            data: {
              ...(acceptedZaloMsgId
                ? {
                    zaloMsgId: acceptedZaloMsgId,
                    zaloMsgIdNum: /^\d+$/.test(acceptedZaloMsgId) ? BigInt(acceptedZaloMsgId) : null,
                  }
                : {}),
              metadata: {
                ...currentMetadata,
                sendStatus: 'sent',
                outboundAttachment: { status: 'accepted_pending_mirror' },
              },
              deliveryState: 'accepted',
              deliveryLeaseId: null,
              deliveryLeaseUntil: null,
            },
          }).catch(() => current);
          completedByIndex.set(index, settled);
          newlyCreatedCount += 1;
          await emitChatMessage({
            io: (app as any).io as Server,
            orgId: user.orgId,
            accountId: conversation.zaloAccountId,
            conversationId: id,
            message: settled,
            privacyMode: conversation.zaloAccount.privacyMode,
            ownerUserId: conversation.zaloAccount.ownerUserId,
            isPrivate: conversation.isPrivate,
            privateOwnerUserId: conversation.privateOwnerUserId,
          }).catch(() => {});
        }
        if (newlyCreatedCount > 0) {
          await prisma.conversation.update({
            where: { id },
            data: { lastMessageAt: new Date(), isReplied: true, unreadCount: 0 },
          }).catch(() => {});
        }
        const ambiguousDelivery = isZaloDeliveryUncertain(err)
          || String(err?.message || err).includes('VIDEO_SEND_UNCERTAIN');
        const unresolvedIndices = failedAttachmentIndices(files.length, completedByIndex.keys());
        for (const index of unresolvedIndices) {
          if (!acquiredIndices.has(index)) continue;
          const fileEchoId = fileEchoIds[index];
          if (!fileEchoId) continue;
          const current = await prisma.message.findUnique({
            where: { conversationId_clientEchoId: { conversationId: id, clientEchoId: fileEchoId } },
          }).catch(() => null);
          if (!current || attachmentDeliveryAccepted(current)) continue;
          const currentMetadata = current.metadata && typeof current.metadata === 'object' && !Array.isArray(current.metadata)
            ? current.metadata as Record<string, unknown>
            : {};
          const isUncertain = ambiguousDelivery && attemptedIndices.has(index);
          const settled = await prisma.message.update({
            where: { id: current.id },
            data: {
              metadata: {
                ...currentMetadata,
                sendStatus: isUncertain ? 'sending' : 'failed',
                ...(isUncertain ? {} : { failReason: err?.message ?? 'attachment send failed' }),
                outboundAttachment: {
                  status: isUncertain ? 'uncertain' : 'failed',
                  ...(isUncertain ? { reason: err?.message ?? 'Zalo chưa trả kết quả gửi' } : {}),
                },
              },
              deliveryState: isUncertain ? 'uncertain' : 'failed',
              deliveryLeaseId: null,
              deliveryLeaseUntil: null,
            },
          }).catch(() => current);
          if (isUncertain) {
            pendingConfirmationByIndex.set(index, settled);
            completedByIndex.set(index, settled);
            await emitChatMessage({
              io: (app as any).io as Server,
              orgId: user.orgId,
              accountId: conversation.zaloAccountId,
              conversationId: id,
              message: settled,
              privacyMode: conversation.zaloAccount.privacyMode,
              ownerUserId: conversation.zaloAccount.ownerUserId,
              isPrivate: conversation.isPrivate,
              privateOwnerUserId: conversation.privateOwnerUserId,
            }).catch(() => {});
          }
        }
        if (pendingConfirmationByIndex.size > 0) {
          await prisma.conversation.update({
            where: { id },
            data: { lastMessageAt: new Date(), isReplied: true, unreadCount: 0 },
          }).catch(() => {});
        }
        const failedIndices = failedAttachmentIndices(files.length, completedByIndex.keys());
        const response = {
          messages: files.map((_, index) => completedByIndex.get(index)).filter(Boolean),
          ...(pendingConfirmationByIndex.size > 0
            ? {
                pendingConfirmation: true,
                pendingConfirmationIndices: Array.from(pendingConfirmationByIndex.keys()),
              }
            : {}),
          ...(failedIndices.length > 0
            ? { partial: true, failedIndices, error: err?.message ?? 'attachment send failed' }
            : {}),
        };
        return reply.status(failedIndices.length > 0 ? 207 : 202).send(response);
      } finally {
        if (leaseHeartbeat) clearInterval(leaseHeartbeat);
        // Clean tmp files (best effort)
        for (const p of tmpPaths) {
          if (p) await unlink(p).catch(() => {});
        }
        await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
      }
    },
  );
}
