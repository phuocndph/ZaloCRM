/**
 * message-template.test.ts — CRUD Mẫu tin nhắn (core, 2026-07-11).
 * Test THUẦN: chuẩn hoá shortcut, derive content/rich, sanitize đính kèm.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeShortcut,
  deriveContent,
  sanitizeAttachments,
} from '../src/modules/chat/message-template-routes.js';

describe('normalizeShortcut', () => {
  it('bỏ dấu tiếng Việt + "/" + lowercase', () => {
    expect(normalizeShortcut('/GiáEGV')).toBe('giaegv');
    expect(normalizeShortcut('Đặt Cọc')).toBe('datcoc');
  });
  it('bỏ ký tự lạ, giữ [a-z0-9_-]', () => {
    expect(normalizeShortcut('chao@khach!')).toBe('chaokhach');
    expect(normalizeShortcut('gia_2024-q1')).toBe('gia_2024-q1');
  });
  it('rỗng/null → null', () => {
    expect(normalizeShortcut('')).toBeNull();
    expect(normalizeShortcut(null)).toBeNull();
    expect(normalizeShortcut('///')).toBeNull();
  });
});

describe('deriveContent', () => {
  it('ưu tiên contentRich.text, content = rich.text', () => {
    const r = deriveContent({ contentRich: { text: 'Xin chào {name}', styles: [{ st: 'b', start: 0, len: 3 }] } });
    expect(r.content).toBe('Xin chào {name}');
    expect(r.contentRich?.styles?.length).toBe(1);
  });
  it('fallback content khi không có rich', () => {
    const r = deriveContent({ content: 'Hello' });
    expect(r.content).toBe('Hello');
    expect(r.contentRich).toEqual({ text: 'Hello', styles: [] });
  });
  it('rỗng → contentRich null', () => {
    expect(deriveContent({}).contentRich).toBeNull();
  });
});

describe('sanitizeAttachments', () => {
  it('giữ item có url, ép kind hợp lệ, chặn field lạ', () => {
    const out = sanitizeAttachments([
      { kind: 'image', url: 'https://cdn/x.jpg', name: 'x', size: 100, evil: 'drop' },
      { kind: 'file', url: 'https://cdn/y.pdf' },
      { url: 'https://cdn/z.png' },
      { noUrl: true },
      'bad',
    ]);
    expect(out.length).toBe(3);
    expect((out[0] as any).kind).toBe('image');
    expect((out[0] as any).evil).toBeUndefined();
    expect((out[1] as any).kind).toBe('file');
    expect((out[2] as any).kind).toBe('image'); // default
  });
  it('không phải array → []', () => {
    expect(sanitizeAttachments(null)).toEqual([]);
    expect(sanitizeAttachments('x')).toEqual([]);
  });
  it('giới hạn tối đa 10 item', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ url: `https://cdn/${i}.jpg` }));
    expect(sanitizeAttachments(many).length).toBe(10);
  });
});
