/**
 * conversation-privacy.test.ts — Riêng tư cấp HỘI THOẠI (2026-07-09).
 *
 * "Chỉ mình tôi xem cuộc hội thoại này". Khóa các BẤT BIẾN:
 *   1. Luật hội thoại THẮNG luật nick: conv.isPrivate → chỉ chủ, kể cả nick 'sub' (Thường).
 *   2. Owner/admin org KHÔNG được miễn trừ — họ chỉ là "viewer khác" ở tầng redact.
 *   3. Không cần OTP: chủ hội thoại xem được kể cả khi privacyUnlocked=false.
 *   4. Fail-closed: select thiếu cột isPrivate → CHẶN, không đoán "public".
 *   5. Ẩn hoàn toàn ở cột 2: unreadCount về 0 (người khác không biết có tin mới).
 */
import { describe, it, expect } from 'vitest';
import {
  canSeeConversationContent,
  isConversationPrivateFor,
  redactMessage,
  redactConversationRow,
  PRIVACY_BLUR_TOKEN,
  type PrivacyContext,
} from '../src/modules/privacy/redact.js';

const BLUR = PRIVACY_BLUR_TOKEN;

/** Hội thoại riêng tư do SALE bật, nằm trên nick Thường (sub) → luật nick cho phép, luật hội thoại chặn. */
const privateConvOnSubNick = {
  isPrivate: true,
  privateOwnerUserId: 'SALE',
  zaloAccount: { privacyMode: 'sub', ownerUserId: 'OWNER' },
};

/** Cùng hội thoại nhưng đã tắt riêng tư → quay về luật nick bình thường. */
const normalConvOnSubNick = {
  isPrivate: false,
  privateOwnerUserId: null,
  zaloAccount: { privacyMode: 'sub', ownerUserId: 'OWNER' },
};

const ctxSale: PrivacyContext = { viewerUserId: 'SALE', orgId: 'O1', privacyUnlocked: false };
const ctxAdmin: PrivacyContext = { viewerUserId: 'ADMIN', orgId: 'O1', privacyUnlocked: true };
const ctxColleague: PrivacyContext = { viewerUserId: 'PEER', orgId: 'O1', privacyUnlocked: false };
const ctxAnon: PrivacyContext = { viewerUserId: null, orgId: 'O1', privacyUnlocked: false };

describe('canSeeConversationContent — luật hội thoại thắng luật nick', () => {
  it('chủ hội thoại xem được, KHÔNG cần mở khóa OTP', () => {
    expect(canSeeConversationContent(privateConvOnSubNick, ctxSale)).toBe(true);
  });

  it('admin/owner org KHÔNG xem được — không có miễn trừ', () => {
    expect(canSeeConversationContent(privateConvOnSubNick, ctxAdmin)).toBe(false);
  });

  it('đồng nghiệp KHÔNG xem được dù nick là Thường (sub)', () => {
    expect(canSeeConversationContent(privateConvOnSubNick, ctxColleague)).toBe(false);
  });

  it('viewer ẩn danh KHÔNG xem được', () => {
    expect(canSeeConversationContent(privateConvOnSubNick, ctxAnon)).toBe(false);
  });

  it('tắt riêng tư → nick sub cho mọi người xem lại', () => {
    expect(canSeeConversationContent(normalConvOnSubNick, ctxColleague)).toBe(true);
  });

  it('FAIL-CLOSED: select thiếu cột isPrivate → chặn, không đoán "public"', () => {
    const missingCol = { zaloAccount: { privacyMode: 'sub', ownerUserId: 'OWNER' } } as any;
    expect(canSeeConversationContent(missingCol, ctxColleague)).toBe(false);
  });
});

describe('isConversationPrivateFor — dùng cho realtime/push/AI (ẩn hoàn toàn)', () => {
  it('chủ → không bị chặn', () => {
    expect(isConversationPrivateFor(privateConvOnSubNick, 'SALE')).toBe(false);
  });
  it('người khác + ẩn danh → bị chặn', () => {
    expect(isConversationPrivateFor(privateConvOnSubNick, 'ADMIN')).toBe(true);
    expect(isConversationPrivateFor(privateConvOnSubNick, null)).toBe(true);
  });
  it('hội thoại bình thường → không bao giờ chặn', () => {
    expect(isConversationPrivateFor(normalConvOnSubNick, null)).toBe(false);
  });
});

describe('redactMessage — hội thoại riêng tư che nội dung của người ngoài', () => {
  const msg = {
    id: 'm1', conversationId: 'c1', content: 'CHOT DEAL 2 TY',
    originalContent: 'CHOT DEAL 2 TY', senderName: 'Chị Lan', senderUid: 'uid_lan',
    attachments: [{ url: 'http://x/hopdong.pdf' }], contentType: 'file',
    senderType: 'contact', sentAt: new Date(),
  };

  it('admin org → nội dung + đính kèm + tên người gửi đều bị che', () => {
    const r = redactMessage(msg, privateConvOnSubNick, ctxAdmin);
    expect(r.content).toBe(BLUR);
    expect(r.attachments).toEqual([]);
    expect(r.senderName).toBeNull();
    expect(r.contentType).toBe('text'); // ẩn cả loại file (leak signal)
    expect(r.redacted).toBe(true);
  });

  it('chủ hội thoại → nội dung thật, không cần OTP', () => {
    const r = redactMessage(msg, privateConvOnSubNick, ctxSale);
    expect(r.content).toBe('CHOT DEAL 2 TY');
    expect(r.redacted).toBeUndefined();
  });
});

describe('redactConversationRow — cột 2 "ẩn hoàn toàn" (yêu cầu 3)', () => {
  const row = { ...privateConvOnSubNick, lastMessageContent: 'CHOT DEAL 2 TY', unreadCount: 7 };

  it('người ngoài: unreadCount về 0 + cờ conversationPrivate để FE hiện đúng câu', () => {
    const r = redactConversationRow(row, ctxAdmin) as any;
    expect(r.lastMessageContent).toBe(BLUR);
    expect(r.unreadCount).toBe(0); // không được biết CÓ tin mới
    expect(r.conversationPrivate).toBe(true);
    expect(r.redacted).toBe(true);
  });

  it('chủ hội thoại: giữ nguyên preview + số tin chưa đọc', () => {
    const r = redactConversationRow(row, ctxSale) as any;
    expect(r.lastMessageContent).toBe('CHOT DEAL 2 TY');
    expect(r.unreadCount).toBe(7);
    expect(r.conversationPrivate).toBeUndefined();
  });

  it('nick main (riêng tư cấp nick) KHÔNG bị ép unreadCount=0 — chỉ mờ preview', () => {
    const mainRow = {
      isPrivate: false,
      privateOwnerUserId: null,
      zaloAccount: { privacyMode: 'main', ownerUserId: 'OWNER' },
      lastMessageContent: 'GIA CAN HO 5 TY',
      unreadCount: 3,
    };
    const r = redactConversationRow(mainRow, ctxColleague) as any;
    expect(r.lastMessageContent).toBe(BLUR);
    expect(r.unreadCount).toBe(3); // metadata nick main vẫn hiện
    expect(r.conversationPrivate).toBeUndefined();
  });
});
