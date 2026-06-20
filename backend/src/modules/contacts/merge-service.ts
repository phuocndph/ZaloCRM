// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * merge-service.ts — Merges duplicate contacts within an org.
 * Reassigns conversations/appointments to primary, marks secondaries as merged.
 */
import { Prisma } from '@prisma/client';
import { prisma, tenantTransaction } from '../../shared/database/prisma-client.js';

export async function mergeContacts(
  orgId: string,
  userId: string,
  primaryId: string,
  secondaryIds: string[],
): Promise<object> {
  return tenantTransaction(async (tx) => {
    // Fetch primary
    const primary = await tx.contact.findUnique({ where: { id: primaryId } });
    if (!primary) throw new Error(`Contact ${primaryId} not found in org`);
    if (primary.orgId !== orgId) throw new Error(`Contact ${primaryId} not found in org`);
    if (primary.mergedInto) throw new Error(`Contact ${primaryId} already merged`);

    // Fetch secondaries
    const secondaries = await tx.contact.findMany({ where: { id: { in: secondaryIds } } });
    for (const s of secondaries) {
      if (s.orgId !== orgId) throw new Error(`Contact ${s.id} not found in org`);
      if (s.mergedInto) throw new Error(`Contact ${s.id} already merged`);
    }

    // Build merged field values — nullable scalar fields
    type NullableStringField = 'phone' | 'email' | 'fullName' | 'avatarUrl' | 'source' | 'notes';
    const nullableFields: NullableStringField[] = ['phone', 'email', 'fullName', 'avatarUrl', 'source', 'notes'];

    const mergedScalars: Partial<Record<NullableStringField, string | null>> = {};
    for (const field of nullableFields) {
      mergedScalars[field] = primary[field] ?? secondaries.find((s) => s[field] != null)?.[field] ?? null;
    }

    // Union-merge tags
    const primaryTags: string[] = Array.isArray(primary.tags) ? (primary.tags as string[]) : [];
    const mergedTags = [...primaryTags];
    for (const s of secondaries) {
      const sTags: string[] = Array.isArray(s.tags) ? (s.tags as string[]) : [];
      for (const t of sTags) {
        if (!mergedTags.includes(t)) mergedTags.push(t);
      }
    }

    // Shallow-merge metadata — primary wins on key conflicts
    const primaryMeta = (primary.metadata && typeof primary.metadata === 'object' && !Array.isArray(primary.metadata))
      ? (primary.metadata as Record<string, unknown>)
      : {};
    const mergedMeta: Record<string, unknown> = {};
    for (const s of secondaries) {
      const sMeta = (s.metadata && typeof s.metadata === 'object' && !Array.isArray(s.metadata))
        ? (s.metadata as Record<string, unknown>)
        : {};
      Object.assign(mergedMeta, sMeta);
    }
    Object.assign(mergedMeta, primaryMeta); // primary wins

    // Reassign conversations and appointments
    await tx.conversation.updateMany({
      where: { contactId: { in: secondaryIds } },
      data: { contactId: primaryId },
    });
    await tx.appointment.updateMany({
      where: { contactId: { in: secondaryIds } },
      data: { contactId: primaryId },
    });

    // Transfer ALL Friend rows từ secondaries → primary. KHÔNG delete duplicate
    // vì 1 person có thể được chăm bởi cùng 1 sale nick qua NHIỀU Zalo identity
    // (sau merge nhiều Contact thành 1). Unique còn lại là (zaloAccountId, zaloUidInNick)
    // — Zalo identity thật.
    await tx.friend.updateMany({
      where: { contactId: { in: secondaryIds } },
      data: { contactId: primaryId },
    });

    // Update primary with merged data
    const updatedPrimary = await tx.contact.update({
      where: { id: primaryId },
      data: { ...mergedScalars, tags: mergedTags, metadata: mergedMeta as Prisma.InputJsonValue },
    });

    // Mark secondaries as merged
    await tx.contact.updateMany({
      where: { id: { in: secondaryIds } },
      data: { mergedInto: primaryId },
    });

    // Audit log
    await tx.activityLog.create({
      data: {
        orgId,
        userId,
        action: 'contact_merged',
        entityType: 'contact',
        entityId: primaryId,
        details: { secondaryIds },
      },
    });

    return updatedPrimary;
  });
}
