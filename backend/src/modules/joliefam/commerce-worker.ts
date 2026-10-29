// SPDX-License-Identifier: AGPL-3.0-or-later
import { prisma } from '../../shared/database/prisma-client.js';
import { runSystemQuery, withTenant } from '../../shared/tenant/tenant-context.js';
import { logger } from '../../shared/utils/logger.js';
import { JoliefamClient } from './commerce-client.js';
import { decryptToken } from '../integrations/_shared/token-encryption.util.js';
import { reconcileDraft, storeSnapshot } from './commerce-service.js';

export async function refreshCustomer(orgId: string, customerId: string) {
  const c = await prisma.joliefamConnection.findUnique({ where: { orgId } }); if (!c?.enabled) return;
  if (!await prisma.joliefamCustomerLink.count({ where: { orgId, customerId } })) return;
  const client = new JoliefamClient(decryptToken(c.tokenEncrypted), c.basePath);
  const startedAt = Date.now();
  await storeSnapshot(orgId, customerId, 'overview', { customer: await client.customer(customerId), summary: await client.summary(customerId) }, startedAt);
  // Preserve filtered page snapshots for outages. Visible pages always revalidate
  // the exact filter on opening and every 60 seconds.
  const cached = await prisma.joliefamSnapshot.findMany({ where: { orgId, customerId, cacheKey: { startsWith: 'order:' } } });
  for (const snapshot of cached) {
    const order = await client.order(customerId, snapshot.cacheKey.slice(6));
    await storeSnapshot(orgId, customerId, snapshot.cacheKey, order, order.version);
  }
}
export async function tickOrganization(orgId: string) {
  await withTenant(orgId, async () => {
    // Distributed lease: only one server reconciles this org at a time.
    const acquired = await prisma.joliefamConnection.updateMany({ where: { orgId, enabled: true, OR: [{ lastSyncAt: null }, { lastSyncAt: { lt: new Date(Date.now() - 280000) } }] }, data: { lastSyncAt: new Date() } });
    if (!acquired.count) return;
    try {
      let failures = 0;
      const events = await prisma.joliefamEvent.findMany({ where: { orgId, status: 'pending' }, orderBy: [{ attempts: 'asc' }, { createdAt: 'asc' }], take: 100 });
      for (const event of events) {
        try {
          await refreshCustomer(orgId, event.customerId);
          await prisma.joliefamEvent.update({ where: { id: event.id, orgId }, data: { status: 'done' } });
        } catch { failures++; await prisma.joliefamEvent.update({ where: { id: event.id, orgId }, data: { attempts: { increment: 1 } } }); }
      }
      // Reconcile every page of pending/submitted drafts; no fixed first-N starvation.
      let cursor: string | undefined;
      const customers = new Set<string>();
      while (true) {
        const batch = await prisma.joliefamDraft.findMany({ where: { orgId, status: { in: ['submitting', 'uncertain', 'submitted'] }, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: 'asc' }, take: 100 });
        for (const d of batch) {
          if (d.status === 'submitting' && d.lockedAt && Date.now() - d.lockedAt.getTime() < 60000) continue;
          try { await reconcileDraft(orgId, d.id); } catch { failures++; }
          if (d.customerId) customers.add(d.customerId);
        }
        if (batch.length < 100) break; cursor = batch[batch.length - 1].id;
      }
      // Include active orders created directly in CRM, not only orders created here.
      const snapshots = await prisma.joliefamSnapshot.findMany({ where: { orgId, OR: [{ cacheKey: { startsWith: 'order:' } }, { cacheKey: 'overview' }] }, select: { customerId: true, cacheKey: true, data: true } });
      for (const s of snapshots) { const o = s.data as any; if (s.cacheKey === 'overview' ? o.summary?.activeOrderCount > 0 : !['completed', 'cancelled'].includes(o.processing?.code)) customers.add(s.customerId); }
      for (const customerId of customers) { try { await refreshCustomer(orgId, customerId); } catch { failures++; } }
      await prisma.joliefamConnection.update({ where: { orgId }, data: { lastError: failures ? 'Một số đơn hoặc cập nhật chưa đối chiếu được; hệ thống tiếp tục kiểm tra ở lượt sau.' : null } });
    } catch { await prisma.joliefamConnection.update({ where: { orgId }, data: { lastError: 'Chưa đối chiếu được dữ liệu. Hệ thống sẽ kiểm tra lại.' } }); }
    // Keep the last successful snapshots available even during a prolonged outage.
  });
}

export async function processEvent(orgId: string, eventId: string) {
  await withTenant(orgId, async () => {
    const event = await prisma.joliefamEvent.findUnique({ where: { orgId_eventId: { orgId, eventId } } });
    if (!event || event.status === 'done') return;
    await refreshCustomer(orgId, event.customerId);
    if (event.orderId && await prisma.joliefamCustomerLink.count({ where: { orgId, customerId: event.customerId } })) {
      const c = await prisma.joliefamConnection.findUnique({ where: { orgId } });
      if (c?.enabled) { const order = await new JoliefamClient(decryptToken(c.tokenEncrypted), c.basePath).order(event.customerId, event.orderId); await storeSnapshot(orgId, event.customerId, `order:${order.id}`, order, order.version); }
    }
    const drafts = await prisma.joliefamDraft.findMany({ where: { orgId, customerId: event.customerId, status: { in: ['submitted', 'uncertain', 'submitting'] } }, select: { id: true } });
    for (const d of drafts) await reconcileDraft(orgId, d.id);
    await prisma.joliefamEvent.update({ where: { id: event.id, orgId }, data: { status: 'done' } });
  });
}
export function installCommerceWorker(app: { addHook: Function }) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return; running = true;
    try {
      const orgs = await runSystemQuery(() => prisma.joliefamConnection.findMany({ where: { enabled: true }, select: { orgId: true } }));
      for (const c of orgs) { try { await tickOrganization(c.orgId); } catch { logger.warn('[joliefam] One organization could not reconcile; continuing the others.'); } }
    } catch { logger.warn('[joliefam] Commerce reconciliation unavailable; retrying next interval.'); }
    finally { running = false; }
  }, 300000);
  timer.unref(); app.addHook('onClose', async () => clearInterval(timer));
}
