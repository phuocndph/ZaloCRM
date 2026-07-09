// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * minio-client.ts — DISPATCHER tầng storage (giữ tên file cũ để caller không đổi import).
 *
 * 2026-06-20: tách storage thành 2 driver, chọn bằng config.storageDriver:
 *   - 'local' (mặc định) → local-driver.ts  (ổ đĩa VPS, serve qua /files)
 *   - 'r2'              → r2-driver.ts     (Cloudflare R2 / S3-compatible, AWS SDK v3)
 *
 * File này CHỈ điều phối + giữ nguyên chữ ký export (uploadBuffer, getObjectBuffer,
 * getObjectStream, ensureBucket, keyFromPublicUrl, UploadResult) → 6 module import
 * không cần sửa gì. Đổi nơi lưu = đổi STORAGE_DRIVER trong .env, không sửa code.
 *
 * Lịch sử dedup (giữ nguyên): key theo sha256 BYTES THẬT (`media/{hash}{ext}`),
 * object đã tồn tại thì SKIP ghi → cùng bytes upload N lần = 1 object.
 */
import { config } from '../../config/index.js';
import { localDriver } from './local-driver.js';
import { r2Driver } from './r2-driver.js';
import type { StorageDriver } from './types.js';

export type { UploadResult } from './types.js';

const driver: StorageDriver = config.storageDriver === 'r2' ? r2Driver : localDriver;

export const uploadBuffer: StorageDriver['uploadBuffer'] = (buffer, mimeType, originalName) =>
  driver.uploadBuffer(buffer, mimeType, originalName);

export const getObjectStream: StorageDriver['getObjectStream'] = (key) => driver.getObjectStream(key);

export const getObjectBuffer: StorageDriver['getObjectBuffer'] = (key) => driver.getObjectBuffer(key);

export const ensureBucket: StorageDriver['ensureBucket'] = () => driver.ensureBucket();

/**
 * Trích object key (vd `media/{hash}.ext`) từ public URL. Trả '' nếu URL không
 * thuộc storage của mình (vd Zalo CDN dlfl.vn → bỏ qua, để caller giữ URL gốc).
 *
 * Nhận diện CẢ 3 format để tương thích ngược khi đổi driver / sau migrate:
 *   1. Path-style (MinIO cũ, hoặc R2 path-style): {host}/{bucket}/{key}
 *   2. Local driver:        {localPublicUrl}/{key}
 *   3. R2 public domain:    {s3PublicUrl}/{key}   (key ngay sau host, không có bucket)
 */
export function keyFromPublicUrl(url: string): string {
  if (!url) return '';

  // 1) Path-style: bắt theo marker /{bucket}/ — phủ mọi URL cũ thời MinIO.
  const marker = `/${config.s3Bucket}/`;
  const at = url.indexOf(marker);
  if (at >= 0) {
    try {
      return decodeURIComponent(url.slice(at + marker.length).split('?')[0]);
    } catch {
      return '';
    }
  }

  // 2) + 3) Bóc tiền tố public base của driver (local trước, R2 sau).
  for (const base of [config.localPublicUrl, config.s3PublicUrl]) {
    if (!base) continue;
    const prefix = base.endsWith('/') ? base : `${base}/`;
    if (url.startsWith(prefix)) {
      try {
        return decodeURIComponent(url.slice(prefix.length).split('?')[0]);
      } catch {
        return '';
      }
    }
  }

  // 4) LEGACY driver local: URL tuyệt đối `{scheme}://{host}/files/{key}` sinh trước khi
  // localPublicUrl chuyển sang tương đối `/files`. Bóc mọi origin để hàng DB cũ (chưa
  // backfill) vẫn phân giải ra key đúng.
  const legacy = url.match(/^https?:\/\/[^/]+(\/files\/.+)$/);
  const relative = legacy ? legacy[1] : url.startsWith('/files/') ? url : '';
  if (relative) {
    try {
      return decodeURIComponent(relative.slice('/files/'.length).split('?')[0]);
    } catch {
      return '';
    }
  }

  // Ngoài storage của mình → ''
  return '';
}
