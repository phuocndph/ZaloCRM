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
import { zaloOps } from '../../shared/zalo-operations.js';
import { generateThumbnail, sendNativeVideo } from '../../shared/video-processor.js';
import { uploadBuffer, type UploadResult } from '../../shared/storage/minio-client.js';
import { recordMessageStorageReferences } from '../../shared/storage/storage-ledger.js';
import { compressImage } from '../media/media-service.js';
import { logger } from '../../shared/utils/logger.js';
// Fix 2026-06-03 — M11 optimistic badge cache (Anh báo "Sale CRM · Staff")
// 2026-06-11 — createMediaMessage gộp 4 block message.create lặp (DRY, eng review E4).
import { getUserFullName, createMediaMessage } from './chat-helpers.js';

export const IMAGE_MAX = 100 * 1024 * 1024;
export const VIDEO_MAX = 500 * 1024 * 1024;
export const FILE_MAX = 1024 * 1024 * 1024;
const MIRROR_CONCURRENCY = 2;
const IMAGE_BATCH_SIZE = 3;
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

      const limits = await zaloRateLimiter.checkLimits(conversation.zaloAccountId);
      if (!limits.allowed) return reply.status(429).send({ error: limits.reason });

      // The key/count are headers so a retry can be deduplicated before the
      // browser uploads the bytes again.
      const headerEchoId = String(request.headers['x-attachment-echo-id'] ?? '').trim().slice(0, 180);
      const headerFileCount = Number(request.headers['x-attachment-count'] ?? 0);
      if (headerEchoId && Number.isInteger(headerFileCount) && headerFileCount > 0 && headerFileCount <= 10) {
        const expectedEchoIds = Array.from({ length: headerFileCount }, (_, index) => `${headerEchoId}:${index}`);
        const existing = await prisma.message.findMany({
          where: { conversationId: id, clientEchoId: { in: expectedEchoIds } },
          orderBy: { sentAt: 'asc' },
        });
        if (existing.length === expectedEchoIds.length) return { messages: existing, deduplicated: true };
      }

      // Parse multipart parts
      let caption = '';
      let echoId = headerEchoId;
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

      // A timeout can leave the browser unsure whether Zalo already received the
      // upload. Reuse the same echoId on retry and return the complete prior send.
      if (echoId) {
        const expectedEchoIds = files.map((_, index) => `${echoId}:${index}`);
        const existing = await prisma.message.findMany({
          where: { conversationId: id, clientEchoId: { in: expectedEchoIds } },
          orderBy: { sentAt: 'asc' },
        });
        if (existing.length === expectedEchoIds.length) {
          await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
          return { messages: existing, deduplicated: true };
        }
      }

      const threadId = conversation.externalThreadId || '';
      const threadType = conversation.threadType === 'group' ? 1 : 0;
      const io = (app as any).io as Server;

      // Files are already streamed to tmp. Mirroring can overlap with the Zalo upload.
      const mirrors: UploadResult[] = [];
      try {
        const tmpReadyAt = Date.now();

        // The CRM mirror is not required by the Zalo API. Running it concurrently
        // removes a full storage/nén wait from the perceived send latency.
        const mirrorTasks = files.map((f, i) => withMirrorSlot(async () => {
          // 2026-06-22: NÉN ảnh trước khi LƯU mirror (R2) — giảm dung lượng. Ảnh GỬI khách dùng
          // tmpPath (bytes GỐC) nên khách vẫn nhận ảnh nét; chỉ bản lưu/hiển thị-CRM là webp nhẹ.
          // compressImage tự bỏ qua video/file + gif/định dạng lạ + fallback gốc nếu sharp lỗi.
          const source = await readFile(tmpPaths[i]);
          const proc = f.kind === 'image'
            ? await compressImage(source, f.mimeType)
            : { buffer: source, mimeType: f.mimeType };
          mirrors[i] = await uploadBuffer(proc.buffer, proc.mimeType, f.filename);
        }));
        // A Zalo failure can return before a mirror task finishes. Attach a
        // rejection handler now so that such a late storage error is logged,
        // rather than becoming an unhandled promise rejection.
        void Promise.all(mirrorTasks).catch((err) => logger.error('[chat-attachment] mirror failed:', err));

        const created: any[] = [];
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

        // Split by kind — image batch vs video one-by-one vs file one-by-one
        const imageIndexes: number[] = [];
        const videoIndexes: number[] = [];
        const fileIndexes: number[] = [];
        files.forEach((f, i) => {
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
            const sendResult: any = await zaloOps.sendImage(
              conversation.zaloAccountId, threadId, threadType as 0 | 1, paths, io, caption,
            );
            await Promise.all(batchIndexes.map((i) => mirrorTasks[i]));
          // FIX 2026-07-13 — msgId PER ẢNH. Gửi lô N ảnh = 1 lệnh sendMessage, zca-js trả
          // `attachment: [{msgId}, ...]` mỗi phần tử ứng 1 ảnh. Nếu dùng CHUNG 1 msgId cho
          // mọi ảnh thì message thứ 2 vi phạm UNIQUE(conversation_id, zalo_msg_id) → create
          // văng lỗi → KHÔNG tin nào được tạo → ảnh "không hiện". Thiếu msgId → '' (lưu NULL,
          // NULL không đụng UNIQUE).
            const attachArr: any[] = Array.isArray(sendResult?.attachment) ? sendResult.attachment : [];
            const usedMsgIds = new Set<string>();
            for (const [k, i] of batchIndexes.entries()) {
            let zaloMsgId = String(attachArr[k]?.msgId ?? '');
            // Lô 1 ảnh: một số shape chỉ trả msgId ở cấp ngoài.
            if (!zaloMsgId && batchIndexes.length === 1) zaloMsgId = extractZaloMsgId(sendResult);
            // Chống trùng trong cùng lô (an toàn tuyệt đối với UNIQUE).
            if (zaloMsgId && usedMsgIds.has(zaloMsgId)) zaloMsgId = '';
            if (zaloMsgId) usedMsgIds.add(zaloMsgId);

            const mirror = mirrors[i];
            const msg = await createMediaMessage({
              conversationId: id,
              zaloAccount: conversation.zaloAccount,
              repliedByUserId: user.id,
              zaloMsgId,
              contentType: 'image',
              content: JSON.stringify({ href: mirror.url, thumb: mirror.url, size: mirror.size, title: caption }),
              metadata: { sender: { kind: 'user_crm', name: userFullName } },
              sentVia: 'user',
              clientEchoId: echoId ? `${echoId}:${i}` : null,
            });
            await recordStorage(msg, [{ upload: mirror, purpose: 'primary' }]);
            created.push(msg);
            }
          }
        }

        // Send videos one-by-one using native sendVideo
        for (const i of videoIndexes) {
          let generatedThumbnail: Awaited<ReturnType<typeof generateThumbnail>> | null = null;
          let thumbnailMirror: UploadResult | null = null;
          let thumbnailMirrorTask: Promise<UploadResult> | null = null;
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
            const sendResult: any = await sendNativeVideo({
              api: instance.api as any,
              accountId: conversation.zaloAccountId,
              videoPath: tmpPaths[i],
              thumbnailPath: generatedThumbnail?.path,
              threadId,
              threadType: threadType as 0 | 1,
              message: caption,
            });
            const [, mirroredThumbnail] = await Promise.all([mirrorTasks[i], thumbnailMirrorTask]);
            thumbnailMirror = mirroredThumbnail ?? null;
            const zaloMsgId = extractZaloMsgId(sendResult);
            const mirror = mirrors[i];
            const thumbUrl = thumbnailMirror?.url ?? mirror.url;
            const msg = await createMediaMessage({
              conversationId: id,
              zaloAccount: conversation.zaloAccount,
              repliedByUserId: user.id,
              zaloMsgId,
              contentType: 'video',
              content: JSON.stringify({ href: mirror.url, thumb: thumbUrl, thumbUrl, thumbnail: thumbUrl, size: mirror.size, title: caption }),
              metadata: { sender: { kind: 'user_crm', name: userFullName } },
              sentVia: 'user',
              clientEchoId: echoId ? `${echoId}:${i}` : null,
            });
            await recordStorage(msg, [
                          { upload: mirror, purpose: 'primary' },
                          ...(thumbnailMirror ? [{ upload: thumbnailMirror, purpose: 'thumbnail' }] : []),
                        ]);
            created.push(msg);
          } catch (err) {
            logger.error('[chat-attachment] Native video send failed, trying fallback:', err);
            // Fallback: regular attachment send
            const sendResult: any = await zaloOps.sendFile(
              conversation.zaloAccountId,
              threadId,
              threadType as 0 | 1,
              [tmpPaths[i]],
              io,
            );
            const [, mirroredThumbnail] = await Promise.all([mirrorTasks[i], thumbnailMirrorTask]);
            thumbnailMirror = mirroredThumbnail ?? null;
            const zaloMsgId = extractZaloMsgId(sendResult);
            const mirror = mirrors[i];
            const thumbUrl = thumbnailMirror?.url ?? mirror.url;
            const msg = await createMediaMessage({
              conversationId: id,
              zaloAccount: conversation.zaloAccount,
              repliedByUserId: user.id,
              zaloMsgId,
              contentType: 'video',
              content: JSON.stringify({ href: mirror.url, thumb: thumbUrl, thumbUrl, thumbnail: thumbUrl, size: mirror.size, title: caption }),
              metadata: { sender: { kind: 'user_crm', name: userFullName } },
              sentVia: 'user',
              clientEchoId: echoId ? `${echoId}:${i}` : null,
            });
            await recordStorage(msg, [
                          { upload: mirror, purpose: 'primary' },
                          ...(thumbnailMirror ? [{ upload: thumbnailMirror, purpose: 'thumbnail' }] : []),
                        ]);
            created.push(msg);
          } finally {
            await generatedThumbnail?.cleanup().catch(() => {});
          }
        }

        // Send files (generic) one-by-one
        for (const i of fileIndexes) {
          const sendResult: any = await zaloOps.sendFile(
            conversation.zaloAccountId,
            threadId,
            threadType as 0 | 1,
            [tmpPaths[i]],
            io,
            caption,
          );
          await mirrorTasks[i];
          const zaloMsgId = extractZaloMsgId(sendResult);
          const mirror = mirrors[i];
          const f = files[i];
          const msg = await createMediaMessage({
            conversationId: id,
            zaloAccount: conversation.zaloAccount,
            repliedByUserId: user.id,
            zaloMsgId,
            contentType: 'file',
            content: JSON.stringify({ href: mirror.url, name: f.filename, size: mirror.size, mime: f.mimeType, title: caption }),
            clientEchoId: echoId ? `${echoId}:${i}` : null,
          });
          await recordStorage(msg, [{ upload: mirror, purpose: 'primary' }]);
          created.push(msg);
        }

        await prisma.conversation.update({
          where: { id },
          data: { lastMessageAt: new Date(), isReplied: true, unreadCount: 0 },
        });

        for (const m of created) {
          // PRIVACY 2026-06-11: redact + scope org (emit-chat). Nick main → URL file
          // KHÔNG ra room org (chỉ chính chủ đã unlock nhận bản thật).
          await emitChatMessage({
            io,
            orgId: user.orgId,
            accountId: conversation.zaloAccountId,
            conversationId: id,
            message: m,
            privacyMode: conversation.zaloAccount.privacyMode,
            ownerUserId: conversation.zaloAccount.ownerUserId,
            isPrivate: conversation.isPrivate,
            privateOwnerUserId: conversation.privateOwnerUserId,
          });
        }

        logger.info('[chat-perf] attachment send', {
          conversationId: id,
          files: files.length,
          kinds: files.map((file) => file.kind),
          tmpMs: tmpReadyAt - requestStartedAt,
          totalMs: Date.now() - requestStartedAt,
        });

        return { messages: created };
      } catch (err: any) {
        logger.error('[chat-attachment] upload error:', err);
        return reply.status(500).send({ error: err?.message ?? 'attachment send failed' });
      } finally {
        // Clean tmp files (best effort)
        for (const p of tmpPaths) {
          if (p) await unlink(p).catch(() => {});
        }
        await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
      }
    },
  );
}
