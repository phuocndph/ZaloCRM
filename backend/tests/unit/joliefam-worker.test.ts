// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ db: {
  joliefamConnection: { updateMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  joliefamEvent: { findMany: vi.fn(), update: vi.fn() },
  joliefamDraft: { findMany: vi.fn() }, joliefamSnapshot: { findMany: vi.fn(), deleteMany: vi.fn() }, joliefamCustomerLink: { count: vi.fn() },
}, customer: vi.fn(), summary: vi.fn(), order: vi.fn(), store: vi.fn(), reconcile: vi.fn() }));
vi.mock('../../src/shared/database/prisma-client.js', () => ({ prisma: m.db }));
vi.mock('../../src/modules/joliefam/commerce-service.js', () => ({ reconcileDraft: m.reconcile, storeSnapshot: m.store }));
vi.mock('../../src/modules/integrations/_shared/token-encryption.util.js', () => ({ decryptToken: () => 'server-secret' }));
vi.mock('../../src/modules/joliefam/commerce-client.js', () => ({ JoliefamClient: class { customer = m.customer; summary = m.summary; order = m.order; } }));
import { tickOrganization } from '../../src/modules/joliefam/commerce-worker.js';
beforeEach(() => { vi.clearAllMocks(); m.db.joliefamConnection.updateMany.mockResolvedValue({ count: 1 }); m.db.joliefamConnection.findUnique.mockResolvedValue({ enabled: true, tokenEncrypted: 'encrypted', basePath: '/api/zcrm/v1' }); m.db.joliefamCustomerLink.count.mockResolvedValue(1); m.db.joliefamEvent.findMany.mockResolvedValue([]); m.db.joliefamDraft.findMany.mockResolvedValue([]); m.db.joliefamSnapshot.findMany.mockResolvedValue([]); m.customer.mockResolvedValue({ id: 'hotel' }); m.summary.mockResolvedValue({ activeOrderCount: 1 }); });
describe('Commerce reconciliation resilience', () => {
  it('respects the distributed lease instead of doing duplicate background work', async () => { m.db.joliefamConnection.updateMany.mockResolvedValue({ count: 0 }); await tickOrganization('org-a'); expect(m.db.joliefamEvent.findMany).not.toHaveBeenCalled(); });
  it('keeps an unavailable draft from blocking the next draft/customer', async () => { m.db.joliefamDraft.findMany.mockResolvedValue([{ id: 'bad', customerId: 'h1', status: 'submitted' }, { id: 'good', customerId: 'h2', status: 'submitted' }]); m.reconcile.mockImplementation(async (_org, id) => { if (id === 'bad') throw new Error('temporary'); }); await tickOrganization('org-a'); expect(m.reconcile).toHaveBeenCalledWith('org-a', 'good'); expect(m.customer).toHaveBeenCalledWith('h2'); expect(m.db.joliefamConnection.update).toHaveBeenCalledWith(expect.objectContaining({ where: { orgId: 'org-a' }, data: { lastError: expect.any(String) } })); });
  it('continues a later event when one event cannot refresh and leaves failures retryable', async () => { m.db.joliefamEvent.findMany.mockResolvedValue([{ id: 'e1', customerId: 'bad' }, { id: 'e2', customerId: 'good' }]); m.customer.mockImplementation(async id => { if (id === 'bad') throw new Error('down'); return { id }; }); await tickOrganization('org-a'); expect(m.db.joliefamEvent.update).toHaveBeenCalledWith({ where: { id: 'e1', orgId: 'org-a' }, data: { attempts: { increment: 1 } } }); expect(m.db.joliefamEvent.update).toHaveBeenCalledWith({ where: { id: 'e2', orgId: 'org-a' }, data: { status: 'done' } }); expect(m.db.joliefamEvent.findMany.mock.calls[0][0].where).not.toHaveProperty('attempts'); });
  it('reconciles externally created active orders known through the overview', async () => { m.db.joliefamSnapshot.findMany.mockResolvedValue([{ customerId: 'external-hotel', cacheKey: 'overview', data: { summary: { activeOrderCount: 2 } } }]); await tickOrganization('org-a'); expect(m.customer).toHaveBeenCalledWith('external-hotel'); expect(m.db.joliefamSnapshot.deleteMany).not.toHaveBeenCalled(); });
});
