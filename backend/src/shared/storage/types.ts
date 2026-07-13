// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * types.ts — hợp đồng chung cho tầng storage (driver-agnostic).
 *
 * 2026-06-20: tách storage thành 2 driver (local đĩa VPS / R2 qua AWS SDK v3),
 * chọn bằng config.storageDriver. Mọi driver implement StorageDriver; file
 * dispatcher (minio-client.ts) giữ nguyên chữ ký export để caller không đổi.
 */

export interface UploadResult {
  key: string;
  url: string;
  size: number;
  mimeType: string;
  /** sha256 (hex) của bytes thật lưu — khóa dedup ở tầng service. */
  contentHash: string;
  /** true nếu object đã tồn tại (đã skip ghi — không tốn thêm ô lưu trữ). */
  deduped: boolean;
}

export interface StorageObjectMetadata {
  size: number;
  mimeType: string;
}

export interface StorageDriver {
  /** Upload buffer (content-hash dedup). Key = `media/{sha256}{ext}`. */
  uploadBuffer(buffer: Buffer, mimeType: string, originalName?: string): Promise<UploadResult>;
  /** Lấy object dưới dạng stream. Trả null nếu key không an toàn / không tồn tại. */
  getObjectStream(key: string): Promise<NodeJS.ReadableStream | null>;
  /** Đọc toàn bộ object thành Buffer. Trả null nếu key sai / không tồn tại. */
  getObjectBuffer(key: string): Promise<Buffer | null>;
  /** Xoá object khỏi storage. Trả true nếu đã xoá hoặc object không còn tồn tại. */
  statObject(key: string): Promise<StorageObjectMetadata | null>;
  deleteObject(key: string): Promise<boolean>;
  /** Đảm bảo nơi lưu sẵn sàng (mkdir cho local, kiểm tra bucket cho R2). */
  ensureBucket(): Promise<void>;
  /** Public URL để gửi cho Zalo CDN / trình duyệt tải. */
  publicUrl(key: string): string;
}

/** Map MIME → đuôi file (khi không có originalName). */
export function mimeToExt(mime: string): string {
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/png') return '.png';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/gif') return '.gif';
  if (mime === 'video/mp4') return '.mp4';
  if (mime === 'video/quicktime') return '.mov';
  if (mime === 'video/webm') return '.webm';
  return '';
}

/**
 * Key an toàn để proxy-download — chấp nhận MỌI object thuộc storage của mình
 * (cả `media/{hash}.ext` LẪN `YYYY-MM-DD/{uuid}.ext` cũ). Chỉ chặn rỗng /
 * path-traversal (`..`) / key tuyệt đối (`/` đầu) / null byte.
 */
export function isSafeObjectKey(key: string): boolean {
  return !!key && !key.startsWith('/') && !key.includes('..') && !key.includes('\0');
}
