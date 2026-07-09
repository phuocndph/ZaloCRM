// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * web-push-service.ts — Web Push (VAPID) cho PWA Mobile.
 *
 * Chạy SONG SONG với push-service.ts (FCM/APNs cho app native), KHÔNG thay thế.
 *
 * Nguyên tắc (bám đúng phong cách push-service.ts):
 *   - LAZY init từ env. Thiếu VAPID_* → NO-OP (warn 1 lần, mọi hàm return im).
 *     KHÔNG throw, KHÔNG crash. Gỡ VAPID_PRIVATE_KEY khỏi .env = tắt khẩn cấp.
 *   - Lỗi push KHÔNG bao giờ ảnh hưởng pipeline nhận/lưu/emit tin (caller fire-and-forget).
 *   - Subscription chết (404/410) → đánh dấu revokedAt, không gửi lại nữa.
 *
 * Bảo mật: payload chỉ mang tên người gửi + preview ĐÃ redact ở caller + conversationId.
 * Không đính token, không đính dữ liệu nhạy cảm.
 */
import webpush, { type PushSubscription as WebPushSub, WebPushError } from 'web-push';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';

let configured: boolean | null = null;

/** Cấu hình VAPID 1 lần. Trả false nếu thiếu env → toàn bộ module NO-OP. */
function ensureConfigured(): boolean {
  if (configured !== null) return configured;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
  if (!publicKey || !privateKey) {
    logger.warn('[web-push] thiếu VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY → Web Push TẮT (NO-OP).');
    configured = false;
    return false;
  }
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    configured = true;
    logger.info('[web-push] đã cấu hình VAPID.');
  } catch (err) {
    logger.warn(`[web-push] VAPID key không hợp lệ → TẮT: ${(err as Error).message}`);
    configured = false;
  }
  return configured;
}

export function getVapidPublicKey(): string | null {
  return ensureConfigured() ? (process.env.VAPID_PUBLIC_KEY ?? null) : null;
}

export interface WebPushPayload {
  title: string;
  body: string;
  conversationId?: string;
  icon?: string | null;
  sentAt?: string;
}

/** Gửi tới TẤT CẢ subscription còn sống của 1 user. Không bao giờ throw. */
export async function sendWebPushToUser(userId: string, payload: WebPushPayload): Promise<void> {
  if (!ensureConfigured()) return;
  try {
    const subs = await prisma.pushSubscription.findMany({
      where: { userId, revokedAt: null },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
    if (!subs.length) return;

    const data = JSON.stringify(payload);
    await Promise.all(
      subs.map(async (s) => {
        const sub: WebPushSub = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
        try {
          await webpush.sendNotification(sub, data, { TTL: 3600 });
          await prisma.pushSubscription
            .update({ where: { id: s.id }, data: { lastSeenAt: new Date() } })
            .catch(() => {});
        } catch (err) {
          const status = err instanceof WebPushError ? err.statusCode : 0;
          // 404 Not Found / 410 Gone → subscription chết hẳn (user gỡ app, xoá quyền).
          if (status === 404 || status === 410) {
            await prisma.pushSubscription
              .update({ where: { id: s.id }, data: { revokedAt: new Date() } })
              .catch(() => {});
            logger.info(`[web-push] subscription hết hiệu lực (${status}) → đã thu hồi. user=${userId}`);
          } else {
            logger.warn(`[web-push] gửi thất bại (${status || '?'}) user=${userId}: ${(err as Error).message}`);
          }
        }
      }),
    );
  } catch (err) {
    logger.warn('[web-push] sendWebPushToUser lỗi:', (err as Error).message);
  }
}

/** Gửi cho nhiều user (fan-out). Bỏ qua user nào đang mở đúng hội thoại đó. */
export async function sendWebPushToUsers(
  userIds: string[],
  payloadFor: (userId: string) => WebPushPayload,
  skipUserIds?: Set<string>,
): Promise<void> {
  if (!ensureConfigured() || !userIds.length) return;
  await Promise.all(
    userIds
      .filter((u) => !skipUserIds?.has(u))
      .map((u) => sendWebPushToUser(u, payloadFor(u))),
  );
}
