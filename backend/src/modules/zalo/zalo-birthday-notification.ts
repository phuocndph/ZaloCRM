// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc

const BIRTHDAY_TITLE_RE = /\b\d{1,2}\/\d{1,2}\s+Sinh nhật của\s+\S[^\r\n]*/iu;
const BIRTHDAY_ECARD_RE = /https?:\/\/res-zalo\.zadn\.vn\/[^\s"'\\]*\/2x_ecardsn_[^\/\s"'\\?]+\.png(?:\?[^\s"'\\]*)?/i;

/**
 * Zalo birthday reminders have a stable two-part shape: a dated "Sinh nhật của"
 * title and the official 2x_ecardsn PNG. Requiring both avoids hiding real chats.
 */
export function isZaloBirthdayNotification(content: unknown): boolean {
  const raw = typeof content === 'string' ? content : JSON.stringify(content ?? '');
  return BIRTHDAY_TITLE_RE.test(raw) && BIRTHDAY_ECARD_RE.test(raw);
}
