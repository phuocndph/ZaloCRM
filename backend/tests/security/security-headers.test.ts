/**
 * security-headers.test.ts — Phase 3 (Bảo mật xác thực 2026-06-08)
 * Verify CSP (report-only/enforce/off) + các security header khác.
 */
import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerSecurityHeaders } from '../../src/shared/security/security-headers.js';
import { config } from '../../src/config/index.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerSecurityHeaders(app);
  app.get('/ping', async () => ({ ok: true }));
  await app.ready();
  return app;
}

afterEach(() => {
  config.cspMode = 'report-only';
});

describe('security-headers', () => {
  it('report-only (mặc định): gửi CSP-Report-Only với script-src self', async () => {
    config.cspMode = 'report-only';
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/ping' });
    expect(res.headers['content-security-policy-report-only']).toContain("script-src 'self'");
    expect(res.headers['content-security-policy']).toBeUndefined();
    await app.close();
  });

  it('connect-src GHIM host ws từ APP_URL (không phải ws:/wss: mở toang)', async () => {
    config.cspMode = 'report-only';
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/ping' });
    const csp = res.headers['content-security-policy-report-only'] as string;
    // Test env APP_URL mặc định http://localhost:3000 -> ws://localhost:3000.
    expect(csp).toContain("connect-src 'self' ws://localhost:3000");
    expect(csp).not.toContain('wss: '); // không còn wss/ws mở toang
    await app.close();
  });

  it('enforce: gửi Content-Security-Policy (chặn thật)', async () => {
    config.cspMode = 'enforce';
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/ping' });
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect(res.headers['content-security-policy-report-only']).toBeUndefined();
    await app.close();
  });

  it('off: không gửi CSP header nào', async () => {
    config.cspMode = 'off';
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/ping' });
    expect(res.headers['content-security-policy']).toBeUndefined();
    expect(res.headers['content-security-policy-report-only']).toBeUndefined();
    await app.close();
  });

  it('luôn set nosniff / frame-options / referrer-policy', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/ping' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    await app.close();
  });
});
