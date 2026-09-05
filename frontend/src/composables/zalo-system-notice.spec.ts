import { describe, expect, it } from 'vitest';
import { parseFriendAcceptedNotice } from './zalo-system-notice';

const ecard = 'https://res-zalo.zadn.vn/upload/media/2018/4/23/ecard_newfriend_1_VN_2x_1524478415422.png';

describe('parseFriendAcceptedNotice', () => {
  it('recognizes the official Zalo accepted-friend notification', () => {
    expect(parseFriendAcceptedNotice(
      `Prettik Mr - Convinia Apartment\nPrettik Mr - Convinia Apartment đã đồng ý kết bạn\n🔗 ${ecard}`,
    )).toEqual({
      displayName: 'Prettik Mr - Convinia Apartment',
      label: 'Prettik Mr - Convinia Apartment đã đồng ý kết bạn',
    });
  });

  it('recognizes the notification inside structured Zalo content', () => {
    expect(parseFriendAcceptedNotice({
      title: 'Lan đã chấp nhận lời mời kết bạn',
      href: ecard,
    })?.displayName).toBe('Lan');
  });

  it('recognizes the reminder payload used by current Zalo clients', () => {
    const payload = {
      title: 'Bạn vừa kết bạn với Lan',
      action: 'msginfo.actionlist',
      params: JSON.stringify({ msg: { vi: '%1$s đã đồng ý kết bạn' } }),
    };
    expect(parseFriendAcceptedNotice(payload)).toEqual({ displayName: 'Lan', label: 'Lan đã đồng ý kết bạn' });
    expect(parseFriendAcceptedNotice(JSON.stringify(payload))).toEqual({
      displayName: 'Lan',
      label: 'Lan đã đồng ý kết bạn',
    });
  });

  it('does not collapse normal chats or unrelated images', () => {
    expect(parseFriendAcceptedNotice('Lan đã đồng ý kết bạn')).toBeNull();
    expect(parseFriendAcceptedNotice(`Lan đã đồng ý kết bạn\nhttps://example.com/card.png`)).toBeNull();
    expect(parseFriendAcceptedNotice(ecard)).toBeNull();
  });
});
