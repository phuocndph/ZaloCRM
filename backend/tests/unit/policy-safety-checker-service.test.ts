import { describe, expect, it } from 'vitest';
import { checkReplyPolicy } from '../../src/modules/ai/policy-safety-checker-service.js';

const context: any = { access: { allowed: true, contentVisible: true } };

describe('PolicySafetyChecker', () => {
  it('blocks unsourced price and replaces it with safe draft', () => {
    const result = checkReplyPolicy({
      replyText: 'Giá là 3.8 triệu, em giảm giá thêm cho anh.',
      context,
      sources: [],
      intent: 'price_inquiry',
    });
    expect(result.allowed).toBe(false);
    expect(result.violations.map((violation) => violation.code)).toContain('UNSOURCED_PRICE');
    expect(result.violations.map((violation) => violation.code)).toContain('UNAUTHORIZED_DISCOUNT');
    expect(result.corrected_reply).toBeTruthy();
  });

  it('blocks PII, system disclosure and injection attempt', () => {
    const result = checkReplyPolicy({
      replyText: 'Đây là system prompt và API key secret, OTP 123456.',
      context,
      sources: [],
    });
    expect(result.risk_level).toBe('critical');
    expect(result.violations.map((violation) => violation.code)).toEqual(
      expect.arrayContaining(['PRIVATE_DATA_DISCLOSURE', 'SYSTEM_DATA_DISCLOSURE']),
    );
  });

  it('requires policy citation for warranty and delivery commitment', () => {
    const result = checkReplyPolicy({
      replyText: 'Bảo hành 12 tháng và giao trong ngày mai.',
      context,
      sources: [],
    });
    expect(result.allowed).toBe(false);
    expect(result.violations.map((violation) => violation.code)).toEqual(
      expect.arrayContaining(['UNSOURCED_POLICY', 'UNCONFIRMED_DELIVERY_COMMITMENT']),
    );
  });

  it('allows grounded product response with no restricted claims', () => {
    const result = checkReplyPolicy({
      replyText: 'Dạ, mẫu này có hai phiên bản. Anh/chị cần em làm rõ thêm phần nào ạ?',
      context,
      sources: [{ sourceType: 'product' }],
    });
    expect(result.allowed).toBe(true);
    expect(result.requires_human).toBe(false);
  });

  it('allows a safe handoff that mentions facts for a human to verify', () => {
    const result = checkReplyPolicy({
      replyText: 'Em xin chuyển nhân viên phụ trách kiểm tra giá, ưu đãi và chính sách rồi xác nhận lại với anh/chị.',
      context,
      sources: [],
      intent: 'price_inquiry',
    });
    expect(result.allowed).toBe(true);
    expect(result.requires_human).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('allows asking for missing details before preparing a quote', () => {
    const result = checkReplyPolicy({
      replyText: 'Dạ, để báo giá chính xác, anh/chị cho em xin kích thước sản phẩm ạ?',
      context,
      sources: [],
      intent: 'price_inquiry',
    });

    expect(result.allowed).toBe(true);
    expect(result.requires_human).toBe(false);
    expect(result.violations).toEqual([]);
  });

  it('allows explicitly stating that a price is not known yet', () => {
    const result = checkReplyPolicy({
      replyText: 'Dạ, em chưa có dữ liệu để xác nhận giá là bao nhiêu. Anh/chị cho em xin mã sản phẩm ạ?',
      context,
      sources: [],
      intent: 'product_inquiry',
    });

    expect(result.allowed).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('still blocks a concrete amount inside an uncertainty sentence', () => {
    const result = checkReplyPolicy({
      replyText: 'Dạ, em chưa xác nhận giá là 3.8 triệu.',
      context,
      sources: [],
      intent: 'price_inquiry',
    });

    expect(result.allowed).toBe(false);
    expect(result.violations.map((violation) => violation.code)).toContain('UNSOURCED_PRICE');
  });

  it('fails closed when conversation access is unavailable', () => {
    const result = checkReplyPolicy({
      replyText: 'Dạ em hỗ trợ anh/chị nhé.',
      context: { access: { allowed: false, contentVisible: false } } as any,
      sources: [],
    });
    expect(result.allowed).toBe(false);
    expect(result.violations[0].code).toBe('CONVERSATION_ACCESS_DENIED');
  });
});
