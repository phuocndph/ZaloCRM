/**
 * zinstant-proxy-routes.ts — Proxy Zalo zinstant HTML (bank QR cards, ...)
 *
 * Zalo CDN zinst-stc.zadn.vn trả Content-Type: application/octet-stream → browser
 * tải file thay vì render trong iframe. Proxy này fetch server-side, đổi
 * Content-Type sang text/html → iframe render OK.
 *
 * Security: whitelist chặt hostname, không cho phép arbitrary URL (chống SSRF).
 * Public endpoint (không auth) vì iframe không pass JWT header dễ — content
 * chỉ public Zalo CDN, không lộ data CRM.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../../shared/utils/logger.js';

const ALLOWED_HOSTS = new Set([
  'zinst-stc.zadn.vn',
  'zinst-stc-pc.zadn.vn',
]);

export async function zinstantProxyRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/v1/zalo-bankcard?url=<encoded zalo cdn url>
  // Public endpoint (no auth) — chỉ proxy public Zalo CDN
  app.get('/api/v1/zalo-bankcard', async (request: FastifyRequest, reply: FastifyReply) => {
    const { url } = request.query as { url?: string };
    if (!url) return reply.status(400).send({ error: 'url query required' });

    let parsed: URL;
    try { parsed = new URL(url); } catch { return reply.status(400).send({ error: 'invalid url' }); }
    if (!ALLOWED_HOSTS.has(parsed.hostname)) {
      return reply.status(403).send({ error: 'host not allowed' });
    }

    try {
      const res = await fetch(parsed.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ZaloCRM/1.0)',
        },
        // 8s timeout — Zalo CDN thường rất nhanh
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        return reply.status(res.status).send({ error: 'upstream error', upstream: res.statusText });
      }

      const body = await res.text();
      // Override Content-Type → text/html để iframe render thay vì tải xuống
      reply
        .header('Content-Type', 'text/html; charset=utf-8')
        // Cache 1h — bank card content không đổi theo time, thường cache được
        .header('Cache-Control', 'public, max-age=3600')
        // Cho phép embed iframe từ chính domain CRM
        .header('X-Frame-Options', 'SAMEORIGIN')
        .send(body);
    } catch (err) {
      logger.warn('[zinstant-proxy] fetch error:', err);
      return reply.status(502).send({ error: 'upstream fetch failed' });
    }
  });
}
