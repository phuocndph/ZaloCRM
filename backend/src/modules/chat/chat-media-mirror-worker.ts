// SPDX-License-Identifier: AGPL-3.0-or-later
/** Durable retry worker for inbound Zalo media mirrors. */
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { MIRROR_CONTENT_TYPES, processPersistedMessageMediaMirror } from './message-handler.js';

const BATCH_SIZE = 25;
const CONCURRENCY = 4;
const TICK_MS = 60_000;
const LOCK_MS = 10 * 60_000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export async function runChatMediaMirrorBatch(limit = BATCH_SIZE): Promise<{ scanned: number; completed: number }> {
  if (running) return { scanned: 0, completed: 0 };
  running = true;
  try {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - LOCK_MS);
    await prisma.message.updateMany({
      where: {
        contentType: { in: [...MIRROR_CONTENT_TYPES] },
        mediaMirrorState: 'processing',
        mediaMirrorLockedAt: { lt: staleBefore },
      },
      data: {
        mediaMirrorState: 'retrying',
        mediaMirrorNextAttemptAt: now,
        mediaMirrorLockedAt: null,
        mediaMirrorLastError: 'Recovered after an interrupted media mirror attempt.',
      },
    });

    const candidates = await prisma.message.findMany({
      where: {
        contentType: { in: [...MIRROR_CONTENT_TYPES] },
        AND: [
          { OR: [{ mediaMirrorState: null }, { mediaMirrorState: { in: ['pending', 'retrying', 'missing'] } }] },
          { OR: [{ mediaMirrorNextAttemptAt: null }, { mediaMirrorNextAttemptAt: { lte: now } }] },
        ],
      },
      // New media has the highest chance of still being available on Zalo CDN.
      // Process it before old backfill rows whose links may already be expired.
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
      take: Math.min(100, Math.max(1, limit)),
      select: { id: true },
    });

    let completed = 0;
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < candidates.length) {
        const candidate = candidates[nextIndex++];
        if (await processPersistedMessageMediaMirror(candidate.id)) completed += 1;
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, candidates.length) }, worker));
    if (candidates.length > 0) {
      logger.info(`[chat-media-mirror] scanned=${candidates.length} completed=${completed}`);
    }
    return { scanned: candidates.length, completed };
  } finally {
    running = false;
  }
}

export function startChatMediaMirrorWorker(): void {
  if (timer) return;
  void runChatMediaMirrorBatch().catch((err) => logger.warn('[chat-media-mirror] initial batch failed:', err));
  timer = setInterval(() => {
    void runChatMediaMirrorBatch().catch((err) => logger.warn('[chat-media-mirror] batch failed:', err));
  }, TICK_MS);
  timer.unref?.();
  logger.info('[chat-media-mirror] durable retry worker started (every 60s)');
}

export function stopChatMediaMirrorWorker(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
