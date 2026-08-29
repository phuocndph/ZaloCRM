// SPDX-License-Identifier: AGPL-3.0-or-later

export type NotificationThreadType = 'user' | 'group';

export function compactNotificationLabel(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}…` : compact;
}

export function notificationContext(threadType: NotificationThreadType | undefined, groupName: unknown): string {
  if (threadType !== 'group') return 'Tin nhắn riêng';
  return `Nhóm ${compactNotificationLabel(groupName, 80) || 'chưa đặt tên'}`;
}

export function notificationPreview(message: any): string {
  if (message?.redacted) return 'Bạn có tin nhắn mới';
  const type = message?.contentType;
  const raw = typeof message?.content === 'string' ? message.content : '';
  if (type && type !== 'text') {
    const label: Record<string, string> = {
      image: '🖼 Hình ảnh', video: '🎬 Video', file: '📎 Tệp đính kèm',
      voice: '🎤 Tin nhắn thoại', audio: '🎤 Tin nhắn thoại', sticker: '😊 Sticker',
      gif: '🎞 GIF', link: '🔗 Liên kết', location: '📍 Vị trí', contact_card: '👤 Danh thiếp',
    };
    return label[type] || 'Tin nhắn mới';
  }
  return compactNotificationLabel(raw, 90) || 'Tin nhắn mới';
}

export function notificationAvatarUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const url = value.trim();
  if (!url || url.length > 4096) return null;
  try {
    const parsed = new URL(url, 'http://localhost');
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return url;
  } catch {
    return null;
  }
}

export function notificationRoute(convId: string, currentPath: string) {
  return currentPath === '/m' || currentPath.startsWith('/m/')
    ? { name: 'M.Chat', params: { convId } }
    : { name: 'Chat', params: { convId } };
}
