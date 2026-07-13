// SPDX-License-Identifier: AGPL-3.0-or-later
import { prisma } from '../database/prisma-client.js';
import { config } from '../../config/index.js';
import type { UploadResult } from './types.js';

export type StorageFileType = 'image' | 'video' | 'file' | 'audio';

export interface StorageReferenceInput {
  upload: UploadResult;
  orgId: string;
  referenceKey: string;
  source: 'chat_message' | 'media_asset' | 'system_notification' | 'reconciled';
  purpose: string;
  zaloAccountId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  mediaAssetId?: string | null;
  createdAt?: Date;
  storageDriver?: 'local' | 'r2';
}

export function fileTypeFromMime(mimeType: string): StorageFileType {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'file';
}

export async function recordStorageReference(input: StorageReferenceInput) {
  const storageDriver = input.storageDriver ?? config.storageDriver;
  const object = await prisma.storageObject.upsert({
    where: { storageDriver_objectKey: { storageDriver, objectKey: input.upload.key } },
    update: {
      publicUrl: input.upload.url,
      contentHash: input.upload.contentHash,
      mimeType: input.upload.mimeType,
      fileType: fileTypeFromMime(input.upload.mimeType),
      sizeBytes: BigInt(input.upload.size),
    },
    create: {
      storageDriver,
      objectKey: input.upload.key,
      publicUrl: input.upload.url,
      contentHash: input.upload.contentHash,
      mimeType: input.upload.mimeType,
      fileType: fileTypeFromMime(input.upload.mimeType),
      sizeBytes: BigInt(input.upload.size),
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    },
  });

  const reference = await prisma.storageObjectReference.upsert({
    where: { referenceKey: input.referenceKey },
    update: {
      objectId: object.id,
      source: input.source,
      purpose: input.purpose,
      zaloAccountId: input.zaloAccountId ?? null,
      conversationId: input.conversationId ?? null,
      messageId: input.messageId ?? null,
      mediaAssetId: input.mediaAssetId ?? null,
    },
    create: {
      objectId: object.id,
      orgId: input.orgId,
      referenceKey: input.referenceKey,
      source: input.source,
      purpose: input.purpose,
      zaloAccountId: input.zaloAccountId ?? null,
      conversationId: input.conversationId ?? null,
      messageId: input.messageId ?? null,
      mediaAssetId: input.mediaAssetId ?? null,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    },
  });

  return { object, reference };
}

export async function recordMessageStorageReferences(args: {
  orgId: string;
  zaloAccountId: string;
  conversationId: string;
  messageId: string;
  uploads: Array<{ upload: UploadResult; purpose: string; storageDriver?: 'local' | 'r2' }>;
  createdAt?: Date;
}) {
  const seen = new Set<string>();
  let index = 0;
  for (const entry of args.uploads) {
    const identity = `${entry.upload.key}:${entry.purpose}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    await recordStorageReference({
      upload: entry.upload,
      orgId: args.orgId,
      referenceKey: `message:${args.messageId}:${entry.purpose}:${index++}`,
      source: 'chat_message',
      purpose: entry.purpose,
      zaloAccountId: args.zaloAccountId,
      conversationId: args.conversationId,
      messageId: args.messageId,
      createdAt: args.createdAt,
      storageDriver: entry.storageDriver,
    });
  }
}

export function uploadResultFromBlob(blob: {
  minioKey: string; publicUrl: string; contentHash: string; mimeType: string; sizeBytes: number;
}): UploadResult {
  return {
    key: blob.minioKey,
    url: blob.publicUrl,
    contentHash: blob.contentHash,
    mimeType: blob.mimeType,
    size: blob.sizeBytes,
    deduped: true,
  };
}