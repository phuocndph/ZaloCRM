// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc

const FRIEND_ACCEPTED_RE = /(?:^|[\r\n])\s*[^\r\n]+?\s+(?:đã đồng ý kết bạn|đã chấp nhận lời mời kết bạn)(?:[.!]?\s*(?:[\r\n]|$))/iu;
const NEW_FRIEND_ECARD_RE = /https?:\/\/res-zalo\.zadn\.vn\/[^\s"'\\]*\/ecard_newfriend[^\/\s"'\\?]*\.(?:png|jpe?g)(?:\?[^\s"'\\]*)?/i;
const FRIEND_ACCEPTED_REMINDER_RE = /msginfo\.actionlist[\s\S]*(?:đã đồng ý kết bạn|đã chấp nhận lời mời kết bạn)|(?:đã đồng ý kết bạn|đã chấp nhận lời mời kết bạn)[\s\S]*msginfo\.actionlist/iu;

function collectStrings(value: unknown, depth = 0): string[] {
  if (depth > 6 || value == null) return [];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && trimmed.length < 100_000) {
      try {
        return collectStrings(JSON.parse(trimmed), depth + 1);
      } catch {
        // Plain text that happens to start with a bracket.
      }
    }
    return trimmed ? [trimmed] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item) => collectStrings(item, depth + 1));
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .flatMap((item) => collectStrings(item, depth + 1));
  }
  return [];
}

/** Detect Zalo's official accepted-friend e-card, not ordinary chat text. */
export function isZaloFriendAcceptedNotification(content: unknown): boolean {
  const raw = collectStrings(content).join('\n');
  return FRIEND_ACCEPTED_RE.test(raw) && (
    NEW_FRIEND_ECARD_RE.test(raw) || FRIEND_ACCEPTED_REMINDER_RE.test(raw)
  );
}
