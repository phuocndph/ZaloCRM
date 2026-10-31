// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { withTenant } from '../../shared/tenant/tenant-context.js';
import { verifyHmacRequest } from '../../shared/security/hmac.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireGrant } from '../rbac/rbac-middleware.js';
import type { Resource, Action } from '../rbac/permission-types.js';
import { decryptToken } from '../integrations/_shared/token-encryption.util.js';
import { getObjectBuffer } from '../../shared/storage/minio-client.js';
import { CommerceError, identifier, integer, object, text, type Actor } from './commerce-domain.js';
import * as service from './commerce-service.js';
import { installCommerceWorker, processEvent } from './commerce-worker.js';

const actor = (r: FastifyRequest): Actor => ({ orgId: r.user!.orgId, userId: r.user!.id, role: r.user!.role });
const filters = (r: FastifyRequest) => {
  const q = (r.query ?? {}) as Record<string, unknown>, result: Record<string, string> = {};
  for (const key of ['q', 'cursor', 'status', 'from', 'to']) if (q[key]) result[key] = text(q[key], key === 'cursor' ? 500 : 200);
  for (const key of ['from', 'to']) if (result[key] && (!/^\d{4}-\d{2}-\d{2}$/.test(result[key]) || !Number.isFinite(Date.parse(result[key])) || new Date(result[key]).toISOString().slice(0, 10) !== result[key])) throw new CommerceError('Ngày lọc chưa hợp lệ.');
  if (result.from && result.to && result.from > result.to) throw new CommerceError('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.');
  return result;
};
export async function commerceRoutes(app: FastifyInstance) {
  const route = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, resource: Resource, action: Action, handler: (r: FastifyRequest, p: Record<string, string>) => Promise<unknown>) => {
    app.route({ method, url: '/api/v1/joliefam' + path, preHandler: [authMiddleware, requireGrant(resource, action)], bodyLimit: 256000,
      config: { rateLimit: { max: method === 'GET' ? 120 : 30, timeWindow: '1 minute' } },
      handler: async (r, reply) => { try { return await handler(r, r.params as Record<string, string>); } catch (e) { if (e instanceof CommerceError) return reply.code(e.statusCode).send({ error: e.message, code: e.code }); return reply.code(502).send({ error: 'Chưa hoàn thành được thao tác mua hàng. Vui lòng thử lại.', code: 'COMMERCE_UNAVAILABLE' }); } },
    });
  };
  route('GET', '/settings', 'commerce_connection', 'access', r => service.getSettings(actor(r)));
  route('PUT', '/settings', 'commerce_connection', 'edit', r => service.saveSettings(actor(r), r.body));
  route('POST', '/settings/test', 'commerce_connection', 'edit', r => service.testConnection(actor(r)));
  route('GET', '/contacts/:contactId/links', 'commerce', 'access', (r, p) => service.links(actor(r), p.contactId));
  route('GET', '/contacts/:contactId/search', 'commerce_link', 'access', (r, p) => { const f = filters(r); return service.searchCustomers(actor(r), p.contactId, f.q ?? '', f.cursor ?? ''); });
  route('POST', '/contacts/:contactId/links', 'commerce_link', 'edit', (r, p) => service.linkCustomer(actor(r), p.contactId, r.body));
  route('DELETE', '/contacts/:contactId/links/:customerId', 'commerce_link', 'edit', (r, p) => service.unlinkCustomer(actor(r), p.contactId, p.customerId));
  route('POST', '/contacts/:contactId/customers', 'commerce_link', 'edit', (r, p) => service.createCustomer(actor(r), p.contactId, r.body));
  route('GET', '/contacts/:contactId/profile', 'contact', 'access', (r, p) => service.contactProfile(actor(r), p.contactId));
  for (const kind of ['overview', 'orders', 'order'] as const) {
    const suffix = kind === 'order' ? '/orders/:orderId' : `/${kind}`;
    route('GET', '/contacts/:contactId/customers/:customerId' + suffix, 'commerce', 'access', (r, p) => service.readPurchase(actor(r), p.contactId, p.customerId, kind, { ...filters(r), ...(p.orderId ? { id: p.orderId } : {}) }, (r.query as any)?.refresh === 'true'));
  }
  route('GET', '/contacts/:contactId/products', 'commerce_draft', 'access', (r, p) => { const f = filters(r); return service.products(actor(r), p.contactId, f.q ?? '', f.cursor ?? ''); });
  route('GET', '/contacts/:contactId/drafts', 'commerce_draft', 'access', (r, p) => service.listDrafts(actor(r), p.contactId, filters(r).cursor));
  route('POST', '/contacts/:contactId/drafts', 'commerce_draft', 'create', (r, p) => service.saveDraft(actor(r), p.contactId, r.body));
  route('PUT', '/contacts/:contactId/drafts/:id', 'commerce_draft', 'edit', (r, p) => service.saveDraft(actor(r), p.contactId, r.body, p.id));
  route('POST', '/contacts/:contactId/drafts/:id/quote', 'commerce_draft', 'edit', (r, p) => service.quoteDraft(actor(r), p.contactId, p.id, integer(object(r.body).revision)));
  route('POST', '/contacts/:contactId/drafts/:id/submit', 'commerce_draft', 'approve', (r, p) => service.submitDraft(actor(r), p.contactId, p.id, r.body));
  route('POST', '/contacts/:contactId/drafts/:id/check', 'commerce_draft', 'access', (r, p) => service.checkDraft(actor(r), p.contactId, p.id));

  // An encapsulated parser preserves exact signed bytes without changing other APIs.
  await app.register(async webhook => {
    webhook.removeContentTypeParser('application/json');
    webhook.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 32000 }, (_r, body, done) => done(null, body));
    webhook.post('/api/v1/joliefam/webhook/:orgId', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (r, reply) => {
      try {
        const orgId = identifier((r.params as any).orgId);
        return await withTenant(orgId, async () => {
          const c = await prisma.joliefamConnection.findUnique({ where: { orgId } });
          if (!c?.enabled) return reply.code(401).send({ error: 'Unauthorized' });
          const rawBody = r.body as string;
          const checked = verifyHmacRequest({ rawBody, timestamp: r.headers['x-crm-timestamp'] as string, nonce: r.headers['x-crm-event-id'] as string, signature: r.headers['x-crm-signature'] as string, secret: decryptToken(c.webhookSecretEncrypted) });
          if (!checked.valid) return reply.code(401).send({ error: 'Unauthorized' });
          const event = object(JSON.parse(rawBody)); const eventId = identifier(checked.nonce), customerId = identifier(event.customerId), version = integer(event.version);
          const orderId = event.orderId ? identifier(event.orderId) : null;
          await prisma.joliefamEvent.upsert({ where: { orgId_eventId: { orgId, eventId } }, create: { orgId, eventId, customerId, orderId, version }, update: {} });
          // Durable receipt first; failure remains pending for the periodic worker.
          setImmediate(() => { void processEvent(orgId, eventId).catch(() => {}); });
          return reply.code(202).send({ accepted: true });
        });
      } catch { return reply.code(400).send({ error: 'Invalid CRM event' }); }
    });
  });

  // CRM fetches explicitly attached assets with the same server-only API token.
  app.get('/api/v1/joliefam/transfer/:orgId/:draftId/:mediaId', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (r, reply) => {
    const p = r.params as Record<string, string>;
    return withTenant(p.orgId, async () => {
      try {
        const c = await prisma.joliefamConnection.findUnique({ where: { orgId: p.orgId } });
        if (!c?.enabled) return reply.code(401).send();
        const provided = String(r.headers.authorization ?? '').replace(/^Bearer /, '');
        const hash = (s: string) => createHash('sha256').update(s).digest();
        if (!timingSafeEqual(hash(provided), hash(decryptToken(c.tokenEncrypted)))) return reply.code(401).send();
        const draft = await prisma.joliefamDraft.findFirst({ where: { orgId: p.orgId, id: p.draftId, status: { in: ['submitting', 'submitted', 'uncertain'] } } });
        const lines = (draft?.input as any)?.lines ?? [];
        if (!lines.some((l: any) => l.attachments?.some((f: any) => f.mediaId === p.mediaId))) return reply.code(404).send();
        const asset = await prisma.mediaAsset.findFirst({ where: { id: p.mediaId, orgId: p.orgId, archivedAt: null, sourceIsPrivateNick: false }, include: { blobs: { where: { variantType: 'original' }, take: 1 } } });
        const blob = asset?.blobs[0]; if (!blob || blob.sizeBytes > 15 * 1024 * 1024) return reply.code(404).send();
        reply.header('Cache-Control', 'no-store').header('Content-Disposition', 'attachment').type(blob.mimeType);
        return reply.send(await getObjectBuffer(blob.minioKey));
      } catch { return reply.code(404).send(); }
    });
  });
  if (process.env.NODE_ENV !== 'test') installCommerceWorker(app);
}
