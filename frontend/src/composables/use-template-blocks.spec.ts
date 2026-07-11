// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
import { describe, it, expect } from 'vitest';
import {
  templateToBlocks, sanitizeBlocks, sanitizeAttachments, sendableBlocks,
  isSimpleTextTemplate, splitTextByBlankLines,
} from './use-template-blocks';

describe('templateToBlocks — tương thích ngược (yêu cầu 12)', () => {
  it('mẫu chỉ text → 1 block text', () => {
    const b = templateToBlocks({ content: 'Xin chào' });
    expect(b.length).toBe(1);
    expect(b[0].type).toBe('text');
    expect(b[0].content).toBe('Xin chào');
  });

  it('mẫu text + 1 ảnh → block text + block image', () => {
    const b = templateToBlocks({ content: 'Hi', attachments: [{ kind: 'image', url: 'a.jpg', assetId: 'a1' }] });
    expect(b.map((x) => x.type)).toEqual(['text', 'image']);
  });

  it('mẫu text + nhiều ảnh → text + image_album', () => {
    const b = templateToBlocks({ content: 'Hi', attachments: [
      { kind: 'image', url: 'a.jpg', assetId: 'a1' },
      { kind: 'image', url: 'b.jpg', assetId: 'a2' },
    ] });
    expect(b[1].type).toBe('image_album');
    expect(b[1].attachments?.length).toBe(2);
  });

  it('mẫu chỉ ảnh (không text) → chỉ block ảnh (KHÔNG có block text rỗng)', () => {
    const b = templateToBlocks({ content: '', attachments: [{ kind: 'image', url: 'a.jpg', assetId: 'a1' }] });
    expect(b.length).toBe(1);
    expect(b[0].type).toBe('image');
  });

  it('mẫu có blocks tường minh → dùng thẳng (không derive)', () => {
    const b = templateToBlocks({ content: 'ignored', blocks: [
      { type: 'text', content: 'B1' },
      { type: 'text', content: 'B2' },
      { type: 'image_album', attachments: [{ kind: 'image', url: 'x.jpg', assetId: 'a1' }] },
    ] });
    expect(b.length).toBe(3);
    expect(b[0].content).toBe('B1');
    expect(b[2].type).toBe('image_album');
  });
});

describe('sanitizeBlocks — chuẩn hoá + loại rác', () => {
  it('bỏ block sai type + block ảnh rỗng', () => {
    const b = sanitizeBlocks([
      { type: 'text', content: 'ok' },
      { type: 'bogus', content: 'x' },
      { type: 'image', attachments: [] },
      { type: 'delay', delayMs: 500 },
    ]);
    expect(b.map((x) => x.type)).toEqual(['text', 'delay']);
    expect(b[1].delayMs).toBe(500);
  });
  it('kẹp delay 0..10000', () => {
    expect(sanitizeBlocks([{ type: 'delay', delayMs: 99999 }])[0].delayMs).toBe(10000);
    expect(sanitizeBlocks([{ type: 'delay', delayMs: -5 }])[0].delayMs).toBe(0);
  });
  it('không phải array → []', () => {
    expect(sanitizeBlocks(null)).toEqual([]);
  });
});

describe('sanitizeAttachments', () => {
  it('giữ item có url hoặc assetId, ép kind', () => {
    const a = sanitizeAttachments([
      { kind: 'image', url: 'a.jpg' },
      { kind: 'video', assetId: 'v1', url: '' },
      { kind: 'file', url: 'f.pdf', name: 'f' },
      { nope: true },
    ]);
    expect(a.length).toBe(3);
    expect(a[1].kind).toBe('video');
  });
});

describe('sendableBlocks — kế hoạch gửi', () => {
  it('bỏ block tắt + text rỗng', () => {
    const plan = sendableBlocks([
      { id: '1', type: 'text', content: 'ok', enabled: true },
      { id: '2', type: 'text', content: '  ', enabled: true },
      { id: '3', type: 'text', content: 'off', enabled: false },
      { id: '4', type: 'image', attachments: [{ kind: 'image', url: 'a', assetId: 'x' }], enabled: true },
    ]);
    expect(plan.map((b) => b.id)).toEqual(['1', '4']);
  });
});

describe('isSimpleTextTemplate + splitTextByBlankLines', () => {
  it('1 block text = đơn giản (chèn thẳng ô soạn, không mở preview)', () => {
    expect(isSimpleTextTemplate([{ id: '1', type: 'text', content: 'x', enabled: true }])).toBe(true);
    expect(isSimpleTextTemplate([
      { id: '1', type: 'text', content: 'x', enabled: true },
      { id: '2', type: 'image', attachments: [{ kind: 'image', url: 'a', assetId: 'y' }], enabled: true },
    ])).toBe(false);
  });
  it('tách theo dòng trống', () => {
    expect(splitTextByBlankLines('A\n\nB\n\n\nC')).toEqual(['A', 'B', 'C']);
    expect(splitTextByBlankLines('chỉ một đoạn')).toEqual(['chỉ một đoạn']);
  });
});
