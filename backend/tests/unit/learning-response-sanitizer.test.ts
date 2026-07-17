import { describe, expect, it } from 'vitest';
import { sanitizeLearningResponse } from '../../src/modules/ai/learning-response-sanitizer.js';

describe('sanitizeLearningResponse', () => {
  it('removes encrypted and credential fields at every depth', () => {
    const value = sanitizeLearningResponse({
      id: 'candidate-1',
      payloadEncrypted: new Uint8Array([1, 2, 3]),
      nested: {
        apiKey: 'secret',
        access_token: 'token-value',
        safe: 'visible',
        deeper: { credentialRef: 'vault:123', status: 'draft' },
      },
    });

    expect(value).toEqual({
      id: 'candidate-1',
      nested: {
        safe: 'visible',
        deeper: { status: 'draft' },
      },
    });
  });

  it('redacts PII recursively in legacy context, outcome and evidence', () => {
    const value = sanitizeLearningResponse({
      payload: {
        context: {
          customer: {
            phone: '0901234567',
            email: 'sale@example.com',
          },
        },
        outcome: ['otp: 123456', { note: 'mật khẩu=abc123' }],
      },
      evidence: [{ note: 'Liên hệ 0912345678' }],
    });

    const serialized = JSON.stringify(value);
    expect(serialized).not.toContain('0901234567');
    expect(serialized).not.toContain('0912345678');
    expect(serialized).not.toContain('sale@example.com');
    expect(serialized).not.toContain('123456');
    expect(serialized).not.toContain('abc123');
    expect(serialized).toContain('[PHONE_REDACTED]');
    expect(serialized).toContain('[SECRET_REDACTED]');
  });

  it('does not serialize binary values inside arrays', () => {
    expect(
      sanitizeLearningResponse([
        { id: 'safe' },
        Buffer.from('encrypted'),
        new Uint8Array([1]),
      ]),
    ).toEqual([{ id: 'safe' }]);
  });
});
