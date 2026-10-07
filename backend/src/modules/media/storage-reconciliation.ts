// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto';
import { prisma } from '../../shared/database/prisma-client.js';
import { config } from '../../config/index.js';
import { keyFromPublicUrl, publicUrlFrom, statObjectFrom } from '../../shared/storage/minio-client.js';
import { recordStorageReference } from '../../shared/storage/storage-ledger.js';

const MEDIA_TYPES = ['image', 'video', 'file', 'gif', 'voice', 'audio'];
const URL_PATTERN = /https?:\/\/[^\s"'\\]+|\/files\/[^\s"'\\]+/g;

export function extractStorageKeys(content: string): string[] {
  const values = new Set<string>();
  const visit = (value: unknown) => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if ((trimmed.startsWith('{') || trimmed.startsWith('['))) {
        try { visit(JSON.parse(trimmed)); } catch { /* plain string */ }
      }
      for (const match of value.match(URL_PATTERN) || []) {
        const key = keyFromPublicUrl(match.replace(/[),.;]+$/, ''));
        if (key) values.add(key);
      }
      const directKey = keyFromPublicUrl(trimmed);
      if (directKey) values.add(directKey);
      return;
    }
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (value && typeof value === 'object') Object.values(value as Record<string, unknown>).forEach(visit);
  };
  visit(content);
  return [...values].sort();
}

/**
 * Reconcile one chat message without treating a single existing reference as
 * proof that every media URL in the message is tracked. Older messages can
 * contain multiple images where only the first upload was recorded.
 */
export async function reconcileMessageStorage(args: {
  orgId: string;
  messageId: string;
  content: string;
  contentType: string;
  sentAt: Date;
  conversationId: string;
  zaloAccountId: string;
}) {
  const keys = extractStorageKeys(args.content);
  if (keys.length === 0) return { references: 0, missing: 0 };

  const tracked = await prisma.storageObjectReference.findMany({
    where: { orgId: args.orgId, messageId: args.messageId, source: 'chat_message' },
    select: { object: { select: { storageDriver: true, objectKey: true } } },
  });
  const trackedKeys = new Set(tracked.map((row) => `${row.object.storageDriver}:${row.object.objectKey}`));
  let references = 0;
  let missing = 0;

  for (const key of keys) {
    // Prefer the driver already recorded for legacy objects. Otherwise use the
    // currently configured driver for newly mirrored content.
    const known = await prisma.storageObject.findFirst({
      where: { objectKey: key },
      select: { storageDriver: true },
      orderBy: { createdAt: 'asc' },
    });
    const storageDriver = known?.storageDriver === 'r2' ? 'r2' : known?.storageDriver === 'local' ? 'local' : config.storageDriver;
    if (trackedKeys.has(`${storageDriver}:${key}`)) continue;

    const metadata = await statObjectFrom(storageDriver, key);
    if (!metadata) {
      missing += 1;
      continue;
    }
    const match = key.match(/([a-f0-9]{64})(?:\.[^/]*)?$/i);
    const contentHash = match?.[1]?.toLowerCase() || createHash('sha256').update(key).digest('hex');
    const mimeType = metadata.mimeType && metadata.mimeType !== 'application/octet-stream'
      ? metadata.mimeType : fallbackMime(args.contentType, key);
    await recordStorageReference({
      upload: {
        key, url: publicUrlFrom(storageDriver, key), size: metadata.size,
        mimeType, contentHash, deduped: true,
      },
      orgId: args.orgId,
      referenceKey: `message:${args.messageId}:reconciled:${createHash('sha256').update(`${storageDriver}:${key}`).digest('hex').slice(0, 32)}`,
      source: 'chat_message',
      purpose: 'reconciled',
      zaloAccountId: args.zaloAccountId,
      conversationId: args.conversationId,
      messageId: args.messageId,
      createdAt: args.sentAt,
      storageDriver,
    });
    references += 1;
  }

  return { references, missing };
}

function fallbackMime(contentType: string, key: string) {
  const lower = key.toLowerCase();
  if (contentType === 'image' || contentType === 'gif') {
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.gif')) return 'image/gif';
    return 'image/jpeg';
  }
  if (contentType === 'video') return 'video/mp4';
  if (contentType === 'voice' || contentType === 'audio') return 'audio/mpeg';
  return 'application/octet-stream';
}

export async function reconcileChatStorage(args: { orgId: string; cursor?: string; batch?: number }) {
  const batch = Math.min(200, Math.max(10, args.batch || 100));
  const messages = await prisma.message.findMany({
    where: { conversation: { orgId: args.orgId }, contentType: { in: MEDIA_TYPES } },
    ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
    orderBy: { id: 'asc' },
    take: batch,
    select: {
      id: true, content: true, contentType: true, sentAt: true, conversationId: true,
      conversation: { select: { zaloAccountId: true } },
    },
  });

  let references = 0;
  let missing = 0;
  let skipped = 0;
  for (const message of messages) {
    const result = await reconcileMessageStorage({
      orgId: args.orgId,
      messageId: message.id,
      content: message.content || '',
      contentType: message.contentType,
      sentAt: message.sentAt,
      conversationId: message.conversationId,
      zaloAccountId: message.conversation.zaloAccountId,
    });
    references += result.references;
    missing += result.missing;
    if (result.references === 0 && result.missing === 0) skipped += 1;
  }

  return {
    scanned: messages.length,
    references,
    missing,
    skipped,
    nextCursor: messages.at(-1)?.id || null,
    hasMore: messages.length === batch,
  };
}
