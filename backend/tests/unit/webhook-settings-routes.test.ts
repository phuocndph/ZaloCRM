// SPDX-License-Identifier: AGPL-3.0-or-later
import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ store: new Map<string, string>(), emit: vi.fn() }));
vi.mock('../../src/shared/database/prisma-client.js', () => ({
  prisma: {
    appSetting: {
      findFirst: vi.fn(async ({ where }: any) => {
        const v = m.store.get(`${where.orgId}:${where.settingKey}`);
        return v === undefined ? null : { valuePlain: v };
      }),
      upsert: vi.fn(async ({ where, create }: any) => {
        const k = where.orgId_settingKey;
        m.store.set(`${k.orgId}:${k.settingKey}`, create.valuePlain);
        return {};
      }),
    },
  },
}));
vi.mock('../../src/modules/api/webhook-service.js', () => ({ emitWebhook: m.emit }));
vi.mock('../../src/modules/auth/auth-middleware.js', () => ({ authMiddleware: async (r: any) => { r.user = { id: 'u', orgId: 'org-a', role: 'owner' }; } }));
vi.mock('../../src/modules/rbac/rbac-middleware.js', () => ({ requireGrant: () => async () => {} }));
import { webhookSettingsRoutes } from '../../src/modules/api/webhook-settings-routes.js';

async function app() { const a = Fastify(); await a.register(webhookSettingsRoutes); return a; }
const URL_ = 'https://hooks.example.com/zcrm';
const SECRET = 'abcdef0123456789';

beforeEach(() => { m.store.clear(); m.emit.mockReset(); });

describe('webhook settings', () => {
  it('saves the field names the settings page sends (webhookUrl/webhookSecret)', async () => {
    const a = await app();
    await a.inject({ method: 'PUT', url: '/api/v1/settings/webhook', payload: { webhookUrl: URL_, webhookSecret: SECRET } });
    expect(m.store.get('org-a:webhook_url')).toBe(URL_);
    expect(m.store.get('org-a:webhook_secret')).toBe(SECRET);
    const got = (await a.inject({ url: '/api/v1/settings/webhook' })).json();
    expect(got.webhookUrl).toBe(URL_);
    expect(got.url).toBe(URL_);
    expect(got.webhookSecret).toBe(`${'*'.repeat(SECRET.length - 4)}6789`);
    await a.close();
  });

  it('still accepts the older url/secret names', async () => {
    const a = await app();
    await a.inject({ method: 'PUT', url: '/api/v1/settings/webhook', payload: { url: URL_, secret: SECRET } });
    expect(m.store.get('org-a:webhook_url')).toBe(URL_);
    expect(m.store.get('org-a:webhook_secret')).toBe(SECRET);
    await a.close();
  });

  it('keeps the stored secret when the masked value is sent back unchanged', async () => {
    const a = await app();
    await a.inject({ method: 'PUT', url: '/api/v1/settings/webhook', payload: { webhookUrl: URL_, webhookSecret: SECRET } });
    const masked = (await a.inject({ url: '/api/v1/settings/webhook' })).json().webhookSecret;
    await a.inject({ method: 'PUT', url: '/api/v1/settings/webhook', payload: { webhookUrl: URL_, webhookSecret: masked } });
    expect(m.store.get('org-a:webhook_secret')).toBe(SECRET);
    await a.close();
  });

  it('test endpoint sends the event once a URL was saved from the page', async () => {
    const a = await app();
    expect((await a.inject({ method: 'POST', url: '/api/v1/settings/webhook/test' })).statusCode).toBe(400);
    await a.inject({ method: 'PUT', url: '/api/v1/settings/webhook', payload: { webhookUrl: URL_, webhookSecret: SECRET } });
    const r = await a.inject({ method: 'POST', url: '/api/v1/settings/webhook/test' });
    expect(r.statusCode).toBe(200);
    expect(m.emit).toHaveBeenCalledWith('org-a', 'webhook.test', expect.any(Object));
    await a.close();
  });
});
