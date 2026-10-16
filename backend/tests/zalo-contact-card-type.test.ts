import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/shared/database/prisma-client.js', () => ({ prisma: {} }));
vi.mock('../src/shared/utils/logger.js', () => ({ logger: { info: vi.fn() } }));
import { detectContentType } from '../src/modules/zalo/zalo-message-helpers.js';

describe('incoming Zalo card classification', () => {
  it.each(['recommened.user', 'recommended.user', 'show.profile'])('prioritizes %s over links and QR thumbnails', (action) => {
    const content = { action, href: 'https://zaloapp.com/qr/profile', description: JSON.stringify({ phone: '0901234567', qrCodeUrl: 'https://cdn.example/qr.png' }) };
    expect(detectContentType('chat.recommended', content)).toBe('contact_card');
    expect(detectContentType('chat.link', content)).toBe('contact_card');
    expect(detectContentType(undefined, content)).toBe('contact_card');
  });
  it('keeps calls, bank transfers, actual links and QR messages distinct', () => {
    expect(detectContentType('chat.recommended', { action: 'recommened.calltime' })).toBe('call');
    expect(detectContentType('chat.recommended', { action: 'zinstant.bankcard' })).toBe('bank_transfer');
    expect(detectContentType('chat.recommended', { action: 'recommened.link', href: 'https://example.com' })).toBe('link');
    expect(detectContentType('chat.recommended', { description: '{"qrCodeUrl":"https://example.com/qr"}' })).toBe('qr_code');
    expect(detectContentType(undefined, 'Hello')).toBe('text');
  });
});
