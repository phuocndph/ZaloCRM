// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
// ════════════════════════════════════════════════════════════════════════
// E1 Quét group (🟢 Community) — Group-scan BullMQ queue + worker wiring.
// ════════════════════════════════════════════════════════════════════════
//
// Self-contained COMMUNITY queue. KHÔNG dùng _ee/automation/queues/queue-registry.ts
// hay _ee getBullMQRedis() — feature E1 phải đứng độc lập trong tier Community
// (CI scripts/check-no-ee-leak.sh fail nếu import _ee).
//
// Redis connection: dựng TẠI CHỖ từ cùng env `REDIS_URL` mà rate-limiter dùng
// (xem shared/redis-client.ts → `new Redis(process.env.REDIS_URL)`). Khác với
// general-cache client ở chỗ BullMQ v5 BẮT BUỘC maxRetriesPerRequest=null +
// enableReadyCheck=false cho worker. Lazy-init: chỉ tạo socket khi enqueue/worker
// đầu tiên chạy → import file không mở kết nối (an toàn cho test/typecheck).
//
// Nếu REDIS_URL không set → fallback 'redis://localhost:6379' (giống mọi BullMQ
// queue khác trong repo). Worker/queue sẽ retry kết nối; nếu không có Redis thì
// scan đơn giản không chạy (FE thấy state=queued mãi) — chấp nhận được cho dev.

import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { logger } from '../../shared/utils/logger.js';
import { processGroupScan } from './group-scan-worker.js';

export const GROUP_SCAN_QUEUE = 'group-scan';

// Job opts — mirror _ee DEFAULT_JOB_OPTIONS conventions nhưng self-contained:
//   - attempts 3 (1 + 2 retry), backoff exponential 10s (session-expire / burst
//     group_read → BullMQ retry tự reconnect qua exec wrapper).
//   - removeOnComplete: giữ 24h / 1000 job (LRU). removeOnFail: 7 ngày để audit.
const DEFAULT_JOB_OPTIONS = {
  removeOnComplete: { age: 86400, count: 1000 },
  removeOnFail: { age: 604800 },
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 10_000 },
};

export interface GroupScanJobData {
  scanId: string;
}

// ── Community Redis connection (BullMQ-tuned) ─────────────────────────────────
// Cùng nguồn cấu hình với rate-limiter: process.env.REDIS_URL.
let connection: Redis | null = null;
function getConnection(): Redis {
  if (!connection) {
    const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
    connection = new Redis(url, {
      maxRetriesPerRequest: null, // BullMQ v5 requirement
      enableReadyCheck: false,    // BullMQ workers recommendation
      lazyConnect: false,
      retryStrategy: (times: number) => Math.min(times * 200, 5000),
    });
    connection.on('error', (err: Error) => {
      logger.error(`[group-scan-queue] redis error: ${err.message}`);
    });
    logger.info('[group-scan-queue] redis connection created');
  }
  return connection;
}

// ── Queue singleton ───────────────────────────────────────────────────────────
let queueInstance: Queue<GroupScanJobData> | null = null;
function getQueue(): Queue<GroupScanJobData> {
  if (!queueInstance) {
    queueInstance = new Queue<GroupScanJobData>(GROUP_SCAN_QUEUE, {
      connection: getConnection() as ConnectionOptions,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    queueInstance.on('error', (err) => {
      logger.error(`[group-scan-queue] queue error: ${err.message}`);
    });
    logger.info('[group-scan-queue] queue initialized');
  }
  return queueInstance;
}

/**
 * Enqueue 1 scan job. jobId = `gs-${scanId}` (deterministic) → re-enqueue cùng
 * scan không tạo job trùng (BullMQ dedup). resume/crash dùng lại cùng scanId.
 */
export async function enqueueGroupScan(scanId: string): Promise<void> {
  const queue = getQueue();
  await queue.add('scan-groups', { scanId }, { jobId: `gs-${scanId}` });
  logger.info(`[group-scan-queue] enqueued scanId=${scanId}`);
}

// ── Worker lifecycle ──────────────────────────────────────────────────────────
let workerInstance: Worker<GroupScanJobData> | null = null;
let workerConnection: Redis | null = null;

/** Wire the BullMQ Worker → processor. Gọi 1 lần lúc app start. */
export function startGroupScanWorker(): Worker<GroupScanJobData> {
  if (workerInstance) {
    logger.warn('[group-scan-worker] already started');
    return workerInstance;
  }
  // Worker dùng connection RIÊNG (review #6): BullMQ worker chạy blocking command
  // (BRPOPLPUSH) độc chiếm socket — chia sẻ với Queue producer là anti-pattern, dễ
  // stall queue.add() dưới tải. duplicate() = cùng REDIS_URL, socket riêng.
  workerConnection = getConnection().duplicate();
  workerInstance = new Worker<GroupScanJobData>(
    GROUP_SCAN_QUEUE,
    (job: Job<GroupScanJobData>) => processGroupScan(job.data.scanId),
    {
      connection: workerConnection as ConnectionOptions,
      // Concurrency 1: 1 nick quét tuần tự — group_read đã rate-limited per-nick,
      // chạy song song nhiều job cùng nick = burst → Zalo anti-spam.
      concurrency: 1,
    },
  );
  workerInstance.on('completed', (job) => {
    logger.info(`[group-scan-worker] completed scanId=${job.data.scanId}`);
  });
  workerInstance.on('failed', (job, err) => {
    logger.error(
      `[group-scan-worker] failed scanId=${job?.data.scanId} attempt=${job?.attemptsMade}/${job?.opts.attempts}: ${err.message}`,
    );
  });
  workerInstance.on('error', (err) => {
    logger.error(`[group-scan-worker] error: ${err.message}`);
  });
  logger.info('[group-scan-worker] started');
  return workerInstance;
}

export async function stopGroupScanWorker(): Promise<void> {
  if (workerInstance) {
    await workerInstance.close();
    workerInstance = null;
  }
  if (workerConnection) {
    await workerConnection.quit();
    workerConnection = null;
  }
  if (queueInstance) {
    await queueInstance.close();
    queueInstance = null;
  }
  if (connection) {
    await connection.quit();
    connection = null;
  }
}
