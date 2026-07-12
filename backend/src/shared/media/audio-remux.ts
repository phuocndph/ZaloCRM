// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * audio-remux.ts — voice Zalo lưu dạng ADTS AAC thô (.aac) / AMR (.amr): HTML5 <audio>
 * phát rất kém (không có tổng thời lượng → hiện 0:00, nhiều trình duyệt từ chối phát).
 * Remux (KHÔNG mã hoá lại, `-c copy`) sang container MP4 (.m4a) để mọi trình duyệt phát
 * được kèm duration. Kết quả cache ra đĩa cạnh file gốc nên chỉ tốn ffmpeg lần đầu.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { rename } from 'node:fs/promises';

const execFileAsync = promisify(execFile);

/** Các đuôi audio thô cần remux để trình duyệt phát tốt. */
export const REMUX_AUDIO_EXTS = new Set(['aac', 'amr']);

// Chống remux song song cùng 1 file (nhiều request tới cùng lúc).
const inflight = new Map<string, Promise<string | null>>();

/**
 * Đảm bảo có bản .m4a phát được cho `srcAbs` (đường dẫn tuyệt đối tới .aac/.amr).
 * Trả về đường dẫn .m4a đã cache, hoặc null nếu nguồn không tồn tại / remux lỗi.
 */
export async function ensureBrowserAudio(srcAbs: string): Promise<string | null> {
  const cacheAbs = srcAbs.replace(/\.(aac|amr)$/i, '.m4a');
  if (existsSync(cacheAbs)) return cacheAbs;
  if (!existsSync(srcAbs)) return null;

  const existing = inflight.get(cacheAbs);
  if (existing) return existing;

  const task = (async () => {
    // Ghi ra file tạm rồi rename (atomic) — tránh phục vụ file .m4a dở dang.
    const tmpAbs = `${cacheAbs}.tmp-${process.pid}`;
    try {
      await execFileAsync('ffmpeg', [
        '-v', 'error', '-y',
        '-i', srcAbs,
        '-c', 'copy',
        '-movflags', '+faststart',
        '-f', 'mp4',
        tmpAbs,
      ], { timeout: 20_000 });
      await rename(tmpAbs, cacheAbs);
      return cacheAbs;
    } catch {
      return null;
    } finally {
      inflight.delete(cacheAbs);
    }
  })();

  inflight.set(cacheAbs, task);
  return task;
}
