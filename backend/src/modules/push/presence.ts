// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * presence.ts — "user đang mở hội thoại nào".
 *
 * Dùng để KHÔNG bắn notification cho người đang nhìn đúng cuộc chat đó (yêu cầu PRD).
 *
 * Cách làm: client emit `presence:viewing` (kèm heartbeat) → lưu Redis key có TTL.
 * TTL ngắn hơn 2× chu kỳ heartbeat → tab đóng đột ngột thì key tự hết hạn, không kẹt.
 *
 * Redis KHÔNG bắt buộc: getRedis() trả null (chế độ in-memory) → mọi hàm trả về "không
 * ai đang xem" ⇒ vẫn gửi notification như bình thường. Fail-open, không chặn tin.
 */
import { getRedis } from '../../shared/redis-client.js';
import { logger } from '../../shared/utils/logger.js';

const TTL_SECONDS = 60; // client heartbeat mỗi 30s
const key = (userId: string) => `viewing:${userId}`;

/** Ghi nhận user đang mở hội thoại. convId = null → rời màn chat. */
export async function setViewing(userId: string, convId: string | null): Promise<void> {
  try {
    const redis = await getRedis();
    if (!redis) return;
    if (convId) await redis.set(key(userId), convId, 'EX', TTL_SECONDS);
    else await redis.del(key(userId));
  } catch (err) {
    logger.debug(`[presence] setViewing lỗi: ${(err as Error).message}`);
  }
}

export async function clearViewing(userId: string): Promise<void> {
  return setViewing(userId, null);
}

/**
 * Trong danh sách userIds, ai đang mở đúng `conversationId`?
 * Lỗi Redis / không có Redis → trả Set rỗng (fail-open: thà gửi thừa còn hơn mất tin).
 */
export async function getUsersViewing(userIds: string[], conversationId: string): Promise<Set<string>> {
  const out = new Set<string>();
  if (!userIds.length) return out;
  try {
    const redis = await getRedis();
    if (!redis) return out;
    const values = await redis.mget(...userIds.map(key));
    userIds.forEach((u, i) => {
      if (values[i] === conversationId) out.add(u);
    });
  } catch (err) {
    logger.debug(`[presence] getUsersViewing lỗi: ${(err as Error).message}`);
  }
  return out;
}
