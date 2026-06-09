/**
 * duplicate-detector.ts — Detect & auto-merge duplicate contacts per org.
 *
 * Policy (theo đề xuất user 2026-05-12):
 *   Hard match (1 trong các key → auto-merge, confidence 1.0):
 *     - zaloGlobalId (Zalo toàn cục, source-of-truth)
 *     - zaloUsername (Zalo handle t_xxx, toàn cục)
 *     - phone (normalized)
 *   Conflict guard: nếu group có ≥2 globalId hoặc ≥2 username khác nhau
 *     → KHÔNG auto-merge, flag DuplicateGroup chờ sale review.
 *   Soft match (name 100% exact + 1 trong 3 điều kiện phụ → auto-merge):
 *     - birthDate khớp
 *     - lastActivity cùng ngày (date-level)
 *     - notes (mô tả KH) khớp exact non-empty
 *   Fuzzy match (Levenshtein name > 0.9) còn lại → DuplicateGroup chờ sale.
 *   Legacy zaloUid match (per-account) → DuplicateGroup chờ sale.
 */
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { mergeContacts } from './merge-service.js';
import { withTenant } from '../../shared/tenant/tenant-context.js';

interface ContactLite {
  id: string;
  phone: string | null;
  zaloUid: string | null;
  zaloGlobalId: string | null;
  zaloUsername: string | null;
  fullName: string | null;
  birthDate: Date | null;
  lastActivity: Date | null;
  notes: string | null;
  createdAt: Date;
}

