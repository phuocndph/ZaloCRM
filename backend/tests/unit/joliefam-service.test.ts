// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => {
  const methods = ['findFirst','findUnique','findMany','create','update','updateMany','upsert','deleteMany','count'];
  const db: any = Object.fromEntries(['contact','user','joliefamConnection','joliefamDraft','joliefamCustomerLink','joliefamSnapshot','joliefamAudit','mediaAsset'].map(name => [name, Object.fromEntries(methods.map(key => [key, vi.fn()]))])); db.$executeRaw = vi.fn();
  return { db, visible: vi.fn(), client: Object.fromEntries(['lookup','submit','quote','customer','summary','order','orders','capabilities'].map(key => [key, vi.fn()])), row: null as any };
});
vi.mock('../../src/shared/database/prisma-client.js', () => ({ prisma: m.db, tenantTransaction: (fn: any) => fn(m.db) }));
vi.mock('../../src/modules/contacts/contact-scope.js', () => ({ assertContactVisible: m.visible }));
vi.mock('../../src/modules/integrations/_shared/token-encryption.util.js', () => ({ encryptToken: (s: string) => `encrypted:${s}`, decryptToken: () => 'server-key', getTokenEncryptionKeyReadiness: () => ({ ready: true }) }));
vi.mock('../../src/modules/joliefam/commerce-client.js', () => ({ JoliefamClient: class { constructor() { Object.assign(this, m.client); } } }));
import * as service from '../../src/modules/joliefam/commerce-service.js';
import { CommerceError, parseDraft, fingerprint } from '../../src/modules/joliefam/commerce-domain.js';
const actor = { orgId: 'org-a', userId: 'user-a', role: 'sale' };
const crmOrder = () => ({ id: 'crm-order', customerId: 'hotel-a', code: 'JF001', version: 1, updatedAt: new Date().toISOString(), currency: 'VND', approval: {code:'pending_approval',label:'Chờ duyệt'}, processing:{code:'pending',label:'Chờ'}, payment:{code:'unpaid',label:'Chưa thu'}, delivery:{code:'pending',label:'Chưa giao'}, total:200000, lines:[], amounts:{subtotal:200000,discount:0,shipping:0,tax:0,deposit:0,collected:0,refunded:0,due:200000}, payments:[],production:[],shipments:[],returns:[] });
const input = () => parseDraft({ customerId: 'hotel-a', orderedBy: 'A', recipient: { name: 'B', phone: '0901234567', address: 'C' }, lines: [{ productId: 'p', name: 'Ga', kind: 'stock', quantity: 2, unit: 'cái', proposedPrice: 100000, specifications: {}, attachments: [] }] });
beforeEach(() => {
  vi.clearAllMocks(); m.visible.mockResolvedValue(true); m.db.contact.findFirst.mockResolvedValue({ id: 'contact-a', fullName: 'Khách' });
  m.db.joliefamConnection.findUnique.mockResolvedValue({ orgId: 'org-a', enabled: true, tokenEncrypted: 'encrypted:key', webhookSecretEncrypted: 'encrypted:secret', basePath: '/api/zcrm/v1', actorMap: { 'user-a': 'crm-user' }, testedAt: new Date() });
  m.db.joliefamCustomerLink.findFirst.mockResolvedValue({ id: 'link', customerId: 'hotel-a' });
  const draft = input(); m.row = { id: 'draft-a', contactId: 'contact-a', orgId: 'org-a', customerId: 'hotel-a', revision: 1, status: 'local', requestKey: null, crmOrderId: null, lockedAt: null, input: draft, quote: { token: 'quote', fingerprint: fingerprint(draft), expiresAt: new Date(Date.now() + 60000).toISOString(), subtotal: 200000, discount: 0, shipping: 0, tax: 0, total: 200000, currency: 'VND', lines: [{ productId: 'p', quantity: 2, unitPrice: 100000, total: 200000 }], warnings: [] } };
  m.db.joliefamDraft.findFirst.mockImplementation(async ({ where }: any) => where.id === m.row?.id && where.orgId === m.row.orgId && (!where.contactId || where.contactId === m.row.contactId) ? structuredClone(m.row) : null);
  m.db.joliefamDraft.updateMany.mockImplementation(async ({ where, data }: any) => {
    if (where.id !== m.row.id || where.orgId !== m.row.orgId || (where.revision && where.revision !== m.row.revision) || (where.requestKey && where.requestKey !== m.row.requestKey) || (typeof where.status === 'string' && where.status !== m.row.status) || (where.status?.in && !where.status.in.includes(m.row.status)) || ('lockedAt' in where && String(where.lockedAt) !== String(m.row.lockedAt))) return { count: 0 };
    m.row = { ...m.row, ...data, revision: data.revision?.increment ? m.row.revision + data.revision.increment : m.row.revision }; return { count: 1 };
  });
  m.db.joliefamAudit.create.mockResolvedValue({ id: 'audit' });
  m.db.joliefamSnapshot.findUnique.mockResolvedValue(null); m.db.joliefamSnapshot.upsert.mockImplementation(async ({ create }: any) => ({ ...create, fetchedAt: new Date() }));
});
describe('Commerce service authorization, state and delivery', () => {
  it('does not disclose cached purchases for a contact outside scope', async () => { m.visible.mockResolvedValue(false); await expect(service.readPurchase(actor, 'contact-a', 'hotel-a', 'overview')).rejects.toMatchObject({ statusCode: 404 }); expect(m.db.joliefamSnapshot.findUnique).not.toHaveBeenCalled(); });
  it('requires a confirmed link even when the user knows a valid customer id', async () => { m.db.joliefamCustomerLink.findFirst.mockResolvedValue(null); await expect(service.readPurchase(actor, 'contact-a', 'foreign', 'order', { id: 'known-order' })).rejects.toMatchObject({ code: 'CUSTOMER_NOT_LINKED' }); });
  it('returns a dated saved snapshot when CRM is disconnected', async () => { const fetchedAt = new Date('2026-10-01'); m.db.joliefamSnapshot.findUnique.mockResolvedValue({ data: { customer: { name: 'Hotel' } }, fetchedAt }); m.db.joliefamConnection.findUnique.mockResolvedValue({ enabled: false, tokenEncrypted: 'k', basePath: '/api/zcrm/v1' }); expect(await service.readPurchase(actor, 'contact-a', 'hotel-a', 'overview', {}, true)).toMatchObject({ stale: true, updatedAt: fetchedAt }); });
  it('retains cached data and reports a refresh failure without claiming it is fresh', async () => { m.db.joliefamSnapshot.findUnique.mockResolvedValue({ data: { kept: true }, fetchedAt: new Date() }); m.client.customer.mockRejectedValue(new CommerceError('Mất kết nối', 502)); const result = await service.readPurchase(actor, 'contact-a', 'hotel-a', 'overview', {}, true); expect(result).toMatchObject({ data: { kept: true }, stale: true, error: 'Mất kết nối' }); });
  it('keeps submitted drafts locked against edits', async () => { m.row.status = 'submitted'; await expect(service.saveDraft(actor, 'contact-a', { input: input(), revision: 1 }, 'draft-a')).rejects.toMatchObject({ code: 'DRAFT_LOCKED' }); });
  it('blocks a stale draft revision', async () => { await expect(service.saveDraft(actor, 'contact-a', { input: input(), revision: 10 }, 'draft-a')).rejects.toMatchObject({ code: 'DRAFT_CONFLICT' }); });
  it('submits only after confirming the current CRM quote and records the actual actor', async () => { m.client.submit.mockResolvedValue({ order: crmOrder(), approver: 'Quản lý' }); const result = await service.submitDraft(actor, 'contact-a', 'draft-a', { revision: 1, quoteToken: 'quote', confirmed: true }); expect(result).toMatchObject({ status: 'submitted', crmOrderId: 'crm-order' }); expect(m.client.submit).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'zcrm:org-a:draft-a:1', 'crm-user', null, []); });
  it('requires matching actor mapping before sending', async () => { m.db.joliefamConnection.findUnique.mockResolvedValue({ enabled: true, actorMap: {}, tokenEncrypted: 'key', basePath: '/api/zcrm/v1' }); await expect(service.submitDraft(actor, 'contact-a', 'draft-a', { revision: 1, quoteToken: 'quote', confirmed: true })).rejects.toMatchObject({ code: 'CRM_ACTOR_MISSING' }); expect(m.client.submit).not.toHaveBeenCalled(); });
  it('makes two simultaneous submit clicks create just one outgoing request', async () => { m.client.submit.mockResolvedValue({ order: crmOrder() }); await Promise.all([service.submitDraft(actor, 'contact-a', 'draft-a', { revision: 1, quoteToken: 'quote', confirmed: true }), service.submitDraft(actor, 'contact-a', 'draft-a', { revision: 1, quoteToken: 'quote', confirmed: true })]); expect(m.client.submit).toHaveBeenCalledTimes(1); });
  it('retains an uncertain outcome and checks the same key before any retry', async () => { m.client.submit.mockRejectedValue(new CommerceError('Timeout', 502, 'CRM_UNAVAILABLE')); const result = await service.submitDraft(actor, 'contact-a', 'draft-a', { revision: 1, quoteToken: 'quote', confirmed: true }); expect(result?.status).toBe('uncertain'); expect(m.row.requestKey).toBe('zcrm:org-a:draft-a:1'); m.client.lookup.mockRejectedValue(new CommerceError('CRM unavailable', 502)); await expect(service.submitDraft(actor, 'contact-a', 'draft-a', { revision: 1, quoteToken: 'quote', confirmed: true })).rejects.toThrow(); expect(m.client.submit).toHaveBeenCalledTimes(1); expect(m.client.lookup).toHaveBeenCalledWith('zcrm:org-a:draft-a:1'); });
  it('retries an absent request with the same key even after its quote expires', async () => {
    m.row.status = 'uncertain'; m.row.requestKey = 'zcrm:org-a:draft-a:1'; m.row.quote.expiresAt = '2000-01-01';
    m.client.lookup.mockResolvedValue({ found: false }); m.client.submit.mockResolvedValue({ order: crmOrder() });
    const result = await service.submitDraft(actor, 'contact-a', 'draft-a', { revision: 1, quoteToken: 'quote', confirmed: true });
    expect(result?.status).toBe('submitted'); expect(m.client.submit.mock.calls[0][2]).toBe('zcrm:org-a:draft-a:1');
  });
  it('returns a CRM request for correction on the same order id', async () => {
    m.row.status = 'submitted'; m.row.requestKey = 'old-key';
    const order = { ...crmOrder(), approval: { code: 'returned', label: 'Bổ sung số đo' } };
    m.client.lookup.mockResolvedValue({ found: true, order }); m.client.order.mockResolvedValue(order);
    const result = await service.checkDraft(actor, 'contact-a', 'draft-a');
    expect(result).toMatchObject({ status: 'returned', crmOrderId: 'crm-order', revision: 2 });
    expect(m.db.joliefamSnapshot.upsert).toHaveBeenCalled();
  });
  it('allows correcting a definitive validation rejection without keeping an old quote', async () => { m.client.submit.mockRejectedValue(new CommerceError('Thiếu số đo', 422, 'CRM_VALIDATION')); const result = await service.submitDraft(actor, 'contact-a', 'draft-a', { revision: 1, quoteToken: 'quote', confirmed: true }); expect(result).toMatchObject({ status: 'local', revision: 2, requestKey: null }); });
  it('cannot send with a quote for changed contents', async () => { m.row.input.notes = 'new note'; await expect(service.submitDraft(actor, 'contact-a', 'draft-a', { revision: 1, quoteToken: 'quote', confirmed: true })).rejects.toMatchObject({ code: 'QUOTE_EXPIRED' }); expect(m.client.submit).not.toHaveBeenCalled(); });
  it('preserves newer CRM revisions against old webhook/request results', async () => { m.db.joliefamSnapshot.findUnique.mockResolvedValue({ sourceVersion: 9n, data: { newest: true } }); const result = await service.storeSnapshot('org-a', 'hotel-a', 'order:1', { old: true }, 8); expect(result.data).toEqual({ newest: true }); expect(m.db.joliefamSnapshot.upsert).not.toHaveBeenCalled(); });
  it('returns only presence flags for stored secrets', async () => { const result = await service.getSettings(actor); expect(result.hasToken).toBe(true); expect(result).not.toHaveProperty('tokenEncrypted'); expect(JSON.stringify(result)).not.toContain('encrypted:'); });
  it('requires re-testing changed credentials before enabling', async () => { await expect(service.saveSettings(actor, { enabled: true, token: 'replacement', actorMap: {} })).rejects.toMatchObject({ code: 'CRM_TEST_REQUIRED' }); });
});
