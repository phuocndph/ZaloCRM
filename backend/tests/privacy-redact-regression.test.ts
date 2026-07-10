/**
 * privacy-redact-regression.test.ts — Test hồi quy BẢO MẬT Riêng tư (2026-06-11, Đợt 3.2).
 *
 * Vùng cực nhạy cảm: nick Riêng tư (privacyMode='main') lộ nội dung tin nhắn / PII
 * khách cho cấp trên / đồng nghiệp không phải chính chủ = mất niềm tin hệ thống.
 * Test này khoá các BẤT BIẾN của tầng redact để mọi thay đổi tương lai không tái phạm.
 *
 * Quy tắc vàng (canSeeConversationContent):
 *   Nội dung/PII của nick main CHỈ hiện khi viewer LÀ CHỦ NICK *VÀ* ĐÃ UNLOCK OTP.
 *   admin/owner org KHÔNG được miễn trừ. Nick 'sub' (Thường) luôn hiện đầy đủ.
 */
import { describe, it, expect } from 'vitest';
import {
  canSeeConversationContent,
  redactMessage,
  redactFriend,
  redactContact,
  PRIVACY_BLUR_TOKEN,
  type PrivacyContext,
} from '../src/modules/privacy/redact.js';

const BLUR = PRIVACY_BLUR_TOKEN;

// isPrivate=false → hội thoại KHÔNG bật riêng tư cấp hội thoại (2026-07-09). Hai cột này
// BẮT BUỘC: thiếu là canSeeConversationContent fail-closed (chặn), không đoán "public".
const mainNick = { isPrivate: false, privateOwnerUserId: null, zaloAccount: { privacyMode: 'main', ownerUserId: 'OWNER' } };
const subNick = { isPrivate: false, privateOwnerUserId: null, zaloAccount: { privacyMode: 'sub', ownerUserId: 'OWNER' } };

const ctxOwnerUnlocked: PrivacyContext = { viewerUserId: 'OWNER', orgId: 'O1', privacyUnlocked: true };
const ctxOwnerLocked: PrivacyContext = { viewerUserId: 'OWNER', orgId: 'O1', privacyUnlocked: false };
const ctxOther: PrivacyContext = { viewerUserId: 'STRANGER', orgId: 'O1', privacyUnlocked: false };
// "admin xem" mô phỏng: vẫn là 1 viewer khác chủ nick → KHÔNG được miễn trừ.
const ctxAdminLike: PrivacyContext = { viewerUserId: 'ADMIN', orgId: 'O1', privacyUnlocked: true };

describe('canSeeConversationContent — quy tắc vàng', () => {
  it('nick sub luôn xem được (mọi viewer)', () => {
    expect(canSeeConversationContent(subNick, ctxOther)).toBe(true);
    expect(canSeeConversationContent(subNick, ctxOwnerLocked)).toBe(true);
  });
  it('nick main: chỉ chủ nick + đã unlock', () => {
    expect(canSeeConversationContent(mainNick, ctxOwnerUnlocked)).toBe(true);
  });
  it('nick main: chủ nick CHƯA unlock → KHÔNG xem', () => {
    expect(canSeeConversationContent(mainNick, ctxOwnerLocked)).toBe(false);
  });
  it('nick main: người khác (kể cả đã unlock của chính họ) → KHÔNG xem', () => {
    expect(canSeeConversationContent(mainNick, ctxOther)).toBe(false);
    expect(canSeeConversationContent(mainNick, ctxAdminLike)).toBe(false);
  });
});

describe('redactMessage — nội dung tin nhắn nick main', () => {
  const msg = {
    id: 'm1', conversationId: 'c1', content: 'GIA CAN HO 5 TY',
    originalContent: 'GIA CAN HO 5 TY', senderName: 'Chị Lan', senderUid: 'uid_lan',
    attachments: [{ url: 'http://x/cmnd.jpg' }], contentType: 'image',
    senderType: 'contact', sentAt: new Date(),
  };
  it('người khác → content + đính kèm + tên người gửi đều bị che', () => {
    const r = redactMessage(msg, mainNick, ctxOther);
    expect(r.content).toBe(BLUR);
    expect(r.attachments).toEqual([]);
    expect(r.senderName).toBeNull();
    expect(r.senderUid).toBeNull();
    expect(r.contentType).toBe('text'); // ẩn cả loại (image leak signal)
    expect(r.redacted).toBe(true);
  });
  it('chủ nick đã unlock → nội dung thật', () => {
    const r = redactMessage(msg, mainNick, ctxOwnerUnlocked);
    expect(r.content).toBe('GIA CAN HO 5 TY');
    expect(r.redacted).toBeUndefined();
  });
  it('nick sub → nội dung thật cho mọi người', () => {
    const r = redactMessage(msg, subNick, ctxOther);
    expect(r.content).toBe('GIA CAN HO 5 TY');
  });
});