function levenshteinRatio(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  if (la === 0 && lb === 0) return 1;
  if (la === 0 || lb === 0) return 0;
  const dp: number[][] = Array.from({ length: la + 1 }, (_, i) =>
    Array.from({ length: lb + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return 1 - dp[la][lb] / Math.max(la, lb);
}

function normPhone(phone: string): string {
  return phone.replace(/[\s\-\.]/g, '').toLowerCase();
}

function normName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normNotes(notes: string | null): string {
  return (notes || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function sameDate(a: Date | null, b: Date | null): boolean {
  if (!a || !b) return false;
  return a.getUTCFullYear() === b.getUTCFullYear()
    && a.getUTCMonth() === b.getUTCMonth()
    && a.getUTCDate() === b.getUTCDate();
}

async function saveGroup(
  orgId: string,
  contactIds: string[],
  matchType: string,
  confidence: number,
): Promise<void> {
  const sorted = [...contactIds].sort();
  const existing = await prisma.duplicateGroup.findFirst({
    where: { orgId, resolved: false, contactIds: { equals: sorted } },
  });
  if (existing) return;
  await prisma.duplicateGroup.create({
    data: { orgId, contactIds: sorted, matchType, confidence },
  });
}

/** Try to auto-merge a hard-match group. Honor conflict guards: if differing globalIds
 *  hoặc usernames trong group → skip auto-merge, save DuplicateGroup. */
async function autoMergeHardMatch(
  orgId: string,
  systemUserId: string,
  group: ContactLite[],
  matchType: 'zalo_global_id' | 'zalo_username' | 'phone',
  autoMergedIds: Set<string>,
  conflictGroupsRef: { count: number },
): Promise<boolean> {
  if (group.length < 2) return false;

  // Conflict guard (chỉ áp với phone/username — globalId match thì globalId obviously cùng nhau).
  if (matchType !== 'zalo_global_id') {
    const distinctGlobalIds = new Set(group.filter(c => c.zaloGlobalId).map(c => c.zaloGlobalId!));
    if (distinctGlobalIds.size > 1) {
      await saveGroup(orgId, group.map(c => c.id), `${matchType}_conflict_globalId`, 0.5);
      conflictGroupsRef.count++;
      return false;
    }
  }
  if (matchType === 'phone') {
    const distinctUsernames = new Set(group.filter(c => c.zaloUsername).map(c => c.zaloUsername!));
    if (distinctUsernames.size > 1) {
      await saveGroup(orgId, group.map(c => c.id), 'phone_conflict_username', 0.5);
      conflictGroupsRef.count++;
      return false;
    }
  }

  const sorted = [...group].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const primary = sorted[0];
  const secondaries = sorted.slice(1).map(c => c.id);
  try {
    await mergeContacts(orgId, systemUserId, primary.id, secondaries);
    autoMergedIds.add(primary.id);
    secondaries.forEach(id => autoMergedIds.add(id));
    logger.info(`[duplicate-detector] Auto-merged ${secondaries.length + 1} contacts via ${matchType} (primary=${primary.id})`);
    return true;
  } catch (err) {
    logger.error(`[duplicate-detector] Auto-merge ${matchType} failed:`, err);
    await saveGroup(orgId, group.map(c => c.id), matchType, 1.0);
    return false;
  }
}

// Resolve "system" user cho audit log khi cron/backfill chạy: dùng owner của org.
// FK activity_logs.user_id yêu cầu user UUID hợp lệ; 'system' literal sẽ fail.
async function resolveSystemUserId(orgId: string): Promise<string | null> {
  const owner = await prisma.user.findFirst({
    where: { orgId, role: 'owner', isActive: true },
    select: { id: true },
  });
  if (owner) return owner.id;
  const anyAdmin = await prisma.user.findFirst({
    where: { orgId, isActive: true },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  return anyAdmin?.id ?? null;
}

export async function detectDuplicates(): Promise<void> {
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  let totalGroups = 0;
  let totalAutoMerged = 0;
  let totalConflictGroups = 0;

  // Phase 1a RLS (Giai đoạn 0.2): mỗi org chạy trong tenant context riêng để mọi
  // org-scoped query (contact/duplicateGroup/parentCandidate...) set đúng app.current_org.
  for (const org of orgs) await withTenant(org.id, async () => {
    const systemUserId = await resolveSystemUserId(org.id);
    if (!systemUserId) {
      logger.warn(`[duplicate-detector] org ${org.id} không có user active → skip auto-merge, chỉ flag DuplicateGroup`);
    }

    const contacts = await prisma.contact.findMany({
      where: { orgId: org.id, mergedInto: null },
      select: {
        id: true, phone: true, zaloUid: true, zaloGlobalId: true, zaloUsername: true,
        fullName: true, birthDate: true, lastActivity: true, notes: true, createdAt: true,
      },
    });

    const autoMergedIds = new Set<string>();
    const conflictRef = { count: 0 };
    const filterRemaining = () => contacts.filter(c => !autoMergedIds.has(c.id));

    // ── (1) Hard match: zaloGlobalId ──────────────────────────────────────
    const byGlobalId = new Map<string, ContactLite[]>();
    for (const c of contacts) {
      if (!c.zaloGlobalId) continue;
      if (!byGlobalId.has(c.zaloGlobalId)) byGlobalId.set(c.zaloGlobalId, []);
      byGlobalId.get(c.zaloGlobalId)!.push(c);
    }
    for (const group of byGlobalId.values()) {
      if (systemUserId && await autoMergeHardMatch(org.id, systemUserId, group, 'zalo_global_id', autoMergedIds, conflictRef)) {
        totalAutoMerged++;
      }
    }

    // ── (2) Hard match: zaloUsername ──────────────────────────────────────
    const byUsername = new Map<string, ContactLite[]>();
    for (const c of filterRemaining()) {
      if (!c.zaloUsername) continue;
      if (!byUsername.has(c.zaloUsername)) byUsername.set(c.zaloUsername, []);
      byUsername.get(c.zaloUsername)!.push(c);
    }
    for (const group of byUsername.values()) {
      if (systemUserId && await autoMergeHardMatch(org.id, systemUserId, group, 'zalo_username', autoMergedIds, conflictRef)) {
        totalAutoMerged++;
      }
    }

    // ── (3) Hard match: phone (normalized) ────────────────────────────────
    const byPhone = new Map<string, ContactLite[]>();
    for (const c of filterRemaining()) {
      if (!c.phone) continue;
      const key = normPhone(c.phone);
      if (!key) continue;
      if (!byPhone.has(key)) byPhone.set(key, []);
      byPhone.get(key)!.push(c);
    }
    for (const group of byPhone.values()) {
      if (systemUserId && await autoMergeHardMatch(org.id, systemUserId, group, 'phone', autoMergedIds, conflictRef)) {
        totalAutoMerged++;
      }
    }

    // ── (4) Soft match: name 100% exact + 1 trong 3 điều kiện phụ ─────────
    // Group by normalized name (exact), then pair-wise check secondary signals.
    const byNameExact = new Map<string, ContactLite[]>();
    for (const c of filterRemaining()) {
      if (!c.fullName) continue;
      const key = normName(c.fullName);
      if (!key || key === 'unknown') continue;
      if (!byNameExact.has(key)) byNameExact.set(key, []);
      byNameExact.get(key)!.push(c);
    }
    for (const group of byNameExact.values()) {
      if (group.length < 2) continue;
      // Pair-wise: nếu có 1 cặp khớp soft condition → gom cả nhóm để merge
      // (giả định traffic chung 1 name + 1 soft signal là đồng nhất).
      const mergeable: ContactLite[] = [];
      const seen = new Set<string>();
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i];
          const b = group[j];
          const birthMatch = sameDate(a.birthDate, b.birthDate);
          const lastActMatch = sameDate(a.lastActivity, b.lastActivity);
          const notesA = normNotes(a.notes);
          const notesB = normNotes(b.notes);
          const notesMatch = notesA.length > 0 && notesA === notesB;
          if (birthMatch || lastActMatch || notesMatch) {
            if (!seen.has(a.id)) { mergeable.push(a); seen.add(a.id); }
            if (!seen.has(b.id)) { mergeable.push(b); seen.add(b.id); }
          }
        }
      }
      if (mergeable.length >= 2) {
        const sorted = [...mergeable].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        const primary = sorted[0];
        const secondaries = sorted.slice(1).map(c => c.id);
        if (!systemUserId) {
          await saveGroup(org.id, mergeable.map(c => c.id), 'name_with_soft_match', 0.9);
          totalGroups++;
        } else {
          try {
            await mergeContacts(org.id, systemUserId, primary.id, secondaries);
            autoMergedIds.add(primary.id);
            secondaries.forEach(id => autoMergedIds.add(id));
            totalAutoMerged++;
            logger.info(`[duplicate-detector] Auto-merged ${secondaries.length + 1} contacts via name+softMatch (primary=${primary.id})`);
          } catch (err) {
            logger.error(`[duplicate-detector] Auto-merge name+softMatch failed:`, err);
            await saveGroup(org.id, mergeable.map(c => c.id), 'name_with_soft_match', 0.9);
            totalGroups++;
          }
        }
      }
    }

    // ── (5) zaloUid match (per-account, legacy) → DuplicateGroup manual ──
    const byZalo = new Map<string, string[]>();
    for (const c of filterRemaining()) {
      if (!c.zaloUid) continue;
      if (!byZalo.has(c.zaloUid)) byZalo.set(c.zaloUid, []);
      byZalo.get(c.zaloUid)!.push(c.id);
    }
    for (const ids of byZalo.values()) {
      if (ids.length >= 2) {
        await saveGroup(org.id, ids, 'zalo_uid', 1.0);
        totalGroups++;
      }
    }

    // ── (6) Fuzzy name (Levenshtein > 0.9) — chỉ contact không có identifier ──
    //     → DuplicateGroup chờ sale duyệt (risk gộp nhầm cao)
    const noIdContacts = filterRemaining().filter(c => !c.phone && !c.zaloUid && !c.zaloGlobalId && !c.zaloUsername && !!c.fullName);
    for (let i = 0; i < noIdContacts.length; i++) {
      for (let j = i + 1; j < noIdContacts.length; j++) {
        const nameA = normName(noIdContacts[i].fullName!);
        const nameB = normName(noIdContacts[j].fullName!);
        if (nameA === nameB) continue; // exact đã xử lý ở (4)
        const ratio = levenshteinRatio(nameA, nameB);
        if (ratio > 0.9) {
          await saveGroup(org.id, [noIdContacts[i].id, noIdContacts[j].id], 'name', ratio);
          totalGroups++;
        }
      }
    }

    // ── (7) Parent candidates: name+phone TRÙNG nhưng globalId KHÁC ────
    //     → suggest user as cha-con (cross-Zalo-identity human-level link).
    //     NOT auto-merge; save ParentCandidate cho sale duyệt.
    const parentBy = new Map<string, ContactLite[]>();
    for (const c of filterRemaining()) {
      if (!c.fullName || !c.phone) continue;
      const key = `${normName(c.fullName)}|${normPhone(c.phone)}`;
      if (!parentBy.has(key)) parentBy.set(key, []);
      parentBy.get(key)!.push(c);
    }
    for (const group of parentBy.values()) {
      if (group.length < 2) continue;
      // Cần có ít nhất 2 globalId khác nhau (cross-identity), nếu cùng globalId thì đã auto-merge ở (1)
      const distinctGlobalIds = new Set(group.filter(c => c.zaloGlobalId).map(c => c.zaloGlobalId!));
      if (distinctGlobalIds.size < 2) continue;
      const ids = [...group].map(c => c.id).sort();
      // Skip nếu đã có ParentCandidate chưa dismiss cho cùng cụm
      const existing = await prisma.parentCandidate.findFirst({
        where: { orgId: org.id, dismissed: false, contactIds: { equals: ids } },
      });
      if (existing) continue;
      await prisma.parentCandidate.create({
        data: { orgId: org.id, contactIds: ids, matchType: 'name_phone', confidence: 0.9 },
      });
    }

    totalConflictGroups += conflictRef.count;
  });

  logger.info(
    `[duplicate-detector] auto-merged=${totalAutoMerged} group(s); ` +
    `flagged=${totalGroups} group(s); conflicts=${totalConflictGroups} across ${orgs.length} org(s)`,
  );
}
