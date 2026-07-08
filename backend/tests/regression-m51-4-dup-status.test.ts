/**
 * regression-m51-4-dup-status.test.ts — M16 smoke regression.
 *
 * Bảo vệ filter clause của worker enrichment (M51.4 dup-status trap):
 *   Worker enrich CustomerListEntry CHỈ touch entries có status='validated'
 *   + hasZalo=null + phoneValid=true. KHÔNG được bỏ filter status, vì sẽ
 *   ghi đè entries đã 'enriched' và mất pill dup (bug ngày 2026-05-20).
 *
 * Test strategy: enrichListOnce KHÔNG export → test gián tiếp qua
 * kickoffEnrichment + spy prisma.customerListEntry.findMany.mock.calls[0][0].where.
 *
 * Memory reference: reference_zalocrm_worker_dup_status_trap.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────
const prismaMock = {
  customerList: { findUnique: vi.fn() },
  customerListEntry: { findMany: vi.fn(), update: vi.fn() },
  contact: { findMany: vi.fn() },
};
const recomputeListCountersMock = vi.fn().mockResolvedValue(undefined);
const appendSystemMessageMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../src/shared/database/prisma-client.js', () => ({ prisma: prismaMock }));
vi.mock('../src/shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../src/modules/lists/list-entry-routes.js', () => ({
  recomputeListCounters: recomputeListCountersMock,
}));
vi.mock('../src/modules/lists/list-system-messages.js', () => ({
  appendSystemMessage: appendSystemMessageMock,
}));

const { kickoffEnrichment } = await import(
  '../src/modules/lists/list-enrichment-service.js'
);

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.customerList.findUnique.mockResolvedValue({ orgId: 'org1' });
  // Return empty entries để break while loop ngay sau 1 chunk
  prismaMock.customerListEntry.findMany.mockResolvedValue([]);
  prismaMock.contact.findMany.mockResolvedValue([]);
});

describe('M51.4 — enrichment worker filter clause', () => {
  it('findMany được gọi với filter chính xác: phoneValid + hasZalo=null + status=validated', async () => {
    await kickoffEnrichment('list-123');

    expect(prismaMock.customerListEntry.findMany).toHaveBeenCalled();
    const callArgs = prismaMock.customerListEntry.findMany.mock.calls[0][0];

    expect(callArgs.where).toEqual(
      expect.objectContaining({
        customerListId: 'list-123',
        phoneValid: true,
        hasZalo: null,
        status: 'validated',
      }),
    );
  });

  it('KHÔNG bỏ filter status (regression M51.4 dup-status trap)', async () => {
    await kickoffEnrichment('list-xyz');

    const callArgs = prismaMock.customerListEntry.findMany.mock.calls[0][0];
    // Bảo vệ: status PHẢI có trong where + PHẢI bằng 'validated'
    expect(callArgs.where.status).toBe('validated');
    expect(callArgs.where.status).not.toBe('pending');
    expect(callArgs.where.status).not.toBeUndefined();
  });

  it('KHÔNG touch entries đang status="enriched" (chỉ filter validated)', async () => {
    // Simulate 2 entries: 1 validated (worker SHOULD pick), 1 enriched (worker SKIP)
    // Vì prisma.findMany filter ở DB layer, ta verify filter clause loại enriched.
    prismaMock.customerListEntry.findMany.mockResolvedValueOnce([
      { id: 'e1', phoneE164: '+84901', phoneLocal: '0901' },
    ]);
    prismaMock.customerListEntry.findMany.mockResolvedValueOnce([]); // chunk 2 empty

    await kickoffEnrichment('list-1');

    // Filter must exclude 'enriched' bằng cách CHỈ allow 'validated'
    const where = prismaMock.customerListEntry.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('validated');
    // hasZalo=null cũng quan trọng — entries đã có verdict (true/false) bị skip
    expect(where.hasZalo).toBeNull();
  });

  it('no-op khi list không tồn tại (early return)', async () => {
    prismaMock.customerList.findUnique.mockResolvedValue(null);

    await kickoffEnrichment('ghost-list');

    // Không gọi findMany vì list không tìm thấy
    expect(prismaMock.customerListEntry.findMany).not.toHaveBeenCalled();
    expect(recomputeListCountersMock).not.toHaveBeenCalled();
  });

  it('recompute parent counters sau khi enrich xong', async () => {
    await kickoffEnrichment('list-42');

    expect(recomputeListCountersMock).toHaveBeenCalledWith('list-42');
  });
});
