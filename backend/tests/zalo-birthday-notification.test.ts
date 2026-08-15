import { describe, expect, it } from 'vitest';
import { isZaloBirthdayNotification } from '../src/modules/zalo/zalo-birthday-notification.js';

describe('isZaloBirthdayNotification', () => {
  it('recognizes Zalo birthday e-card reminders', () => {
    expect(isZaloBirthdayNotification(
      '15/08 Sinh nhật của A Chứ\n🔗 https://res-zalo.zadn.vn/upload/media/2020/2/7/2x_ecardsn_1581058405234_716426.png',
    )).toBe(true);
  });

  it('recognizes the same data inside a Zalo content object', () => {
    expect(isZaloBirthdayNotification({
      title: '15/08 Sinh nhật của A Chứ',
      href: 'https://res-zalo.zadn.vn/upload/media/2020/2/7/2x_ecardsn_1581058405234_716426.png',
    })).toBe(true);
  });

  it('does not hide ordinary birthday chats or unrelated images', () => {
    expect(isZaloBirthdayNotification('Chúc mừng sinh nhật em nhé!')).toBe(false);
    expect(isZaloBirthdayNotification(
      '15/08 Sinh nhật của A Chứ\nhttps://example.com/card.png',
    )).toBe(false);
    expect(isZaloBirthdayNotification(
      'https://res-zalo.zadn.vn/upload/media/2020/2/7/2x_ecardsn_1581058405234_716426.png',
    )).toBe(false);
  });
});
