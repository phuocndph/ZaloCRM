/**
 * fb-adapter.ts — Facebook Lead Ads adapter.
 *
 * Public functions:
 *   verifyWebhook(rawBody, signature, appSecret) — HMAC SHA256 verify
 *   parseLead(rawBody) — extract leadgen_id từ POST payload (NHANH, không Graph API call)
 *   processLog(log) — full processor: Graph API fetch → NormalizedLead → insert entry
 *
 * Eng review Issue 1: verify dùng raw body (Fastify addContentTypeParser)
 * Issue 3: parseLead chỉ extract identifiers; processLog mới gọi Graph API (run trong worker)
 * Issue 10: throw nếu shape sai → worker mark failed
 */
import { verifyHmacSignature } from '../../../shared/security/hmac.js';
import { prisma } from '../../../shared/database/prisma-client.js';
import { withTenant, runSystemQuery } from '../../../shared/tenant/tenant-context.js';
import { logger } from '../../../shared/utils/logger.js';
import { normalizePhone } from '../../../shared/utils/phone.js';
import { decryptToken } from '../_shared/token-encryption.util.js';
import { assertValidLead, type NormalizedLead } from '../_shared/normalized-lead.schema.js';
import { resolveListFromCampaign } from '../_shared/lead-routing.service.js';
import { markProcessed } from '../_shared/webhook-log.service.js';
import { checkAndIncrementNotify } from '../_shared/notify-dedup.service.js';

const GRAPH_API_VERSION = 'v19.0';

/**
 * Verify HMAC X-Hub-Signature-256.
 * @param rawBody — Buffer or string from request (KHÔNG parse JSON trước)
 * @param signature — header "sha256=<hex>"
 * @param appSecret — App Secret từ Meta App config
 */
export function verifyWebhook(rawBody: Buffer | string, signature: string | undefined, appSecret: string): boolean {
  // FB gửi 'sha256=<hex>' — strip prefix rồi verify timing-safe qua util chung (Phase 5).
  if (!signature || !signature.startsWith('sha256=')) return false;
  return verifyHmacSignature(rawBody, signature.slice('sha256='.length), appSecret);
}

/** Lightweight parse trong webhook handler — chỉ lấy leadgen_id để dedup. */
export interface FbWebhookPayload {
  leadgenId: string;
  adId: string;
  formId: string;
  pageId: string;
  createdTime?: number;
}

export function parseFbWebhookPayload(body: unknown): FbWebhookPayload[] {
  if (!body || typeof body !== 'object') throw new Error('FB webhook: body not object');
  const b = body as { object?: string; entry?: Array<{ id?: string; changes?: Array<{ value?: Record<string, unknown>; field?: string }> }> };
  if (b.object !== 'page') throw new Error(`FB webhook: object must be 'page', got '${b.object}'`);
  const leads: FbWebhookPayload[] = [];
  for (const entry of b.entry ?? []) {
    const pageId = entry.id ?? '';
    for (const change of entry.changes ?? []) {
      if (change.field !== 'leadgen') continue;
      const v = change.value;
      if (!v) continue;
      const leadgenId = String(v.leadgen_id ?? '');
      const adId = String(v.ad_id ?? '');
      const formId = String(v.form_id ?? '');
      if (!leadgenId) continue;
      leads.push({
        leadgenId,
        adId,
        formId,
        pageId,
        createdTime: typeof v.created_time === 'number' ? v.created_time * 1000 : undefined,
      });
    }
  }
  return leads;
}

/**
 * Full processor — gọi từ outbox worker. Có thể throw → worker retry exp backoff.
 *
 * Steps:
 *   1. Re-parse rawBody → leadgenId/adId/pageId
 *   2. Lookup FacebookPageAccount → orgId + access token
 *   3. Graph API: fetch ad → campaign_id, campaign_name
 *   4. Graph API: fetch leadgen → field_data
 *   5. Normalize → NormalizedLead
 *   6. resolveListFromCampaign() → listId
 *   7. Insert CustomerListEntry (with idempotency on customerListId + sourceMeta.externalLeadId)
 *   8. Notify dedup if Unrouted
 *   9. markProcessed()
 */