// NGUYÊN TẮC MỚI (Anh chốt 2026-06-11 qua CEO review): CHỈ tin nhắn được bảo mật.
// Tên/avatar/SĐT/UID/định danh KH = tài sản công ty → LUÔN hiện. Privacy che DUY NHẤT
// preview tin nhắn (lastInbound/OutboundPreview) ở friend, và preview aggregate ở Contact Cha.
describe('redactFriend — CHỈ blur preview tin nhắn, danh tính KH hiện thật', () => {
  const friend = {
    id: 'f1', aliasInNick: 'KH VIP', zaloUidInNick: 'uid_kh',
    lastInboundPreview: 'Em oi con hang khong', lastOutboundPreview: 'Da con anh',
    zaloDisplayName: 'Tai Nguyen', zaloGlobalId: 'g1', zaloUsername: 't_tai',
    zaloAvatarUrl: 'http://x/a.jpg', leadScore: 90,
    contact: { id: 'c1', fullName: 'Nguyen Van Tai', crmName: 'Tai', phone: '0901', email: 'a@b.c' },
    zaloAccount: { privacyMode: 'main', ownerUserId: 'OWNER' },
  };
  it('người khác → CHỈ preview tin nhắn bị che; tên/avatar/SĐT/UID/PII HIỆN THẬT', () => {
    const r: any = redactFriend(friend, ctxOther);
    // Bảo mật: chỉ preview tin nhắn
    expect(r.lastInboundPreview).toBe(BLUR);
    expect(r.lastOutboundPreview).toBe(BLUR);
    expect(r.redacted).toBe(true);
    // Danh tính KH = tài sản công ty → HIỆN THẬT (không còn blur)
    expect(r.aliasInNick).toBe('KH VIP');
    expect(r.zaloUidInNick).toBe('uid_kh');
    expect(r.zaloDisplayName).toBe('Tai Nguyen');
    expect(r.zaloGlobalId).toBe('g1');
    expect(r.zaloUsername).toBe('t_tai');
    expect(r.zaloAvatarUrl).toBe('http://x/a.jpg');
    expect(r.contact.fullName).toBe('Nguyen Van Tai');
    expect(r.contact.phone).toBe('0901');
    expect(r.contact.email).toBe('a@b.c');
    expect(r.leadScore).toBe(90);
  });
  it('chủ nick đã unlock → thật (preview cũng thật)', () => {
    const r: any = redactFriend(friend, { viewerUserId: 'OWNER', orgId: 'O1', privacyUnlocked: true });
    expect(r.lastInboundPreview).toBe('Em oi con hang khong');
    expect(r.redacted).toBeUndefined();
  });
  it('nick sub → thật', () => {
    const r: any = redactFriend({ ...friend, zaloAccount: { privacyMode: 'sub', ownerUserId: 'OWNER' } }, ctxOther);
    expect(r.lastInboundPreview).toBe('Em oi con hang khong');
  });
  it('FAIL-CLOSED: thiếu privacyMode (select sót) → vẫn blur preview tin nhắn', () => {
    const r: any = redactFriend({ ...friend, zaloAccount: { ownerUserId: 'OWNER' } } as any, ctxOther);
    expect(r.lastInboundPreview).toBe(BLUR);
    expect(r.redacted).toBe(true);
    // nhưng danh tính vẫn hiện (chỉ tin nhắn bảo mật)
    expect(r.aliasInNick).toBe('KH VIP');
  });
  it('friend KHÔNG có preview tin nhắn → trả nguyên, không cờ redacted', () => {
    const noMsg = { ...friend, lastInboundPreview: null, lastOutboundPreview: null };
    const r: any = redactFriend(noMsg, ctxOther);
    expect(r.redacted).toBeUndefined();
    expect(r.aliasInNick).toBe('KH VIP');
  });
});

describe('redactContact — PII Cha HIỆN THẬT, chỉ preview tin nhắn aggregate bị che', () => {
  const contact = {
    id: 'c1', orgId: 'O1', fullName: 'Nguyen Van Tai', phone: '0901', email: 'a@b.c',
    lastInboundPreview: 'Em oi con hang khong', lastOutboundPreview: 'Da con anh',
    leadScore: 70, engagementScore: 5,
  };
  it('tên/SĐT/email HIỆN THẬT (tài sản công ty); preview tin nhắn bị che', () => {
    const r = redactContact(contact, ctxOther);
    // Danh tính KH hiện thật
    expect(r.fullName).toBe('Nguyen Van Tai');
    expect(r.phone).toBe('0901');
    expect(r.email).toBe('a@b.c');
    expect(r.leadScore).toBe(70);
    // Preview tin nhắn (aggregate từ friend nick riêng tư) VẪN che
    expect(r.lastInboundPreview).toBe(BLUR);
    expect(r.lastOutboundPreview).toBe(BLUR);
    expect(r.redacted).toBe(true);
  });
  it('Contact KHÔNG có preview tin nhắn → hiện nguyên, không cờ redacted', () => {
    const noMsg = { id: 'c1', orgId: 'O1', fullName: 'Nguyen Van Tai', phone: '0901' };
    const r = redactContact(noMsg, ctxOther);
    expect(r.fullName).toBe('Nguyen Van Tai');
    expect(r.redacted).toBeUndefined();
  });
});
