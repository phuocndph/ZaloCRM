// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * r2-driver.ts — lưu file lên Cloudflare R2 (hoặc bất kỳ S3-compatible) qua AWS SDK v3.
 *
 * R2 lưu ý:
 *   - region phải là 'auto'
 *   - endpoint = https://<account>.r2.cloudflarestorage.com
 *   - forcePathStyle: true (endpoint dạng path-style {endpoint}/{bucket}/{key})
 *   - publicUrl KHÔNG kèm tên bucket: domain công khai R2 (r2.dev / custom domain)
 *     trỏ THẲNG vào bucket root → key đứng ngay sau host.
 *
 * Dedup giống tầng cũ: HeadObject → tồn tại thì skip PutObject (deduped=true).
 */
import { createHash } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { extname } from 'node:path';
import { Readable } from 'node:stream';
import { config } from '../../config/index.js';
import { isSafeObjectKey, mimeToExt, type StorageDriver, type UploadResult } from './types.js';

const BUCKET = config.s3Bucket;

const client = new S3Client({
  region: config.s3Region, // R2: 'auto'
  endpoint: config.s3Endpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId: config.s3AccessKey,
    secretAccessKey: config.s3SecretKey,
  },
});

async function objectExists(key: string): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

export const r2Driver: StorageDriver = {
  publicUrl(key: string): string {
    // KHÔNG có /{bucket}/ — domain công khai R2 đã map vào bucket root.
    return `${config.s3PublicUrl}/${key}`;
  },

  async uploadBuffer(buffer: Buffer, mimeType: string, originalName?: string): Promise<UploadResult> {
    if (!buffer || buffer.length === 0) throw new Error('uploadBuffer: empty buffer (refusing 0-byte object)');
    const ext = originalName ? extname(originalName) : mimeToExt(mimeType);
    const contentHash = createHash('sha256').update(buffer).digest('hex');
    const key = `media/${contentHash}${ext}`;
    const url = this.publicUrl(key);

    if (await objectExists(key)) {
      return { key, url, size: buffer.length, mimeType, contentHash, deduped: true };
    }

    await client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        ContentLength: buffer.length,
        CacheControl: 'private, no-store, max-age=0',
      }),
    );
    return { key, url, size: buffer.length, mimeType, contentHash, deduped: false };
  },

  async getObjectStream(key: string): Promise<NodeJS.ReadableStream | null> {
    if (!isSafeObjectKey(key)) return null;
    try {
      const res = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
      const body = res.Body;
      if (!body) return null;
      // SDK v3 trả Body là Readable trong Node.
      return body as Readable;
    } catch {
      return null;
    }
  },

  async getObjectBuffer(key: string): Promise<Buffer | null> {
    if (!isSafeObjectKey(key)) return null;
    try {
      const res = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
      if (!res.Body) return null;
      const bytes = await res.Body.transformToByteArray();
      return Buffer.from(bytes);
    } catch {
      return null;
    }
  },

  async statObject(key: string) {
    if (!isSafeObjectKey(key)) return null;
    try {
      const res = await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
      return {
        size: Number(res.ContentLength || 0),
        mimeType: res.ContentType || 'application/octet-stream',
      };
    } catch {
      return null;
    }
  },

  async deleteObject(key: string): Promise<boolean> {
    if (!isSafeObjectKey(key)) return false;
    try {
      await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
      return true;
    } catch {
      return false;
    }
  },

  async ensureBucket(): Promise<void> {
    // R2: bucket tạo qua dashboard. Chỉ KIỂM TRA truy cập được, KHÔNG tự tạo
    // (CreateBucket với region 'auto' dễ lỗi). Không throw để boot không chết.
    try {
      await client.send(new HeadBucketCommand({ Bucket: BUCKET }));
    } catch (err) {
      console.warn(
        `[storage:r2] Không truy cập được bucket "${BUCKET}" tại ${config.s3Endpoint}. ` +
          `Kiểm tra S3_ACCESS_KEY/S3_SECRET_KEY/S3_BUCKET. Chi tiết: ${(err as Error).message}`,
      );
    }
  },
};
