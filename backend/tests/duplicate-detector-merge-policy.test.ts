/**
 * duplicate-detector-merge-policy.test.ts — REGRESSION test chính sách gộp (anh chốt 2026-06-16).
 *
 * Gốc bug: privacy blur ▒ ghi đè tên thật hàng loạt → detectDuplicates khối Soft-match TÊN (4)
 * + Hard-match USERNAME (2) tự gộp 2+ người KHÁC NHAU (51 Contact trộn, gồm 2 người trùng tên
 * "Nguyễn Trọng Ngoán"). Fix: CHỈ gộp theo globalId (1) + phone (3); BỎ tên (4), username (2),
 * fuzzy-name (6).
 *
 * 3 case CRITICAL (nếu fail → đã tái mở đường gộp loạn):
 *  ⛔ A. 2 contact TRÙNG TÊN + cùng ngày hoạt động, khác globalId → KHÔNG merge
 *  ⛔ B. 2 contact CÙNG USERNAME placeholder, khác globalId → KHÔNG merge
 *  ✅ C. 2 contact CÙNG globalId → VẪN merge (không vỡ đường gộp đúng)
 *  ✅ D. 2 contact CÙNG phone (không xung đột globalId) → VẪN merge (giữ tự-gộp SĐT)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockPrisma } from './test-helpers.js';

const mergeContactsMock = vi.fn().mockResolvedValue({});

// mockPrisma() tự sinh model/method → detector chạm bảng mới (vd Friend.zaloGlobalId
// backfill) không làm test chết vì "Cannot read properties of undefined".
const prismaMock = mockPrisma();

// withTenant chỉ chạy callback (bỏ tenant context trong test)
vi.mock('../src/shared/tenant/tenant-context.js', () => ({
  withTenant: (_orgId: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock('../src/shared/database/prisma-client.js', () => ({ prisma: prismaMock }));
vi.mock('../src/shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../src/modules/contacts/merge-service.js', () => ({
  mergeContacts: mergeContactsMock,
}));

const { detectDuplicates } = await import('../src/modules/contacts/duplicate-detector.ts');

const SAME_DAY = new Date('2026-06-16T03:00:00Z');

// Dựng 1 contact với mặc định an toàn (không trùng khóa nào) + override.
function contact(over: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    id: over.id ?? 'x',
    phone: null,
    zaloUid: null,
    zaloGlobalId: null,
    zaloUsername: null,
    fullName: null,
    birthDate: null,
    lastActivity: null,
    notes: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

function arrangeContacts(rows: Record<string, unknown>[]): void {
  prismaMock.organization.findMany.mockResolvedValue([{ id: 'org-1' }]);
  prismaMock.user.findFirst.mockResolvedValue({ id: 'sys-user' }); // có system user → cho phép auto-merge
  prismaMock.contact.findMany.mockResolvedValue(rows);
  prismaMock.duplicateGroup.findFirst.mockResolvedValue(null);
  prismaMock.duplicateGroup.create.mockResolvedValue({});
  prismaMock.parentCandidate.findFirst.mockResolvedValue(null);
  prismaMock.parentCandidate.create.mockResolvedValue({});
}

describe('detectDuplicates — chính sách gộp CHỈ globalId + phone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Contact thiếu zaloGlobalId → detector tra Friend để bù. Mặc định không có row nào;
    // test nào cần thì tự override.
    prismaMock.friend.findMany.mockResolvedValue([]);
  });

  it('⛔ A. 2 người TRÙNG TÊN + cùng ngày hoạt động (khác globalId) → KHÔNG auto-merge', async () => {
    arrangeContacts([
      contact({ id: 'a', fullName: 'Nguyễn Trọng Ngoán', lastActivity: SAME_DAY, zaloGlobalId: 'GID_A' }),
      contact({ id: 'b', fullName: 'Nguyễn Trọng Ngoán', lastActivity: SAME_DAY, zaloGlobalId: 'GID_B' }),
    ]);
    await detectDuplicates();
    expect(mergeContactsMock).not.toHaveBeenCalled();
  });

  it('⛔ B. 2 người CÙNG USERNAME placeholder (khác globalId) → KHÔNG auto-merge', async () => {
    arrangeContacts([
      contact({ id: 'a', zaloUsername: 't_ggzbdcmi80', zaloGlobalId: 'GID_A' }),
      contact({ id: 'b', zaloUsername: 't_ggzbdcmi80', zaloGlobalId: 'GID_B' }),
    ]);
    await detectDuplicates();
    expect(mergeContactsMock).not.toHaveBeenCalled();
  });

  it('✅ C. 2 contact CÙNG globalId → VẪN auto-merge (đường gộp đúng còn nguyên)', async () => {
    arrangeContacts([
      contact({ id: 'a', zaloGlobalId: 'GID_SAME', createdAt: new Date('2026-01-01') }),
      contact({ id: 'b', zaloGlobalId: 'GID_SAME', createdAt: new Date('2026-02-01') }),
    ]);
    await detectDuplicates();
    expect(mergeContactsMock).toHaveBeenCalledTimes(1);
    // primary = contact tạo trước (a), secondary = b
    expect(mergeContactsMock).toHaveBeenCalledWith('org-1', 'sys-user', 'a', ['b']);
  });

  it('✅ D. 2 contact CÙNG phone (không xung đột globalId) → VẪN auto-merge (giữ tự-gộp SĐT)', async () => {
    arrangeContacts([
      contact({ id: 'a', phone: '0833063545', createdAt: new Date('2026-01-01') }),
      contact({ id: 'b', phone: '0833063545', createdAt: new Date('2026-02-01') }),
    ]);
    await detectDuplicates();
    expect(mergeContactsMock).toHaveBeenCalledTimes(1);
    expect(mergeContactsMock).toHaveBeenCalledWith('org-1', 'sys-user', 'a', ['b']);
  });

  it('⛔ E. Tên giống nhưng KHÔNG có tín hiệu khác (trước đây fuzzy/soft) → KHÔNG merge', async () => {
    arrangeContacts([
      contact({ id: 'a', fullName: 'Nguyễn Văn A' }),
      contact({ id: 'b', fullName: 'Nguyễn Văn A' }),
    ]);
    await detectDuplicates();
    expect(mergeContactsMock).not.toHaveBeenCalled();
  });
});
