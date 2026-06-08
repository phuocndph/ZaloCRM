/**
 * security-headers.ts — Phase 3 (Bảo mật xác thực 2026-06-08)
 *
 * Đặt security headers cho mọi response (onSend hook):
 *   - Content-Security-Policy: script-src 'self' (diệt XSS tại gốc — 5A).
 *     style-src 'unsafe-inline' tạm cho Vuetify (siết sau). Mặc định REPORT-ONLY
 *     (config.cspMode) -> browser log vi phạm nhưng KHÔNG chặn, rollout an toàn.
 *   - HSTS (chỉ prod/HTTPS), X-Content-Type-Options, X-Frame-Options,
 *     Referrer-Policy, X-Permitted-Cross-Domain-Policies.
 *
 *   connect-src gồm ws:/wss: cho Socket.IO; img/font/media nới cho avatar Zalo,
 *   data:/blob: (attachment preview).
 */
import type { FastifyInstance } from 'fastify';
import { config } from '../../config/index.js';

// Một dòng CSP — script-src 'self' là điểm mấu chốt chống XSS.
const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // Vuetify inject runtime style — siết bằng nonce/hash sau
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "media-src 'self' blob: https:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook('onSend', async (_request, reply, payload) => {
    if (config.cspMode !== 'off') {
      const header =
        config.cspMode === 'enforce'
          ? 'Content-Security-Policy'
          : 'Content-Security-Policy-Report-Only';
      reply.header(header, CSP_DIRECTIVES);
    }

    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('X-Permitted-Cross-Domain-Policies', 'none');

    // HSTS chỉ có ý nghĩa qua HTTPS — bật ở production.
    if (config.isProduction) {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    return payload;
  });
}
