// SPDX-License-Identifier: AGPL-3.0-or-later
/** Remove abandoned streamed chat uploads after a crash or forced shutdown. */
import cron from 'node-cron';
import { readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { logger } from '../../shared/utils/logger.js';

const ROOT = path.join(tmpdir(), 'zalocrm-upload');
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

export async function runChatUploadTempGc(now = Date.now()): Promise<number> {
  const entries = await readdir(ROOT, { withFileTypes: true }).catch(() => []);
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const target = path.join(ROOT, entry.name);
    const info = await stat(target).catch(() => null);
    if (!info || now - info.mtimeMs < MAX_AGE_MS) continue;
    await rm(target, { recursive: true, force: true }).catch(() => {});
    removed += 1;
  }
  return removed;
}

export function startChatUploadTempGcCron(): void {
  cron.schedule('17 * * * *', async () => {
    try {
      const removed = await runChatUploadTempGc();
      if (removed) logger.info(`[chat-upload-temp-gc] removed=${removed}`);
    } catch (err) {
      logger.warn('[chat-upload-temp-gc] failed:', err);
    }
  });
}
