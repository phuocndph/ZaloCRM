import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));
vi.mock('../../src/shared/zalo-operations.js', () => ({ zaloOps: {} }));
vi.mock('../../src/shared/database/prisma-client.js', () => ({ prisma: {} }));
vi.mock('../../src/shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../src/shared/tenant/tenant-context.js', () => ({
  runSystemQuery: (fn: () => unknown) => fn(),
}));

const { presenceBackoffMs, runPresenceRefreshCycle, resetPresenceBackoffForTest } = await import(
  '../../src/modules/zalo/presence-service.js'
);

describe('presence refresh backoff', () => {
  beforeEach(() => resetPresenceBackoffForTest());

  it('doubles the wait per consecutive failure and caps at 30 minutes', () => {
    expect(presenceBackoffMs(0)).toBe(0);
    expect(presenceBackoffMs(1)).toBe(60_000);
    expect(presenceBackoffMs(2)).toBe(120_000);
    expect(presenceBackoffMs(5)).toBe(960_000);
    expect(presenceBackoffMs(6)).toBe(30 * 60_000);
    expect(presenceBackoffMs(50)).toBe(30 * 60_000);
  });

  it('stops calling a failing account every minute', async () => {
    let clock = 0;
    const refresh = vi.fn().mockResolvedValue(null);
    for (let minute = 0; minute < 60; minute++) {
      clock = minute * 60_000;
      await runPresenceRefreshCycle(['nick-1'], refresh, () => clock);
    }
    // Không lùi: 60 lần. Có lùi 1, 2, 4, 8, 16, 30 phút: gọi ở phút 0, 1, 3, 7, 15, 31.
    expect(refresh).toHaveBeenCalledTimes(6);
  });

  it('keeps refreshing healthy accounts while a failing one backs off', async () => {
    let clock = 0;
    const refresh = vi.fn(async (id: string) => (id === 'ok' ? { onlineCount: 2 } : null));
    const first = await runPresenceRefreshCycle(['ok', 'bad'], refresh, () => clock);
    expect(first).toEqual({ attempted: 2, skipped: 0, totalOnline: 2 });
    clock = 60_000;
    await runPresenceRefreshCycle(['ok', 'bad'], refresh, () => clock);
    clock = 120_000;
    const third = await runPresenceRefreshCycle(['ok', 'bad'], refresh, () => clock);
    expect(third).toEqual({ attempted: 1, skipped: 1, totalOnline: 2 });
  });

  it('resumes at once after a success and forgets accounts that disconnected', async () => {
    let clock = 0;
    const refresh = vi.fn().mockResolvedValueOnce(null).mockResolvedValue({ onlineCount: 1 });
    await runPresenceRefreshCycle(['nick-1'], refresh, () => clock);
    clock = 60_000;
    await runPresenceRefreshCycle(['nick-1'], refresh, () => clock);
    clock = 120_000;
    const next = await runPresenceRefreshCycle(['nick-1'], refresh, () => clock);
    expect(next.attempted).toBe(1);

    const failing = vi.fn().mockResolvedValue(null);
    await runPresenceRefreshCycle(['nick-2'], failing, () => clock);
    await runPresenceRefreshCycle([], failing, () => clock);
    const back = await runPresenceRefreshCycle(['nick-2'], failing, () => clock);
    expect(back.attempted).toBe(1);
  });
});
