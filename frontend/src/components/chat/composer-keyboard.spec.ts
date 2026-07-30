// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
import { describe, expect, it } from 'vitest';
import { getComposerEnterAction } from './composer-keyboard';

function key(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: 'Enter',
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    isComposing: false,
    keyCode: 13,
    ...overrides,
  } as KeyboardEvent;
}

describe('getComposerEnterAction', () => {
  it('Enter thường gửi tin', () => {
    expect(getComposerEnterAction(key())).toBe('send');
  });

  it('Ctrl + Shift + Enter xuống dòng', () => {
    expect(getComposerEnterAction(key({ ctrlKey: true, shiftKey: true }))).toBe('newline');
  });

  it('không gửi nhầm khi bộ gõ IME đang xác nhận chữ', () => {
    expect(getComposerEnterAction(key({ isComposing: true }))).toBe('none');
    expect(getComposerEnterAction(key({ keyCode: 229 }))).toBe('none');
  });

  it('không gửi khi Enter đi cùng modifier khác', () => {
    expect(getComposerEnterAction(key({ shiftKey: true }))).toBe('none');
    expect(getComposerEnterAction(key({ ctrlKey: true }))).toBe('none');
    expect(getComposerEnterAction(key({ altKey: true }))).toBe('none');
    expect(getComposerEnterAction(key({ metaKey: true }))).toBe('none');
  });

  it('bỏ qua phím không phải Enter', () => {
    expect(getComposerEnterAction(key({ key: 'a' }))).toBe('none');
  });
});
