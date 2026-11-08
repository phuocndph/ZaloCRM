// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * webhook-settings-routes.ts — Manage webhook URL/secret and public API key generation.
 * All routes require JWT auth and are scoped to user's org.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireGrant } from '../rbac/rbac-middleware.js';
import { logger } from '../../shared/utils/logger.js';
import { emitWebhook } from './webhook-service.js';
import crypto from 'node:crypto';

export async function webhookSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // GET /api/v1/settings/webhook — retrieve current webhook config
  app.get('/api/v1/settings/webhook', { preHandler: requireGrant('webhook', 'access') }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;

      const [urlSetting, secretSetting] = await Promise.all([
        prisma.appSetting.findFirst({ where: { orgId, settingKey: 'webhook_url' } }),
        prisma.appSetting.findFirst({ where: { orgId, settingKey: 'webhook_secret' } }),
      ]);

      const url = urlSetting?.valuePlain || null;
      const secret = secretSetting?.valuePlain ? maskSecret(secretSetting.valuePlain) : null;
      // Both naming styles: the settings page reads webhookUrl/webhookSecret,
      // older API clients read url/secret.
      return { url, secret, webhookUrl: url, webhookSecret: secret };
    } catch (err) {
      logger.error('[webhook-settings] GET error:', err);
      return reply.status(500).send({ error: 'Failed to fetch webhook settings' });
    }
  });

  // PUT /api/v1/settings/webhook — save webhook URL and secret
  app.put('/api/v1/settings/webhook', { preHandler: requireGrant('webhook', 'edit') }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;
      const body = (request.body ?? {}) as {
        url?: string; secret?: string; webhookUrl?: string; webhookSecret?: string;
      };
      // The settings page sends webhookUrl/webhookSecret; reading only url/secret
      // saved an empty URL on every save, so tests failed and no event was sent.
      const url = (body.webhookUrl ?? body.url ?? '').trim();
      const secret = body.webhookSecret ?? body.secret;

      // GET returns the secret masked. When the page sends that masked value
      // back unchanged, keep the stored secret instead of overwriting it.
      let keepSecret = secret === undefined;
      if (!keepSecret && secret && /^\*+.{0,4}$/.test(secret)) {
        const current = await prisma.appSetting.findFirst({ where: { orgId, settingKey: 'webhook_secret' } });
        keepSecret = !!current?.valuePlain && maskSecret(current.valuePlain) === secret;
      }

      await Promise.all([
        upsertSetting(orgId, 'webhook_url', url),
        keepSecret ? Promise.resolve() : upsertSetting(orgId, 'webhook_secret', (secret ?? '').trim()),
      ]);

      return { success: true };
    } catch (err) {
      logger.error('[webhook-settings] PUT error:', err);
      return reply.status(500).send({ error: 'Failed to save webhook settings' });
    }
  });

  // POST /api/v1/settings/webhook/test — deliver a test event to configured URL
  app.post('/api/v1/settings/webhook/test', { preHandler: requireGrant('webhook', 'edit') }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;

      const config = await prisma.appSetting.findFirst({ where: { orgId, settingKey: 'webhook_url' } });
      if (!config?.valuePlain) {
        return reply.status(400).send({ error: 'No webhook URL configured' });
      }

      await emitWebhook(orgId, 'webhook.test', { message: 'Test event from Zalo CRM', orgId });
      return { success: true, sentTo: config.valuePlain };
    } catch (err) {
      logger.error('[webhook-settings] Test error:', err);
      return reply.status(500).send({ error: 'Failed to send test webhook' });
    }
  });

  // POST /api/v1/settings/api-key/generate — generate new public API key
  app.post('/api/v1/settings/api-key/generate', { preHandler: requireGrant('webhook', 'create') }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;

      const newKey = `zcrm_${crypto.randomBytes(24).toString('hex')}`;
      await upsertSetting(orgId, 'public_api_key', newKey);

      return { key: newKey, apiKey: newKey };
    } catch (err) {
      logger.error('[webhook-settings] Generate API key error:', err);
      return reply.status(500).send({ error: 'Failed to generate API key' });
    }
  });

  // GET /api/v1/settings/api-key — retrieve masked API key
  app.get('/api/v1/settings/api-key', { preHandler: requireGrant('webhook', 'access') }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;

      const setting = await prisma.appSetting.findFirst({ where: { orgId, settingKey: 'public_api_key' } });
      if (!setting?.valuePlain) return { key: null, apiKey: null };

      const k = setting.valuePlain;
      // Show prefix + first 8 chars + mask + last 4 chars
      const masked = k.length > 12 ? `${k.slice(0, 12)}${'*'.repeat(k.length - 16)}${k.slice(-4)}` : `${k.slice(0, 4)}****`;
      return { key: masked, apiKey: masked };
    } catch (err) {
      logger.error('[webhook-settings] GET API key error:', err);
      return reply.status(500).send({ error: 'Failed to fetch API key' });
    }
  });
}

// ── Helper ────────────────────────────────────────────────────────────────────

function maskSecret(value: string): string {
  return `${'*'.repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
}

async function upsertSetting(orgId: string, settingKey: string, value: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { orgId_settingKey: { orgId, settingKey } },
    create: { orgId, settingKey, valuePlain: value },
    update: { valuePlain: value },
  });
}
