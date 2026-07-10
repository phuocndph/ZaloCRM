/**
 * hmac.test.ts — Phase 5 (Bảo mật xác thực 2026-06-08)
 * Verify util HMAC chung: chữ ký timing-safe, timestamp window (replay), nonce.
 *
 * 2026-07-10: bỏ khối test `fb-adapter.verifyWebhook` — Facebook Lead Ads đã chuyển sang
 * bản Enterprise (commit 24160d73, open-core B6) nên module không còn trong repo này.
 * Test của nó thuộc về repo _ee; phần util HMAC lõi dưới đây vẫn thuộc Community.
 */
import { describe, it, expect } from 'vitest';
import {
  computeHmacHex,
  verifyHmacSignature,
  verifyHmacRequest,
} from '../../src/shared/security/hmac.js';

const SECRET = 'test-secret';
const BODY = JSON.stringify({ event: 'order', id: 123 });

describe('verifyHmacSignature', () => {
  it('chữ ký đúng -> true', () => {
    const sig = computeHmacHex(BODY, SECRET);
    expect(verifyHmacSignature(BODY, sig, SECRET)).toBe(true);
  });
  it('body bị sửa -> false', () => {
    const sig = computeHmacHex(BODY, SECRET);
    expect(verifyHmacSignature(BODY + 'x', sig, SECRET)).toBe(false);
  });
  it('sai secret -> false', () => {
    const sig = computeHmacHex(BODY, 'other');
    expect(verifyHmacSignature(BODY, sig, SECRET)).toBe(false);
  });
  it('thiếu chữ ký -> false', () => {
    expect(verifyHmacSignature(BODY, undefined, SECRET)).toBe(false);
  });
});

describe('verifyHmacRequest (s2s + replay protection)', () => {
  const now = 1_700_000_000_000;
  function sign(ts: number, nonce: string, body = BODY) {
    return computeHmacHex(`${ts}.${nonce}.${body}`, SECRET);
  }

  it('hợp lệ trong cửa sổ -> valid + trả nonce', () => {
    const sig = sign(now, 'n1');
    const r = verifyHmacRequest({
      rawBody: BODY, signature: sig, secret: SECRET,
      timestamp: String(now), nonce: 'n1', now,
    });
    expect(r.valid).toBe(true);
    expect(r.nonce).toBe('n1');
  });

  it('thiếu nonce/timestamp/signature -> missing_fields', () => {
    const r = verifyHmacRequest({ rawBody: BODY, signature: undefined, secret: SECRET, timestamp: String(now), nonce: 'n1', now });
    expect(r).toMatchObject({ valid: false, reason: 'missing_fields' });
  });

  it('timestamp ngoài cửa sổ (replay cũ) -> timestamp_out_of_window', () => {
    const oldTs = now - 10 * 60 * 1000; // 10 phút trước, > 5 phút
    const sig = sign(oldTs, 'n2');
    const r = verifyHmacRequest({
      rawBody: BODY, signature: sig, secret: SECRET,
      timestamp: String(oldTs), nonce: 'n2', now,
    });
    expect(r).toMatchObject({ valid: false, reason: 'timestamp_out_of_window' });
  });

  it('chữ ký sai (body đổi sau khi ký) -> bad_signature', () => {
    const sig = sign(now, 'n3', BODY);
    const r = verifyHmacRequest({
      rawBody: BODY + 'tampered', signature: sig, secret: SECRET,
      timestamp: String(now), nonce: 'n3', now,
    });
    expect(r).toMatchObject({ valid: false, reason: 'bad_signature' });
  });
});
