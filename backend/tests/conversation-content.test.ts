/**
 * conversation-content.test.ts — Conversation Content Library (2026-07-11).
 *
 * Test THUẦN (không DB) cho logic tách được: build where tìm kiếm/lọc, trích URL (tab Link),
 * clamp phân trang, và BẤT BIẾN quyền riêng tư áp cho nội dung (pinned/search/media/link
 * đều đi qua redactMessage — người không có quyền KHÔNG nhận content thật).
 */
import { describe, it, expect } from 'vitest';
import {
  clampInt,
  extractFirstUrl,
  buildSearchWhere,
  resolveOrderBy,
} from '../src/modules/chat/conversation-content-helpers.js';
import { redactMessage, type PrivacyContext } from '../src/modules/privacy/redact.js';

describe('clampInt — phân trang an toàn', () => {
  it('fallback khi thiếu / không hợp lệ', () => {
    expect(clampInt(undefined, 30, 1, 100)).toBe(30);
    expect(clampInt('abc', 30, 1, 100)).toBe(30);
  });
  it('kẹp trong [min,max]', () => {
    expect(clampInt('0', 30, 1, 100)).toBe(1);
    expect(clampInt('9999', 30, 1, 100)).toBe(100);
    expect(clampInt('42', 30, 1, 100)).toBe(42);
  });
});

describe('extractFirstUrl — tab Link auto-detect', () => {
  it('trích URL trong text thường', () => {
    expect(extractFirstUrl('Xem tại https://hs.vn/bang-gia nhé')).toBe('https://hs.vn/bang-gia');
  });
  it('ưu tiên href trong JSON (tin type=link Zalo)', () => {
    const json = JSON.stringify({ title: 'Báo giá', href: 'https://example.com/a', thumb: 'x' });
    expect(extractFirstUrl(json)).toBe('https://example.com/a');
  });
  it('không có URL → null', () => {
    expect(extractFirstUrl('chào anh, em gửi tài liệu sau')).toBeNull();
    expect(extractFirstUrl(null)).toBeNull();
    expect(extractFirstUrl('')).toBeNull();
  });
  it('bỏ ký tự đóng ngoặc/nháy bám đuôi URL', () => {
    expect(extractFirstUrl('(link https://a.vn/x)')).toBe('https://a.vn/x');
  });
});

describe('buildSearchWhere — lọc trong đúng 1 hội thoại', () => {
  const CID = 'conv-1';

  it('luôn scope theo conversationId', () => {
    expect(buildSearchWhere({ conversationId: CID }).conversationId).toBe(CID);
  });

  it('q → ILIKE case-insensitive (VN có dấu khớp chính xác)', () => {
    const w = buildSearchWhere({ conversationId: CID, term: 'Báo giá' });
    expect(w.content).toEqual({ contains: 'Báo giá', mode: 'insensitive' });
  });

  it('q rỗng/space → không thêm điều kiện content', () => {
    expect(buildSearchWhere({ conversationId: CID, term: '   ' }).content).toBeUndefined();
  });

  it('type=media → ảnh + video', () => {
    expect(buildSearchWhere({ conversationId: CID, type: 'media' }).contentType).toEqual({
      in: ['image', 'video'],
    });
  });

  it('type=file → chỉ file', () => {
    expect(buildSearchWhere({ conversationId: CID, type: 'file' }).contentType).toBe('file');
  });

  it('type=link → gộp contentType=link OR text chứa http', () => {
    const w = buildSearchWhere({ conversationId: CID, type: 'link' });
    expect(w.OR).toEqual([
      { contentType: 'link' },
      { content: { contains: 'http', mode: 'insensitive' } },
    ]);
  });

  it('type=pinned → chỉ tin đang ghim (unpinnedAt null)', () => {
    const w = buildSearchWhere({ conversationId: CID, type: 'pinned' });
    expect(w.messagePins).toEqual({ some: { unpinnedAt: null } });
  });

  it('senderType self/contact áp đúng; giá trị khác bỏ qua', () => {
    expect(buildSearchWhere({ conversationId: CID, senderType: 'self' }).senderType).toBe('self');
    expect(buildSearchWhere({ conversationId: CID, senderType: 'contact' }).senderType).toBe('contact');
    expect(buildSearchWhere({ conversationId: CID, senderType: 'all' }).senderType).toBeUndefined();
  });

  it('khoảng thời gian from/to → gte/lte trên sentAt', () => {
    const w = buildSearchWhere({ conversationId: CID, from: '2026-01-01', to: '2026-02-01' });
    expect((w.sentAt as any).gte).toEqual(new Date('2026-01-01'));
    expect((w.sentAt as any).lte).toEqual(new Date('2026-02-01'));
  });
});

describe('resolveOrderBy — tab File sắp xếp', () => {
  it('newest = zaloMsgIdNum desc', () => {
    expect(resolveOrderBy('newest')[0]).toEqual({ zaloMsgIdNum: { sort: 'desc', nulls: 'last' } });
  });
  it('oldest = zaloMsgIdNum asc', () => {
    expect(resolveOrderBy('oldest')[0]).toEqual({ zaloMsgIdNum: { sort: 'asc', nulls: 'first' } });
  });
  it('mặc định = newest', () => {
    expect(resolveOrderBy(undefined)[0]).toEqual({ zaloMsgIdNum: { sort: 'desc', nulls: 'last' } });
  });
});

// ── BẤT BIẾN QUYỀN: nội dung hội thoại riêng tư KHÔNG rò qua panel content ──
// Content endpoints (pinned/search/media/file/link/context) đều map qua redactMessage.
// Khóa: người KHÔNG phải chủ hội thoại riêng tư nhận bản redacted (không content thật).
describe('quyền riêng tư — content library không rò dữ liệu', () => {
  const privateConv = {
    isPrivate: true,
    privateOwnerUserId: 'OWNER',
    zaloAccount: { privacyMode: 'sub', ownerUserId: 'OWNER' },
  };
  const msg = {
    id: 'm1',
    conversationId: 'c1',
    senderType: 'contact',
    content: 'Số tài khoản 0123456789 — bí mật',
    contentType: 'text',
    attachments: [{ url: 'https://cdn/x.jpg' }],
    quote: { text: 'q' },
    senderName: 'KH',
    sentAt: new Date(),
  };

  it('người ngoài (kể cả admin) → content bị redact, KHÔNG lộ', () => {
    const ctxPeer: PrivacyContext = { viewerUserId: 'PEER', orgId: 'O1', privacyUnlocked: true };
    const out = redactMessage(msg, privateConv, ctxPeer);
    expect(out.redacted).toBe(true);
    expect(out.content).not.toContain('0123456789');
    expect(out.attachments).toEqual([]);
    expect(out.quote).toBeNull();
    expect(out.senderName).toBeNull();
  });

  it('chủ hội thoại → xem đầy đủ (không redact)', () => {
    const ctxOwner: PrivacyContext = { viewerUserId: 'OWNER', orgId: 'O1', privacyUnlocked: false };
    const out = redactMessage(msg, privateConv, ctxOwner);
    expect(out.redacted).toBeUndefined();
    expect(out.content).toContain('0123456789');
  });
});
