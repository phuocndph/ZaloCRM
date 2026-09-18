// SPDX-License-Identifier: AGPL-3.0-or-later
/** Per-list round-robin assignment to responsible Zalo accounts. */
import { prisma } from '../../shared/database/prisma-client.js';
import { appendSystemMessage } from './list-system-messages.js';
import { logger } from '../../shared/utils/logger.js';
import { sendSystemNotificationToUser } from '../system-notifications/system-notify-service.js';
import { Prisma } from '@prisma/client';

const MAX_SERIALIZATION_RETRIES = 3;

function isSerializationConflict(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function assignListEntry(entryId: string): Promise<boolean> {
  const runAssignment = () => prisma.$transaction(async (tx) => {
    const entry = await tx.customerListEntry.findUnique({
      where: { id: entryId },
      select: {
        id: true,
        customerListId: true,
        contactId: true,
        hasZalo: true,
        assignedZaloAccountId: true,
        phoneLocal: true,
        nameRaw: true,
        systemMessages: true,
        customerList: {
          select: { name: true, orgId: true, archivedAt: true, leadNotifyEnabled: true, notifyIndividual: true },
        },
      },
    });
    if (!entry?.contactId || entry.hasZalo !== true || entry.customerList.archivedAt || !entry.customerList.leadNotifyEnabled) {
      return { status: 'disabled' as const };
    }
    // The FK is the source of truth. Audit messages can outlive an assignment
    // when an account is deleted (ON DELETE SET NULL), so they must not block
    // a valid reassignment.
    if (entry.assignedZaloAccountId) {
      return { status: 'already_assigned' as const };
    }

    const recipients = await tx.customerListZaloAssignment.findMany({
      where: {
        customerListId: entry.customerListId,
        enabled: true,
        zaloAccount: { orgId: entry.customerList.orgId, archivedAt: null },
      },
      include: {
        zaloAccount: { select: { id: true, displayName: true, ownerUserId: true, status: true } },
      },
      // Equal distribution is deliberate: weight is reserved for a future
      // weighted mode and must not silently skew the current round-robin.
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (!recipients.length) {
      const messages = Array.isArray(entry.systemMessages) ? entry.systemMessages : [];
      const lastMessage = messages[messages.length - 1];
      const failureAlreadyRecorded = !!lastMessage
        && typeof lastMessage === 'object'
        && !Array.isArray(lastMessage)
        && (lastMessage as { type?: unknown }).type === 'ASSIGN_FAILED';
      return { status: 'empty_pool' as const, recordFailure: !failureAlreadyRecorded };
    }

    const state = await tx.zaloAssignmentState.upsert({
      where: { customerListId: entry.customerListId },
      create: { orgId: entry.customerList.orgId, customerListId: entry.customerListId, counter: 0 },
      update: {},
    });
    // Prefer the account after the last one used. This keeps the rotation
    // stable when accounts are added or removed from the pool between leads.
    const lastIndex = state.lastAssignedZaloAccountId
      ? recipients.findIndex((item) => item.zaloAccountId === state.lastAssignedZaloAccountId)
      : -1;
    const recipient = recipients[(lastIndex >= 0 ? lastIndex + 1 : state.counter) % recipients.length];
    const contact = await tx.contact.findFirst({
      where: { id: entry.contactId, orgId: entry.customerList.orgId },
      select: { id: true },
    });
    if (!contact) return { status: 'owned' as const };

    await tx.customerListEntry.update({
      where: { id: entry.id },
      data: { assignedZaloAccountId: recipient.zaloAccountId },
    });
    await tx.zaloAssignmentState.update({
      where: { customerListId: entry.customerListId },
      data: {
        counter: { increment: 1 },
        lastAssignedZaloAccountId: recipient.zaloAccountId,
      },
    });

    return {
      status: 'assigned' as const,
      orgId: entry.customerList.orgId,
      zaloAccountId: recipient.zaloAccountId,
      zaloAccountName: recipient.zaloAccount.displayName || 'nick Zalo',
      ownerUserId: recipient.zaloAccount.ownerUserId,
      notify: entry.customerList.notifyIndividual,
      listName: entry.customerList.name,
      leadLabel: entry.nameRaw || entry.phoneLocal || 'Data mới',
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  let result: Awaited<ReturnType<typeof runAssignment>>;
  for (let attempt = 0; ; attempt++) {
    try {
      result = await runAssignment();
      break;
    } catch (err) {
      if (!isSerializationConflict(err) || attempt >= MAX_SERIALIZATION_RETRIES - 1) throw err;
      await sleep(25 * (attempt + 1));
    }
  }

  if (result.status === 'empty_pool') {
    if (!result.recordFailure) return false;
    await appendSystemMessage(entryId, {
      type: 'ASSIGN_FAILED',
      text: 'Chưa giao được: chưa chọn nick Zalo quản lý',
      payload: { reason: 'empty_pool' },
    });
    return false;
  }
  if (result.status !== 'assigned') return false;

  await appendSystemMessage(entryId, {
    type: 'ASSIGNED_TO_ZALO_ACCOUNT',
    text: `Đã gán cho ${result.zaloAccountName}`,
    payload: { zaloAccountId: result.zaloAccountId },
  });
  if (result.notify && result.ownerUserId) {
    void sendSystemNotificationToUser({
      orgId: result.orgId,
      targetUserId: result.ownerUserId,
      type: 'customer_list_lead_assigned',
      title: 'Có data mới cho nick Zalo',
      content: `${result.leadLabel} từ tệp ${result.listName} · ${result.zaloAccountName}`,
      priority: 'normal',
    }).catch((err) => logger.warn({ err, entryId }, '[list-auto-assign] notification failed'));
  }
  return true;
}

export async function assignPendingListEntries(listId: string): Promise<number> {
  const entries = await prisma.customerListEntry.findMany({
    where: { customerListId: listId, contactId: { not: null }, hasZalo: true, assignedZaloAccountId: null },
    select: { id: true },
    orderBy: { rowIndex: 'asc' },
  });
  let assigned = 0;
  for (const entry of entries) {
    try {
      if (await assignListEntry(entry.id)) assigned++;
    } catch (err) {
      logger.warn({ err, entryId: entry.id }, '[list-auto-assign] failed');
    }
  }
  return assigned;
}
