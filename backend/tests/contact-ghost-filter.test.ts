/**
 * contact-ghost-filter.test.ts — Fix 4 nick-ghost (Anh chốt 2026-06-13).
 * Regression: childrenCount (badge "Cùng chăm") đếm theo friends NHẬN VÀO. Sau khi
 * query lọc thẻ ma (zaloAccount.archivedAt + relationshipKind!='ghost'), số này phải
 * phản ánh CHỈ Friend thật — không thổi phồng bởi 3 "Evo Sport" ma.
 *
 * computeAggregateDisplay là hàm pure: caller (contact-routes) truyền friends ĐÃ LỌC,
 * hàm này đếm. Test chốt: với friends thật → childrenCount đúng; với [] → displayHasZalo
 * fallback Contact.hasZalo (Codex #6 — KHÔNG tự false).
 */
import { describe, it, expect } from 'vitest';
import { computeAggregateDisplay } from '../src/modules/contacts/contact-aggregate-display.js';

function friend(over: Record<string, unknown> = {}) {
  return {
    zaloAccountId: 'acc-real',
    relationshipKind: 'friend',
    statusRef: null,
    leadScore: 0,
    zaloGlobalId: null,
    zaloUsername: null,
    ...over,
  } as any;
}

const baseContact = {
  statusRef: null,
  leadScore: 0,
  hasZalo: null,
  zaloGlobalId: null,
  zaloUsername: null,
  friends: [],
} as any;

describe('Fix 4 — computeAggregateDisplay childrenCount (badge Cùng chăm)', () => {
  it('REGRESSION: chỉ đếm Friend thật được truyền vào (không phải 3 thẻ ma)', () => {
    // Caller đã lọc thẻ ma ở query → chỉ truyền 1 Friend thật.
    const display = computeAggregateDisplay(baseContact, [friend()]);
    expect(display.childrenCount).toBe(1);
  });

  it('khi nhận đủ 3 Friend thật → childrenCount=3 (đếm đúng, không clamp)', () => {
    const display = computeAggregateDisplay(baseContact, [
      friend({ zaloAccountId: 'a1' }),
      friend({ zaloAccountId: 'a2' }),
      friend({ zaloAccountId: 'a3' }),
    ]);
    expect(display.childrenCount).toBe(3);
  });

  it('Codex #6: friends=[] → displayHasZalo fallback Contact.hasZalo (KHÔNG tự false)', () => {
    const withHasZaloTrue = computeAggregateDisplay({ ...baseContact, hasZalo: true }, []);
    expect(withHasZaloTrue.displayHasZalo).toBe(true); // giữ giá trị Contact, không ép false

    const withHasZaloNull = computeAggregateDisplay({ ...baseContact, hasZalo: null }, []);
    expect(withHasZaloNull.displayHasZalo).toBe(null);
  });

  it('có ≥1 Friend thật → displayHasZalo=true', () => {
    const display = computeAggregateDisplay({ ...baseContact, hasZalo: null }, [friend()]);
    expect(display.displayHasZalo).toBe(true);
  });
});
