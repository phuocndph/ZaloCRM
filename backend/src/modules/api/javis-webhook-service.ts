// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/** Durable, signed delivery of inbound Zalo messages to Javis. */
import crypto from 'node:crypto';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { assertSafeOutboundUrl, SsrfBlockedError } from '../../shared/utils/ssrf-guard.js';
import { runSystemQuery, withTenant } from '../../shared/tenant/tenant-context.js';

const DELIVERY_EVENT = 'message.received';
const RETRY_DELAYS_MS = [10_000, 60_000, 300_000] as const;
const MAX_ATTEMPTS = 1 + RETRY_DELAYS_MS.length;
const DELIVERY_TIMEOUT_MS = 10_000;
let workerTimer: ReturnType<typeof setInterval> | null = null;
let workerRunning = false;

export interface JavisMessageReceivedData {
  messageId: string;
  conversationId: string;
  zaloAccountId: string;
  zaloAccountName: string;
  threadType: 'user' | 'group';
  senderType: 'contact';
  senderId: string;
  senderName: string;
  content: string;
  attachments: Array<{ type: string; url: string; name: string }>;
  sentAt: string;
}

export function normalizeJavisAttachments(value: unknown): JavisMessageReceivedData['attachments'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const type = typeof row.type === 'string' ? row.type : 'file';
    const url = [row.url, row.href, row.fileUrl, row.normalUrl, row.hdUrl]
      .find((v): v is string => typeof v === 'string' && /^https?:\/\//i.test(v));
    if (!url) return [];
    return [{ type, url, name: typeof row.name === 'string' ? row.name : '' }];
  });
}

function getSetting(orgId: string, settingKey: string) {
  return runSystemQuery(() => prisma.appSetting.findFirst({ where: { orgId, settingKey }, select: { valuePlain: true } }));
}

function safeJavisUrl(value: string): URL | null {
  try { return assertSafeOutboundUrl(value); }
  catch (err) {
    if (err instanceof SsrfBlockedError) logger.warn(`[javis-webhook] blocked URL: ${err.message}`);
    else logger.warn('[javis-webhook] invalid URL');
    return null;
  }
}

async function deliverDelivery(deliveryId: string): Promise<void> {
  const delivery = await runSystemQuery(() => prisma.javisWebhookDelivery.findUnique({ where: { id: deliveryId } }));
  if (!delivery || delivery.status === 'delivered' || delivery.status === 'failed') return;
  const claimed = await runSystemQuery(() => prisma.javisWebhookDelivery.updateMany({
    where: { id: deliveryId, status: 'pending' },
    data: { status: 'processing' },
  }));
  if (!claimed.count) return;

  await withTenant(delivery.orgId, async () => {
    const [urlSetting, secretSetting] = await Promise.all([getSetting(delivery.orgId, 'javis_webhook_url'), getSetting(delivery.orgId, 'javis_webhook_secret')]);
    const url = safeJavisUrl(urlSetting?.valuePlain ?? '');
    const secret = secretSetting?.valuePlain ?? '';
    if (!url || !secret) {
      await prisma.javisWebhookDelivery.update({ where: { id: deliveryId }, data: { status: 'failed', lastError: !url ? 'Webhook URL chưa hợp lệ' : 'Thiếu webhook secret' } });
      return;
    }
    const rawBody = JSON.stringify(delivery.rawBody);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    try {
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-ZCRM-Signature': signature, 'X-ZCRM-Timestamp': timestamp },
        body: rawBody,
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await prisma.javisWebhookDelivery.update({ where: { id: deliveryId }, data: { status: 'delivered', attempts: { increment: 1 }, deliveredAt: new Date(), lastError: null } });
    } catch (err) {
      const attempts = delivery.attempts + 1;
      const retryIndex = attempts - 1;
      const willRetry = retryIndex < RETRY_DELAYS_MS.length;
      await prisma.javisWebhookDelivery.update({ where: { id: deliveryId }, data: willRetry
        ? { status: 'pending', attempts, nextAttemptAt: new Date(Date.now() + RETRY_DELAYS_MS[retryIndex]), lastError: String((err as Error).message).slice(0, 500) }
        : { status: 'failed', attempts, lastError: String((err as Error).message).slice(0, 500) } });
      logger.warn(`[javis-webhook] delivery ${deliveryId} failed (attempt ${attempts}/${MAX_ATTEMPTS})`, err);
    }
  });
}

export async function emitJavisMessageReceived(orgId: string, data: JavisMessageReceivedData): Promise<void> {
  const setting = await getSetting(orgId, 'javis_webhook_url');
  if (!setting?.valuePlain) return;
  const payload = { type: DELIVERY_EVENT, data };
  try {
    const delivery = await runSystemQuery(() => prisma.javisWebhookDelivery.create({ data: {
      orgId, eventType: DELIVERY_EVENT, messageId: data.messageId, rawBody: payload, targetUrl: setting.valuePlain!,
    } }));
    void deliverDelivery(delivery.id).catch((err) => logger.warn('[javis-webhook] first delivery failed:', err));
  } catch (err: any) {
    if (err?.code === 'P2002') {
      logger.info(`[javis-webhook] duplicate message ignored: ${data.messageId}`);
      return;
    }
    logger.error('[javis-webhook] queue failed:', err);
  }
}

export async function processDueJavisDeliveries(limit = 25): Promise<number> {
  const rows = await runSystemQuery(() => prisma.javisWebhookDelivery.findMany({
    where: { OR: [
      { status: 'pending', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] },
      { status: 'processing', updatedAt: { lt: new Date(Date.now() - 60_000) } },
    ] }, orderBy: { createdAt: 'asc' }, take: limit, select: { id: true },
  }));
  await Promise.all(rows.map(async (row) => {
    // A process that died while sending leaves a stale processing row; release it once.
    await runSystemQuery(() => prisma.javisWebhookDelivery.updateMany({
      where: { id: row.id, status: 'processing', updatedAt: { lt: new Date(Date.now() - 60_000) } },
      data: { status: 'pending' },
    }));
    return deliverDelivery(row.id).catch((err) => logger.warn('[javis-webhook] worker delivery failed:', err));
  }));
  return rows.length;
}

export function startJavisWebhookWorker(): void {
  if (workerTimer) return;
  workerTimer = setInterval(() => {
    if (workerRunning) return;
    workerRunning = true;
    void processDueJavisDeliveries().finally(() => { workerRunning = false; });
  }, 15_000);
  void processDueJavisDeliveries();
  logger.info('[javis-webhook] worker started');
}

export function stopJavisWebhookWorker(): void {
  if (workerTimer) clearInterval(workerTimer);
  workerTimer = null;
}
