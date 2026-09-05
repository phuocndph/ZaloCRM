import { describe, expect, it } from 'vitest';
import { isZaloFriendAcceptedNotification } from '../../src/modules/zalo/zalo-friend-accepted-notification.js';

const ecard = 'https://res-zalo.zadn.vn/upload/media/2018/4/23/ecard_newfriend_1_VN_2x_1524478415422.png';

describe('isZaloFriendAcceptedNotification', () => {
  it('recognizes the official accepted-friend e-card', () => {
    expect(isZaloFriendAcceptedNotification(`Lan\nLan đã đồng ý kết bạn\n${ecard}`)).toBe(true);
  });

  it('recognizes structured Zalo content', () => {
    expect(isZaloFriendAcceptedNotification({ title: 'Lan đã chấp nhận lời mời kết bạn', href: ecard })).toBe(true);
  });

  it('recognizes the reminder payload used by current Zalo clients', () => {
    const payload = {
      title: 'Bạn vừa kết bạn với Lan',
      action: 'msginfo.actionlist',
      params: JSON.stringify({ msg: { vi: '%1$s đã đồng ý kết bạn' } }),
    };
    expect(isZaloFriendAcceptedNotification(payload)).toBe(true);
    // This is the exact form persisted by the Zalo listener (outer JSON string).
    expect(isZaloFriendAcceptedNotification(JSON.stringify(payload))).toBe(true);
  });

  it('does not match ordinary text or unrelated images', () => {
    expect(isZaloFriendAcceptedNotification('Lan đã đồng ý kết bạn')).toBe(false);
    expect(isZaloFriendAcceptedNotification(`Lan đã đồng ý kết bạn\nhttps://example.com/card.png`)).toBe(false);
    expect(isZaloFriendAcceptedNotification(ecard)).toBe(false);
  });
});
