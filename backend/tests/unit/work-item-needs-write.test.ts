import { describe, it, expect } from 'vitest';
import { needsWorkItemWrite } from '../../src/modules/dashboard/conversation-work-item-service.js';
const now = new Date('2026-11-10T10:00:00Z');
describe('needsWorkItemWrite', () => {
  it('ghi khi chưa có dòng', () => expect(needsWorkItemWrite(undefined, 'a', now)).toBe(true));
  it('bỏ qua khi không đổi', () => expect(needsWorkItemWrite({ fingerprint: 'a', status: 'open', snoozedUntil: null }, 'a', now)).toBe(false));
  it('ghi khi fingerprint đổi', () => expect(needsWorkItemWrite({ fingerprint: 'a', status: 'open', snoozedUntil: null }, 'b', now)).toBe(true));
  it('ghi khi dismissed', () => expect(needsWorkItemWrite({ fingerprint: 'a', status: 'dismissed', snoozedUntil: null }, 'a', now)).toBe(true));
  it('ghi khi hết snooze', () => expect(needsWorkItemWrite({ fingerprint: 'a', status: 'snoozed', snoozedUntil: new Date('2026-11-10T09:00:00Z') }, 'a', now)).toBe(true));
  it('bỏ qua khi còn snooze', () => expect(needsWorkItemWrite({ fingerprint: 'a', status: 'snoozed', snoozedUntil: new Date('2026-11-10T11:00:00Z') }, 'a', now)).toBe(false));
});
