/**
 * deleted-nick-privacy.test.ts — Hồi quy: nick RIÊNG TƯ ĐÃ XÓA (archivedAt != null)
 * KHÔNG được làm yếu tầng redact.
 *
 * Bối cảnh (vòng đời nick Zalo, YC2 2026-06-20): nick xóa-có-uid vẫn HIỆN hội thoại cũ
 * (đọc-only). Bất biến: việc nick đã archived KHÔNG được nới lỏng quy tắc Riêng tư —
 * tin nhắn của nick main vẫn CHỈ hiện cho CHÍNH CHỦ + đã unlock. Sale khác / cấp trên
 * tuyệt đối không lộ nội dung.
 *
 * Convention privacy-redact-regression: gọi HÀM THẬT, KHÔNG mock redact.
 */
import { describe, it, expect } from 'vitest';
import {
  canSeeConversationContent,
  redactMessage,
  PRIVACY_BLUR_TOKEN,
  type PrivacyContext,
} from '../src/modules/privacy/redact.js';

const BLUR = PRIVACY_BLUR_TOKEN;

// Nick riêng tư ĐÃ XÓA: privacyMode='main', ownerUserId='OWNER', archivedAt đã set.
// isPrivate=false: hội thoại KHÔNG bật riêng tư cấp hội thoại (2026-07-09) — cột này bắt
// buộc, thiếu là canSeeConversationContent fail-closed (chặn) chứ không đoán "public".
const deletedMainNick = {
  isPrivate: false,
  privateOwnerUserId: null,
  zaloAccount: { privacyMode: 'main', ownerUserId: 'OWNER', archivedAt: new Date() },
};

const ctxOwnerUnlocked: PrivacyContext = { viewerUserId: 'OWNER', orgId: 'O1', privacyUnlocked: true };
const ctxOther: PrivacyContext = { viewerUserId: 'STRANGER', orgId: 'O1', privacyUnlocked: false };

describe('deleted-nick-privacy — archivedAt KHÔNG làm yếu redact', () => {
  const msg = {
    id: 'm1', conversationId: 'c1', content: 'GIA CAN HO 5 TY',
    originalContent: 'GIA CAN HO 5 TY', senderName: 'Chị Lan', senderUid: 'uid_lan',
    attachments: [{ url: 'http://x/cmnd.jpg' }], contentType: 'image',
    senderType: 'contact', sentAt: new Date(),
  };

  it('nick riêng tư ĐÃ XÓA: sale khác → nội dung + đính kèm + người gửi đều bị che', () => {
    const r = redactMessage(msg, deletedMainNick, ctxOther);
    expect(r.content).toBe(BLUR);
    expect(r.attachments).toEqual([]);
    expect(r.senderName).toBeNull();
    expect(r.senderUid).toBeNull();
    expect(r.redacted).toBe(true);
  });

  it('canSeeConversationContent: sale khác KHÔNG xem được nick xóa riêng tư', () => {
    expect(canSeeConversationContent(deletedMainNick, ctxOther)).toBe(false);
  });

  it('canSeeConversationContent: chính chủ đã unlock VẪN xem được (nick xóa đọc-only)', () => {
    expect(canSeeConversationContent(deletedMainNick, ctxOwnerUnlocked)).toBe(true);
  });

  it('chính chủ đã unlock → nội dung thật (kể cả nick đã xóa)', () => {
    const r = redactMessage(msg, deletedMainNick, ctxOwnerUnlocked);
    expect(r.content).toBe('GIA CAN HO 5 TY');
    expect(r.redacted).toBeUndefined();
  });
});