export async function processFbWebhookLog(log: { id: string; externalLeadId: string; rawBody: unknown; attempts: number }): Promise<void> {
  const t0 = Date.now();
  const timings: Record<string, number> = {};
  const leads = parseFbWebhookPayload(log.rawBody);
  timings.parseMs = Date.now() - t0;
  const targetLead = leads.find((l) => l.leadgenId === log.externalLeadId);
  if (!targetLead) {
    throw new Error(`Lead ${log.externalLeadId} not found in rawBody.entry[].changes`);
  }

  // Lookup org via Page — cross-org (pageId → org) nên bypass RLS để resolve.
  const pageAccount = await runSystemQuery(() => prisma.facebookPageAccount.findUnique({
    where: { pageId: targetLead.pageId },
    select: { orgId: true, encryptedAccessToken: true, isActive: true, id: true },
  }));
  if (!pageAccount) throw new Error(`No FacebookPageAccount for pageId=${targetLead.pageId} (anh chưa connect Page?)`);
  if (!pageAccount.isActive) throw new Error(`FacebookPageAccount ${targetLead.pageId} disabled (token revoked?)`);

  // Phase 1a RLS (Giai đoạn 0.2): đã biết org → phần còn lại org-scoped chạy trong tenant.
  await withTenant(pageAccount.orgId, async () => {
  const accessToken = decryptToken(pageAccount.encryptedAccessToken);

  // Update last webhook timestamp (best-effort)
  prisma.facebookPageAccount.update({
    where: { id: pageAccount.id },
    data: { lastWebhookAt: new Date() },
  }).catch(() => { /* swallow */ });

  // Graph API: fetch ad → campaign info
  const tGraphStart = Date.now();
  const adRes = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(targetLead.adId)}?fields=campaign{id,name}&access_token=${encodeURIComponent(accessToken)}`,
    { signal: AbortSignal.timeout(10_000) },
  );
  if (!adRes.ok) {
    const txt = await adRes.text();
    throw new Error(`Graph API ad ${adRes.status}: ${txt.slice(0, 200)}`);
  }
  const adData = (await adRes.json()) as { campaign?: { id?: string; name?: string } };
  const campaignId = adData.campaign?.id;
  const campaignName = adData.campaign?.name ?? '';
  if (!campaignId) throw new Error(`Graph API: ad ${targetLead.adId} thiếu campaign info`);

  // Graph API: fetch leadgen → field_data
  const leadRes = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(targetLead.leadgenId)}?fields=field_data,created_time&access_token=${encodeURIComponent(accessToken)}`,
    { signal: AbortSignal.timeout(10_000) },
  );
  if (!leadRes.ok) {
    const txt = await leadRes.text();
    throw new Error(`Graph API lead ${leadRes.status}: ${txt.slice(0, 200)}`);
  }
  const leadData = (await leadRes.json()) as { field_data?: Array<{ name?: string; values?: string[] }>; created_time?: string };
  const fieldData = leadData.field_data ?? [];
  timings.graphApiMs = Date.now() - tGraphStart;

  // Extract built-in + custom
  let name = '';
  let phone = '';
  const customFields: Record<string, unknown> = {};
  for (const f of fieldData) {
    const fname = (f.name ?? '').trim();
    const val = (f.values?.[0] ?? '').trim();
    if (!fname) continue;
    const lower = fname.toLowerCase();
    if (lower === 'full_name' || lower === 'name') {
      name = val;
    } else if (lower === 'phone_number' || lower === 'phone') {
      phone = val;
    } else {
      // Email + custom questions all go to JSON
      customFields[fname] = val;
    }
  }
  if (!phone) throw new Error(`Lead ${targetLead.leadgenId} thiếu phone_number — không thể tạo entry`);

  const lead: NormalizedLead = {
    source: 'fb-leadads',
    campaignName,
    name,
    phone,
    customFields,
    sourceMeta: {
      externalLeadId: targetLead.leadgenId,
      campaignId,
      campaignName,
      adId: targetLead.adId,
      formId: targetLead.formId,
      pageId: targetLead.pageId,
      rawFieldData: fieldData,
      submittedAt: leadData.created_time ? Date.parse(leadData.created_time) : targetLead.createdTime,
    },
  };
  assertValidLead(lead);

  // Route → list
  const tRouteStart = Date.now();
  const routing = await resolveListFromCampaign(pageAccount.orgId, campaignId, campaignName);
  timings.routeMs = Date.now() - tRouteStart;

  // Phone normalize
  const phoneNormalized = normalizePhone(phone);
  const phoneE164 = phoneNormalized ? `+${phoneNormalized}` : null;
  const phoneLocal = phoneNormalized && phoneNormalized.startsWith('84')
    ? `0${phoneNormalized.slice(2)}`
    : phoneNormalized;
  const phoneValid = !!phoneNormalized;

  // Insert entry. rowIndex = next available trong list.
  // Vì FB lead về tuần tự, em dùng aggregate count + 1. KHÔNG race-safe perfect nhưng acceptable.
  const count = await prisma.customerListEntry.count({ where: { customerListId: routing.listId } });

  const tInsertStart = Date.now();
  const entry = await prisma.customerListEntry.create({
    data: {
      customerListId: routing.listId,
      rowIndex: count + 1,
      phoneRaw: phone,
      nameRaw: name || null,
      phoneE164,
      phoneLocal,
      phoneValid,
      invalidReason: phoneValid ? null : 'invalid_format',
      customFields: lead.customFields as object,
      sourceMeta: lead.sourceMeta as object,
      status: phoneValid ? 'validated' : 'invalid',
      hasZalo: null, // enrichment worker sẽ check
    },
    select: { id: true },
  });
  timings.dbInsertMs = Date.now() - tInsertStart;
  timings.totalMs = Date.now() - t0;

  // Mark log processed with timing
  await markProcessed(log.id, entry.id);
  // Lưu timing vào WebhookLog (best-effort, non-blocking)
  prisma.webhookLog.update({
    where: { id: log.id },
    data: { processingSteps: timings as object },
  }).catch(() => { /* swallow */ });

  // Notify if Unrouted (dedup per campaign 24h)
  if (routing.isUnrouted) {
    const notifyKey = `unrouted:campaign:${campaignId}`;
    const dedup = await checkAndIncrementNotify(pageAccount.orgId, notifyKey);
    if (dedup.shouldSend) {
      const reason = routing.matchedKey
        ? `Key #${routing.matchedKey} không tìm thấy trong CRM`
        : 'Campaign chưa gắn #KEY trong tên';
      logger.warn(`[fb-adapter] UNROUTED lead from campaign "${campaignName}" → ${reason}. Notify org ${pageAccount.orgId}.`);
      // TODO Phase 1.5: emit Zalo notify qua system-notify-routes
      // emitSystemNotify(pageAccount.orgId, { title: 'Lead FB chưa route đúng tệp', body: `Campaign "${campaignName}": ${reason}` });
    }
  }

  logger.info(`[fb-adapter] Lead ${targetLead.leadgenId} → list "${routing.listName}" (${routing.cacheHit ? 'cache' : 'fresh'})`);
  });
}
