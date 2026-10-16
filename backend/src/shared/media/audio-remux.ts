// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * audio-remux.ts — voice Zalo lưu dạng ADTS AAC thô (.aac) / AMR (.amr): HTML5 <audio>
 * phát rất kém (không có tổng thời lượng → hiện 0:00, nhiều trình duyệt từ chối phát).
 * Remux AAC without re-encoding; AMR must be transcoded to AAC in MP4 (.m4a).
 * Cache the browser copy beside the original without changing the source bytes.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import path from 'node:path';

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
  if (!REMUX_AUDIO_EXTS.has(path.extname(srcAbs).slice(1).toLowerCase())) return null;
  const cacheAbs = `${srcAbs}.browser.m4a`;
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
        '-map', '0:a:0', '-vn',
        ...(path.extname(srcAbs).toLowerCase() === '.amr' ? ['-c:a', 'aac', '-b:a', '64k'] : ['-c:a', 'copy']),
        '-movflags', '+faststart',
        '-f', 'mp4',
        tmpAbs,
      ], { timeout: 20_000 });
      await rename(tmpAbs, cacheAbs);
      return cacheAbs;
    } catch {
      return null;
    } finally {
      await rm(tmpAbs, { force: true }).catch(() => {});
      inflight.delete(cacheAbs);
    }
  })();

  inflight.set(cacheAbs, task);
  return task;
}
