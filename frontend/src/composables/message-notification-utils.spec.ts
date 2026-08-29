import { describe, expect, it } from 'vitest';
import {
  compactNotificationLabel,
  notificationAvatarUrl,
  notificationContext,
  notificationPreview,
  notificationRoute,
} from './message-notification-utils';

describe('message notification formatting', () => {
  it('normalizes sender and group labels', () => {
    expect(compactNotificationLabel('  Nguyễn   Minh Anh  ', 80)).toBe('Nguyễn Minh Anh');
    expect(notificationContext('group', '  Khách   hàng VIP ')).toBe('Nhóm Khách hàng VIP');
    expect(notificationContext('group', '   ')).toBe('Nhóm chưa đặt tên');
    expect(notificationContext('user', 'ignored')).toBe('Tin nhắn riêng');
  });

  it('keeps long valid avatar URLs intact', () => {
    const url = `https://cdn.example.com/avatar.jpg?signature=${'a'.repeat(180)}`;
    expect(notificationAvatarUrl(url)).toBe(url);
    expect(notificationAvatarUrl('javascript:alert(1)')).toBeNull();
  });

  it('formats previews without exposing redacted content', () => {
    expect(notificationPreview({ redacted: true, content: 'secret' })).toBe('Bạn có tin nhắn mới');
    expect(notificationPreview({ contentType: 'image' })).toBe('🖼 Hình ảnh');
    expect(notificationPreview({ contentType: 'text', content: '  Xin   chào  ' })).toBe('Xin chào');
  });

  it('routes mobile cards to the mobile conversation view', () => {
    expect(notificationRoute('conv-1', '/m/settings')).toEqual({ name: 'M.Chat', params: { convId: 'conv-1' } });
    expect(notificationRoute('conv-1', '/contacts')).toEqual({ name: 'Chat', params: { convId: 'conv-1' } });
  });
});
