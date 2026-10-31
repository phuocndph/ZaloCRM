// SPDX-License-Identifier: AGPL-3.0-or-later
import { orderValid } from './commerce-contract.js';
import { config as appConfig } from '../../config/index.js';
import { Prisma } from '@prisma/client';
import { prisma, tenantTransaction } from '../../shared/database/prisma-client.js';
import { encryptToken, decryptToken, getTokenEncryptionKeyReadiness } from '../integrations/_shared/token-encryption.util.js';
import { assertContactVisible } from '../contacts/contact-scope.js';
import { JoliefamClient } from './commerce-client.js';
import { CommerceError, object, text, identifier, integer, parseDraft, fingerprint, validateSubmission, validateQuote, type Actor, type DraftInput, type Quote, type Order } from './commerce-domain.js';

const json = (value: unknown) => value as Prisma.InputJsonValue;
export const audit = (a: Actor, action: string, entityId: string, detail: unknown = {}) => prisma.joliefamAudit.create({ data: { orgId: a.orgId, actorId: a.userId, action, entityId, detail: json(detail) } });
export async function assertContact(a: Actor, id: string) {
  const c = await prisma.contact.findFirst({ where: { id, orgId: a.orgId, mergedInto: null }, select: { id: true, fullName: true, crmName: true, phone: true, email: true, addressLine: true, occupation: true, avatarUrl: true, phone2: true, phone3: true, phonesExtra: true } });
  if (!c || !await assertContactVisible({ ...a, legacyRole: a.role, contactId: id })) throw new CommerceError('Không tìm thấy khách hoặc anh chưa được quyền xem.', 404, 'CONTACT_NOT_FOUND');
  return c;
}
async function connection(orgId: string, allowDisabled = false) {
  const c = await prisma.joliefamConnection.findUnique({ where: { orgId } });
  if (!c || (!c.enabled && !allowDisabled)) throw new CommerceError('Chưa bật kết nối CRM Joliefam. Vẫn có thể lưu đơn nháp trong ZCRM.', 409, 'CRM_NOT_CONFIGURED');
  return { config: c, client: new JoliefamClient(decryptToken(c.tokenEncrypted), c.basePath) };
}
export async function getSettings(a: Actor) {
  const c = await prisma.joliefamConnection.findUnique({ where: { orgId: a.orgId } });
  return { enabled: c?.enabled ?? false, basePath: c?.basePath ?? '/api/zcrm/v1', hasToken: !!c?.tokenEncrypted, hasWebhookSecret: !!c?.webhookSecretEncrypted, actorMap: c?.actorMap ?? {}, testedAt: c?.testedAt, lastSyncAt: c?.lastSyncAt, lastError: c?.lastError, encryptionReady: getTokenEncryptionKeyReadiness().ready, webhookPath: `/api/v1/joliefam/webhook/${a.orgId}` };
}
export async function saveSettings(a: Actor, input: unknown) {
  const body = object(input), old = await prisma.joliefamConnection.findUnique({ where: { orgId: a.orgId } });
  if (typeof body.enabled !== 'boolean') throw new CommerceError('Cần chọn bật hoặc tắt kết nối.');
  const basePath = text(body.basePath ?? old?.basePath ?? '/api/zcrm/v1', 110, true);
  new JoliefamClient('validate', basePath);
  const token = text(body.token, 4000), secret = text(body.webhookSecret, 4000);
  if (token && /[\r\n]/.test(token)) throw new CommerceError('Khóa API không hợp lệ.');
  if ((!token && !old) || (!secret && !old)) throw new CommerceError('Cần khóa API và khóa xác nhận cập nhật CRM.');
  if (secret && secret.length < 32) throw new CommerceError('Khóa xác nhận cập nhật cần ít nhất 32 ký tự.');
  if ((token || secret) && !getTokenEncryptionKeyReadiness().ready) throw new CommerceError('Máy chủ chưa cấu hình khóa mã hóa kết nối.', 409, 'ENCRYPTION_NOT_READY');
  const actorMap = object(body.actorMap ?? old?.actorMap ?? {});
  if (Object.keys(actorMap).length > 500) throw new CommerceError('Quá nhiều tài khoản kết nối.');
  for (const [id, crmId] of Object.entries(actorMap)) {
    identifier(crmId);
    if (!await prisma.user.findFirst({ where: { id, orgId: a.orgId }, select: { id: true } })) throw new CommerceError('Tài khoản ghép CRM không thuộc tổ chức.');
  }
  const changed = token || secret || basePath !== old?.basePath;
  // A changed credential must pass a fresh read-only contract test before enablement.
  if (body.enabled && (!old?.testedAt || changed)) throw new CommerceError('Lưu ở chế độ tắt rồi kiểm tra kết nối trước khi bật.', 409, 'CRM_TEST_REQUIRED');
  const data = { enabled: body.enabled, basePath, tokenEncrypted: token ? encryptToken(token) : old!.tokenEncrypted, webhookSecretEncrypted: secret ? encryptToken(secret) : old!.webhookSecretEncrypted, actorMap: json(actorMap), ...(changed ? { testedAt: null } : {}) };
  await prisma.joliefamConnection.upsert({ where: { orgId: a.orgId }, create: { orgId: a.orgId, ...data }, update: data });
  await audit(a, 'connection.update', a.orgId, { enabled: body.enabled });
  return getSettings(a);
}
export async function testConnection(a: Actor) {
  const { client } = await connection(a.orgId, true);
  try {
    const result = await client.capabilities();
    const required = ['customers', 'products', 'summary', 'orders', 'quotes', 'draft_orders', 'idempotency', 'events', 'attachments'];
    if (result.version !== 1 || required.some(c => !result.capabilities?.includes(c))) throw new CommerceError('CRM chưa đủ chức năng kết nối v1. Đối chiếu tài liệu tích hợp.', 409, 'CRM_CAPABILITY_MISSING');
    await prisma.joliefamConnection.update({ where: { orgId: a.orgId }, data: { testedAt: new Date(), lastError: null } });
    await audit(a, 'connection.test', a.orgId); return { ok: true, capabilities: result.capabilities };
  } catch (e) { await prisma.joliefamConnection.update({ where: { orgId: a.orgId }, data: { testedAt: null, enabled: false, lastError: e instanceof CommerceError ? e.message : 'Kiểm tra kết nối thất bại.' } }); throw e; }
}
export async function links(a: Actor, contactId: string) { await assertContact(a, contactId); return prisma.joliefamCustomerLink.findMany({ where: { orgId: a.orgId, contactId }, orderBy: { createdAt: 'asc' } }); }
async function assertLink(a: Actor, contactId: string, customerId: string) {
  await assertContact(a, contactId);
  const link = await prisma.joliefamCustomerLink.findFirst({ where: { orgId: a.orgId, contactId, customerId } });
  if (!link) throw new CommerceError('Cần xác nhận liên kết đúng khách CRM.', 409, 'CUSTOMER_NOT_LINKED');
  return link;
}
export async function searchCustomers(a: Actor, contactId: string, query: string, cursor: string) {
  const contact = await assertContact(a, contactId);
  const q = query || contact.phone || '';
  if (!q) return { items: [], nextCursor: null };
  const { client } = await connection(a.orgId); return client.customers(q, cursor);
}
export async function linkCustomer(a: Actor, contactId: string, input: unknown) {
  await assertContact(a, contactId); const b = object(input), customerId = identifier(b.customerId);
  if (b.confirmed !== true) throw new CommerceError('Cần xác nhận đã kiểm tra đúng khách.');
  const { client } = await connection(a.orgId); const c = await client.customer(customerId);
  const crmContactId = b.crmContactId ? identifier(b.crmContactId) : null;
  if (crmContactId && !c.contacts.some(p => p.id === crmContactId)) throw new CommerceError('Người liên hệ không thuộc hồ sơ CRM này.');
  const result = await prisma.joliefamCustomerLink.upsert({ where: { orgId_contactId_customerId: { orgId: a.orgId, contactId, customerId } }, create: { orgId: a.orgId, contactId, customerId, crmContactId, customerName: c.name, confirmedBy: a.userId }, update: { crmContactId, customerName: c.name, confirmedBy: a.userId } });
  await audit(a, 'customer.link', result.id, { contactId, customerId, crmContactId }); return result;
}
export async function unlinkCustomer(a: Actor, contactId: string, customerId: string) {
  await assertLink(a, contactId, customerId);
  if (await prisma.joliefamDraft.count({ where: { orgId: a.orgId, contactId, customerId, status: { in: ['submitting', 'uncertain'] } } })) throw new CommerceError('Đang kiểm tra đơn đã gửi. Hãy xác nhận kết quả trước khi gỡ liên kết.', 409);
  await prisma.joliefamCustomerLink.deleteMany({ where: { orgId: a.orgId, contactId, customerId } });
  await audit(a, 'customer.unlink', contactId, { customerId }); return { ok: true };
}
export async function createCustomer(a: Actor, contactId: string, input: unknown) {
  await assertContact(a, contactId); const b = object(input);
  const name = text(b.name, 200, true), phone = text(b.phone, 40, true), key = identifier(b.requestKey);
  if (!['hotel', 'individual'].includes(b.kind)) throw new CommerceError('Chọn khách sạn hoặc cá nhân.');
  const { client } = await connection(a.orgId);
  const customer = await client.createCustomer({ name, phone, kind: b.kind, source: 'ZCRM' }, `customer:${a.orgId}:${contactId}:${key}`);
  identifier(customer.id); await audit(a, 'customer.create', customer.id, { contactId });
  // Creation is an explicit confirmation of the new profile.
  return linkCustomer(a, contactId, { customerId: customer.id, confirmed: true });
}
function cacheWhere(orgId: string, customerId: string, cacheKey: string) { return { orgId_customerId_cacheKey: { orgId, customerId, cacheKey } }; }
export async function storeSnapshot(orgId: string, customerId: string, key: string, data: unknown, version = 0) {
  return tenantTransaction(async tx => {
    // Shared transaction lock prevents old responses overwriting new webhook data.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${orgId + ':' + customerId + ':' + key}, 0))`;
    const old = await tx.joliefamSnapshot.findUnique({ where: cacheWhere(orgId, customerId, key) });
    if (old && old.sourceVersion > version) return old;
    return tx.joliefamSnapshot.upsert({ where: cacheWhere(orgId, customerId, key), create: { orgId, customerId, cacheKey: key, data: json(data), sourceVersion: version }, update: { data: json(data), fetchedAt: new Date(), sourceVersion: version } });
  });
}
export async function readPurchase(a: Actor, contactId: string, customerId: string, kind: 'overview' | 'orders' | 'order', filters: Record<string, string> = {}, refresh = false) {
  await assertLink(a, contactId, customerId);
  const key = kind === 'order' ? `order:${identifier(filters.id)}` : kind === 'orders' ? `orders:${JSON.stringify(filters)}` : 'overview';
  const requestStarted = Date.now();
  const old = await prisma.joliefamSnapshot.findUnique({ where: cacheWhere(a.orgId, customerId, key) });
  const { config } = await connection(a.orgId, true).catch(() => ({ config: null }));
  if (!config?.enabled) { if (old) return { data: old.data, updatedAt: old.fetchedAt, stale: true, error: 'Kết nối CRM đang tắt.' }; throw new CommerceError('Chưa bật kết nối CRM.', 409, 'CRM_NOT_CONFIGURED'); }
  if (old && !refresh) return { data: old.data, updatedAt: old.fetchedAt, stale: Date.now() - old.fetchedAt.getTime() > 60000 };
  try {
    const { client } = await connection(a.orgId);
    const data = kind === 'overview' ? { customer: await client.customer(customerId), summary: await client.summary(customerId) } : kind === 'order' ? await client.order(customerId, filters.id) : await client.orders(customerId, filters);
    const version = kind === 'order' ? (data as Order).version : requestStarted;
    // Overview/list snapshots use a local timestamp, not the order's CRM revision.
    const saved = await storeSnapshot(a.orgId, customerId, key, data, version);
    return { data: saved.data, updatedAt: saved.fetchedAt, stale: false };
  } catch (e) { if (old) return { data: old.data, updatedAt: old.fetchedAt, stale: true, error: e instanceof CommerceError ? e.message : 'Chưa cập nhật được dữ liệu CRM.' }; throw e; }
}
export async function products(a: Actor, contactId: string, q: string, cursor: string) { await assertContact(a, contactId); const { client } = await connection(a.orgId); return client.products(q, cursor); }
export async function listDrafts(a: Actor, contactId: string, cursor?: string) {
  await assertContact(a, contactId); const found = await prisma.joliefamDraft.findMany({ where: { orgId: a.orgId, contactId, ...(cursor ? { id: { lt: cursor } } : {}) }, orderBy: { id: 'desc' }, take: 21 });
  return { items: found.slice(0, 20), nextCursor: found.length > 20 ? found[19].id : null };
}
async function getDraft(a: Actor, contactId: string, id: string) {
  await assertContact(a, contactId);
  const d = await prisma.joliefamDraft.findFirst({ where: { id, orgId: a.orgId, contactId } });
  if (!d) throw new CommerceError('Không tìm thấy đơn nháp.', 404);
  return d;
}
async function validateAttachments(a: Actor, draft: DraftInput) {
  for (const line of draft.lines) for (const attachment of line.attachments) {
    const media = await prisma.mediaAsset.findFirst({ where: { id: attachment.mediaId, orgId: a.orgId, archivedAt: null, sourceIsPrivateNick: false, OR: [{ ownerUserId: a.userId }, { visibility: 'public' }] }, select: { id: true, blobs: { where: { variantType: 'original' }, select: { sizeBytes: true }, take: 1 } } });
    if (media && (!media.blobs[0] || media.blobs[0].sizeBytes > 15 * 1024 * 1024)) throw new CommerceError('Tài liệu vượt 15 MB hoặc chưa có nội dung.');
    if (!media) throw new CommerceError('Không có quyền dùng tài liệu đính kèm hoặc tài liệu thuộc nick riêng tư.', 403, 'ATTACHMENT_FORBIDDEN');
  }
}
export async function saveDraft(a: Actor, contactId: string, input: unknown, id?: string) {
  await assertContact(a, contactId); const b = object(input), draft = parseDraft(b.input);
  if (draft.customerId) await assertLink(a, contactId, draft.customerId);
  await validateAttachments(a, draft);
  if (!id) {
    const createKey = `${contactId}:${identifier(b.createKey)}`;
    const previous = await prisma.joliefamDraft.findUnique({ where: { orgId_createKey: { orgId: a.orgId, createKey } } });
    if (previous) return previous;
    const result = await prisma.joliefamDraft.upsert({ where: { orgId_createKey: { orgId: a.orgId, createKey } }, create: { orgId: a.orgId, contactId, customerId: draft.customerId, createdBy: a.userId, createKey, input: json(draft) }, update: {} });
    await audit(a, 'draft.create', result.id); return result;
  }
  const old = await getDraft(a, contactId, id); const revision = integer(b.revision);
  if (!['local', 'returned'].includes(old.status)) throw new CommerceError('Đơn đã gửi được khóa sửa. Chờ CRM trả lại để bổ sung.', 409, 'DRAFT_LOCKED');
  const result = await prisma.joliefamDraft.updateMany({ where: { id, orgId: a.orgId, contactId, revision, status: { in: ['local', 'returned'] } }, data: { input: json(draft), customerId: draft.customerId, revision: { increment: 1 }, quote: Prisma.DbNull, lastError: null } });
  if (!result.count) throw new CommerceError('Đơn đã được sửa ở nơi khác. Hãy tải lại.', 409, 'DRAFT_CONFLICT');
  await audit(a, 'draft.update', id); return getDraft(a, contactId, id);
}
async function crmActor(orgId: string, userId: string) { const { config, client } = await connection(orgId); const map = object(config.actorMap); if (!map[userId]) throw new CommerceError('Chưa ghép nhân viên ZCRM với tài khoản CRM. Liên hệ quản trị kết nối.', 409, 'CRM_ACTOR_MISSING'); return { client, actorId: identifier(map[userId]) }; }
export async function quoteDraft(a: Actor, contactId: string, id: string, revision: number) {
  const d = await getDraft(a, contactId, id); if (!['local', 'returned'].includes(d.status) || d.revision !== revision) throw new CommerceError('Đơn đã thay đổi hoặc đang khóa.', 409);
  const draft = parseDraft(d.input); validateSubmission(draft); await assertLink(a, contactId, draft.customerId!); await validateAttachments(a, draft);
  const { client, actorId } = await crmActor(a.orgId, a.userId);
  const quote = await client.quote(draft, fingerprint(draft), actorId); validateQuote(quote, draft);
  const updated = await prisma.joliefamDraft.updateMany({ where: { id, orgId: a.orgId, revision, status: { in: ['local', 'returned'] } }, data: { quote: json(quote) } });
  if (!updated.count) throw new CommerceError('Đơn vừa thay đổi. Hãy kiểm tra giá lại.', 409);
  return getDraft(a, contactId, id);
}
export async function reconcileDraft(orgId: string, id: string) {
  const d = await prisma.joliefamDraft.findFirst({ where: { id, orgId } }); if (!d?.requestKey) return d;
  const { client } = await connection(orgId); const result = await client.lookup(d.requestKey);
  if (!result.found || !result.order) return d;
  const order = await client.order(d.customerId!, result.order.id);
  await storeSnapshot(orgId, order.customerId, `order:${order.id}`, order, order.version);
  const returned = order.approval.code === 'returned';
  const closed = ['completed', 'cancelled'].includes(order.processing.code) || order.approval.code === 'rejected';
  // A returned order starts a fresh submission revision, preserving the CRM order id.
  await prisma.joliefamDraft.updateMany({ where: { id, orgId, requestKey: d.requestKey, status: { in: ['submitting', 'uncertain', 'submitted'] } }, data: { crmOrderId: order.id, crmOrderCode: order.code, approver: result.approver ?? null, status: returned ? 'returned' : closed ? 'closed' : 'submitted', ...(returned ? { revision: { increment: 1 }, quote: Prisma.DbNull, input: json(parseDraft({ ...(d.input as object), lines: order.lines, recipient: order.recipient ?? (d.input as any).recipient, orderedBy: order.orderedBy ?? (d.input as any).orderedBy })) } : {}), lockedAt: null, lastError: result.rejection ?? null } });
  return prisma.joliefamDraft.findFirst({ where: { id, orgId } });
}
export async function submitDraft(a: Actor, contactId: string, id: string, input: unknown) {
  const b = object(input), revision = integer(b.revision);
  let d = await getDraft(a, contactId, id);
  const retrying = ['uncertain', 'submitting'].includes(d.status);
  if (['submitted', 'closed'].includes(d.status)) return d;
  if (d.status === 'submitting' && d.lockedAt && Date.now() - d.lockedAt.getTime() < 60000) return d;
  if (d.status === 'uncertain' || d.status === 'submitting') {
    const reconciled = await reconcileDraft(a.orgId, id);
    if (reconciled?.status === 'submitted' || reconciled?.status === 'returned' || reconciled?.status === 'closed') return reconciled;
    d = await getDraft(a, contactId, id);
  }
  if (d.revision !== revision || !['local', 'returned', 'uncertain', 'submitting'].includes(d.status)) throw new CommerceError('Đơn đã thay đổi. Hãy tải lại.', 409);
  const draft = parseDraft(d.input); validateSubmission(draft); await assertLink(a, contactId, draft.customerId!); await validateAttachments(a, draft);
  const quote = d.quote as unknown as Quote;
  if (!retrying) validateQuote(quote, draft);
  else if (!quote?.token || quote.fingerprint !== fingerprint(draft)) throw new CommerceError('Đơn chưa xác nhận kết quả đã đổi dữ liệu.', 409);
  if (b.quoteToken !== quote.token || b.confirmed !== true) throw new CommerceError('Cần xác nhận bảng tính tiền mới nhất.', 409);
  const context = retrying && d.submissionActorId ? { client: (await connection(a.orgId)).client, actorId: d.submissionActorId } : await crmActor(a.orgId, a.userId);
  const { client, actorId } = context;
  const requestKey = d.status === 'returned' || !d.requestKey ? `zcrm:${a.orgId}:${id}:${revision}` : d.requestKey;
  if (draft.lines.some(line => line.attachments.length) && new URL(appConfig.appUrl).protocol !== 'https:') throw new CommerceError('Cần APP_URL HTTPS để CRM nhận tài liệu đính kèm.', 409, 'ATTACHMENT_TRANSFER_NOT_READY');
  const acquired = await prisma.joliefamDraft.updateMany({ where: { id, orgId: a.orgId, revision, status: d.status, lockedAt: d.lockedAt }, data: { status: 'submitting', requestKey, submissionActorId: actorId, lockedAt: new Date(), lastError: null } });
  if (!acquired.count) return getDraft(a, contactId, id);
  await audit(a, 'draft.submit', id, { requestKey });
  try {
    // The CRM uses an authenticated transfer route for attachments; it must never
    // treat an arbitrary URL from a draft as trusted input.
    const attached = draft.lines.flatMap(line => line.attachments);
    const origin = new URL(appConfig.appUrl);
    if (attached.length && origin.protocol !== 'https:') throw new CommerceError('Cần APP_URL HTTPS để CRM nhận tài liệu đính kèm.', 409, 'ATTACHMENT_TRANSFER_NOT_READY');
    const attachments = attached.map(file => ({ ...file, url: new URL(`/api/v1/joliefam/transfer/${a.orgId}/${id}/${file.mediaId}`, origin.origin).href }));
    const result = await client.submit(draft, quote, requestKey, actorId, d.crmOrderId, attachments);
    if (!orderValid(result.order) || result.order.customerId !== d.customerId) throw new CommerceError('CRM trả về đơn không đúng khách.', 502, 'CRM_CONTRACT_INVALID');
    await prisma.joliefamDraft.updateMany({ where: { id, orgId: a.orgId, requestKey, status: 'submitting' }, data: { status: 'submitted', crmOrderId: result.order.id, crmOrderCode: result.order.code, approver: result.approver ?? null, lockedAt: null } });
    await audit(a, 'draft.submitted', id, { crmOrderId: result.order.id });
  } catch (e) {
    // Definitive validation rejection is editable; ambiguous failures remain locked.
    const definitive = e instanceof CommerceError && ['CRM_CONFLICT', 'CRM_VALIDATION'].includes(e.code);
    await prisma.joliefamDraft.updateMany({ where: { id, orgId: a.orgId, requestKey, status: 'submitting' }, data: { status: definitive ? (d.crmOrderId ? 'returned' : 'local') : 'uncertain', ...(definitive ? { requestKey: null, quote: Prisma.DbNull, revision: { increment: 1 } } : {}), lockedAt: null, lastError: e instanceof CommerceError ? e.message : 'Chưa xác nhận được kết quả. Kiểm tra trước khi gửi lại.' } });
  }
  return getDraft(a, contactId, id);
}
export async function checkDraft(a: Actor, contactId: string, id: string) { await getDraft(a, contactId, id); return reconcileDraft(a.orgId, id); }
export async function contactProfile(a: Actor, contactId: string) {
  const c = await assertContact(a, contactId);
  // Uses real accessible contact fields only; does not broaden access to private nick data.
  return { contact: { ...c, displayName: c.crmName || c.fullName || c.phone || 'Khách hàng' } };
}
