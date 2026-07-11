/**
 * conversation-state-service.test.ts — Conversation State System per-user (2026-07-10).
 *
 * Khoá các BẤT BIẾN:
 *   1. patchState set/clear cột timestamp đi kèm cờ boolean (pinnedAt, manualUnreadAt).
 *   2. flags merge NÔNG trên giá trị cũ; value=null → xoá key.
 *   3. loadStates trả Map batch, hội thoại chưa có hàng KHÔNG nằm trong Map.
 *   4. clearManualUnreadOnRead chỉ đụng hàng đang isManualUnread=true (no-op nếu không).
 *   5. emitStateChange bắn CHỈ vào room user:${userId} (per-user, không org-wide).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = {
  conversationUserState: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    upsert: vi.fn(),
    updateMany: vi.fn(),
  },
};
vi.mock('../src/shared/database/prisma-client.js', () => ({ prisma: prismaMock }));
vi.mock('../src/shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
  patchState, loadStates, clearManualUnreadOnRead, emitStateChange, emptyState, getState,
} = await import('../src/modules/chat/conversation-state-service.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('patchState — cờ boolean tự set/clear timestamp', () => {
  it('bật isPinned → set pinnedAt; upsert nhận đúng data', async () => {
    prismaMock.conversationUserState.upsert.mockResolvedValue({
      conversationId: 'c1', isPinned: true, pinnedAt: new Date('2026-07-10T00:00:00Z'),
      isManualUnread: false, manualUnreadAt: null, flags: {},
    });
    const dto = await patchState('org1', 'u1', 'c1', { isPinned: true });

    const arg = prismaMock.conversationUserState.upsert.mock.calls[0][0];
    expect(arg.update.isPinned).toBe(true);
    expect(arg.update.pinnedAt).toBeInstanceOf(Date);
    expect(arg.where).toEqual({ userId_conversationId: { userId: 'u1', conversationId: 'c1' } });
    expect(dto.isPinned).toBe(true);
    expect(dto.pinnedAt).toBe('2026-07-10T00:00:00.000Z');
  });

  it('tắt isManualUnread → manualUnreadAt về null', async () => {
    prismaMock.conversationUserState.upsert.mockResolvedValue({
      conversationId: 'c1', isPinned: false, pinnedAt: null,
      isManualUnread: false, manualUnreadAt: null, flags: {},
    });
    await patchState('org1', 'u1', 'c1', { isManualUnread: false });
    const arg = prismaMock.conversationUserState.upsert.mock.calls[0][0];
    expect(arg.update.isManualUnread).toBe(false);
    expect(arg.update.manualUnreadAt).toBeNull();
  });

  it('KHÔNG gửi field không có trong patch (giữ nguyên phần còn lại)', async () => {
    prismaMock.conversationUserState.upsert.mockResolvedValue({
      conversationId: 'c1', isPinned: true, pinnedAt: new Date(),
      isManualUnread: false, manualUnreadAt: null, flags: {},
    });
    await patchState('org1', 'u1', 'c1', { isPinned: true });
    const arg = prismaMock.conversationUserState.upsert.mock.calls[0][0];
    expect(arg.update).not.toHaveProperty('isManualUnread');
    expect(arg.update).not.toHaveProperty('manualUnreadAt');
  });
});

describe('patchState — flags merge nông', () => {
  it('merge trên flags cũ, key=null xoá', async () => {
    prismaMock.conversationUserState.findUnique.mockResolvedValue({
      flags: { vip: true, priority: 3 },
    });
    prismaMock.conversationUserState.upsert.mockResolvedValue({
      conversationId: 'c1', isPinned: false, pinnedAt: null,
      isManualUnread: false, manualUnreadAt: null, flags: { vip: true, snoozedUntil: '2026-08-01' },
    });
    await patchState('org1', 'u1', 'c1', { flags: { snoozedUntil: '2026-08-01', priority: null } });
    const arg = prismaMock.conversationUserState.upsert.mock.calls[0][0];
    // priority bị xoá (null), vip giữ, snoozedUntil thêm.
    expect(arg.update.flags).toEqual({ vip: true, snoozedUntil: '2026-08-01' });
  });
});

describe('loadStates — batch map', () => {
  it('trả Map theo conversationId; id rỗng → Map rỗng, không query', async () => {
    const empty = await loadStates('u1', []);
    expect(empty.size).toBe(0);
    expect(prismaMock.conversationUserState.findMany).not.toHaveBeenCalled();
  });

  it('map đúng các hàng trả về', async () => {
    prismaMock.conversationUserState.findMany.mockResolvedValue([
      { conversationId: 'c1', isPinned: true, pinnedAt: new Date(), isManualUnread: false, manualUnreadAt: null, flags: {} },
    ]);
    const map = await loadStates('u1', ['c1', 'c2']);
    expect(map.get('c1')?.isPinned).toBe(true);
    expect(map.has('c2')).toBe(false); // chưa có hàng → không trong Map
  });
});

describe('clearManualUnreadOnRead', () => {
  it('có hàng đang unread → tắt + trả true', async () => {
    prismaMock.conversationUserState.updateMany.mockResolvedValue({ count: 1 });
    const changed = await clearManualUnreadOnRead('u1', 'c1');
    expect(changed).toBe(true);
    const arg = prismaMock.conversationUserState.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ userId: 'u1', conversationId: 'c1', isManualUnread: true });
    expect(arg.data).toEqual({ isManualUnread: false, manualUnreadAt: null });
  });

  it('không có hàng nào → trả false (no-op, không emit thừa)', async () => {
    prismaMock.conversationUserState.updateMany.mockResolvedValue({ count: 0 });
    expect(await clearManualUnreadOnRead('u1', 'c1')).toBe(false);
  });
});

describe('emitStateChange — chỉ tới room user', () => {
  it('bắn vào user:${userId}, KHÔNG org-wide', () => {
    const emit = vi.fn();
    const io: any = { to: vi.fn(() => ({ emit })) };
    const dto = emptyState('c1');
    emitStateChange(io, 'u1', dto);
    expect(io.to).toHaveBeenCalledWith('user:u1');
    expect(emit).toHaveBeenCalledWith('conversation:state', dto);
  });

  it('io null → no-op, không ném', () => {
    expect(() => emitStateChange(null, 'u1', emptyState('c1'))).not.toThrow();
  });
});

describe('getState — chưa có hàng → state trống', () => {
  it('findUnique null → emptyState', async () => {
    prismaMock.conversationUserState.findUnique.mockResolvedValue(null);
    const dto = await getState('u1', 'c9');
    expect(dto).toEqual(emptyState('c9'));
    expect(dto.isPinned).toBe(false);
    expect(dto.isManualUnread).toBe(false);
  });
});
