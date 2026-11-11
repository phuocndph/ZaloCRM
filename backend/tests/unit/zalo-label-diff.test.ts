import { describe, expect, it } from 'vitest';
import { isFriendLabelStateUnchanged } from '../../src/modules/zalo/zalo-label-diff.js';

const label = { id: 2, name: 'Tiềm Năng', color: '#4bc377', emoji: null };

describe('isFriendLabelStateUnchanged', () => {
  it('is unchanged for a friend without labels (the common case)', () => {
    expect(isFriendLabelStateUnchanged([], [], [], [])).toBe(true);
    expect(isFriendLabelStateUnchanged([], [], ['vip'], ['vip'])).toBe(true);
  });

  it('ignores JSONB key order and a missing emoji key', () => {
    const stored = [{ emoji: null, color: '#4bc377', name: 'Tiềm Năng', id: 2 }];
    expect(isFriendLabelStateUnchanged(stored, [label], ['🔵 Tiềm Năng'], ['🔵 Tiềm Năng'])).toBe(true);
    const legacy = [{ id: 2, name: 'Tiềm Năng', color: '#4bc377' }];
    expect(isFriendLabelStateUnchanged(legacy, [label], ['🔵 Tiềm Năng'], ['🔵 Tiềm Năng'])).toBe(true);
  });

  it('detects added, removed, renamed and recoloured labels', () => {
    expect(isFriendLabelStateUnchanged([], [label], [], ['🔵 Tiềm Năng'])).toBe(false);
    expect(isFriendLabelStateUnchanged([label], [], ['🔵 Tiềm Năng'], [])).toBe(false);
    expect(isFriendLabelStateUnchanged([{ ...label, name: 'Cũ' }], [label], ['🔵 Tiềm Năng'], ['🔵 Tiềm Năng'])).toBe(false);
    expect(isFriendLabelStateUnchanged([{ ...label, color: '#000000' }], [label], ['🔵 Tiềm Năng'], ['🔵 Tiềm Năng'])).toBe(false);
    expect(isFriendLabelStateUnchanged([{ ...label, emoji: '🔥' }], [label], ['🔵 Tiềm Năng'], ['🔵 Tiềm Năng'])).toBe(false);
  });

  it('detects a mirror tag that still needs to be written', () => {
    expect(isFriendLabelStateUnchanged([label], [label], [], ['🔵 Tiềm Năng'])).toBe(false);
    expect(isFriendLabelStateUnchanged([label], [label], ['vip', '🔵 Tiềm Năng'], ['🔵 Tiềm Năng', 'vip'])).toBe(false);
  });

  it('rewrites rows whose stored value is not an array', () => {
    expect(isFriendLabelStateUnchanged(null, [], [], [])).toBe(false);
    expect(isFriendLabelStateUnchanged([], [], null, [])).toBe(false);
    expect(isFriendLabelStateUnchanged([null], [label], ['🔵 Tiềm Năng'], ['🔵 Tiềm Năng'])).toBe(false);
  });
});
