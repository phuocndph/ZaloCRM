// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
// ════════════════════════════════════════════════════════════════════════════
// Follow-up Workflow (🟢 Community) — BullMQ queue + worker.
//
// 1 job: 'advance' — chạy tiếp 1 enrollment (bước "Chờ" / hoãn khung giờ / min-gap
// đều là delayed job). Worker gọi advanceEnrollment() của engine.
//
// Redis dựng tại chỗ từ process.env.REDIS_URL (mirror outreach-queue.ts).
// ════════════════════════════════════════════════════════════════════════════

import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import type { Server } from 'socket.io';
import { logger } from '../../shared/utils/logger.js';

export const FOLLOWUP_QUEUE = 'followup';

interface AdvanceJob { kind: 'advance'; enrollmentId: string }

const DEFAULT_JOB_OPTIONS = {
  removeOnComplete: { age: 86400, count: 2000 },
  removeOnFail: { age: 604800 },
  attempts: 2,
  backoff: { type: 'exponential' as const, delay: 15_000 },
};

// io (không bắt buộc — engine gửi io:null; giữ để tương lai emit realtime).
let ioRef: Server | null = null;
export function setFollowupIO(io: Server) { ioRef = io; }
export function getFollowupIO(): Server | null { return ioRef; }

// ── Redis connection (BullMQ-tuned, lazy) ──
let connection: Redis | null = null;
function getConnection(): Redis {
  if (!connection) {
    const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
    connection = new Redis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: false,
      retryStrategy: (times: number) => Math.min(times * 200, 5000),
    });
    connection.on('error', (err: Error) => logger.error(`[followup-queue] redis error: ${err.message}`));
    logger.info('[followup-queue] redis connection created');
  }
  return connection;
}

let queueInstance: Queue<AdvanceJob> | null = null;
function getQueue(): Queue<AdvanceJob> {
  if (!queueInstance) {
    queueInstance = new Queue<AdvanceJob>(FOLLOWUP_QUEUE, {
      connection: getConnection() as ConnectionOptions,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    queueInstance.on('error', (err) => logger.error(`[followup-queue] queue error: ${err.message}`));
    logger.info('[followup-queue] queue initialized');
  }
  return queueInstance;
}

/** Đặt lịch chạy tiếp enrollment sau `delayMs`. Trả jobId (để huỷ khi dừng). */
export async function scheduleAdvance(enrollmentId: string, delayMs: number): Promise<string> {
  const jobId = `adv-${enrollmentId}-${Date.now()}`;
  await getQueue().add(
    'advance',
    { kind: 'advance', enrollmentId },
    { delay: Math.max(0, Math.floor(delayMs)), jobId },
  );
  return jobId;
}

/** Huỷ 1 job đã lên lịch (khi enrollment dừng/đổi hướng). */
export async function cancelScheduledJob(jobId: string): Promise<void> {
  try {
    const job = await getQueue().getJob(jobId);
    if (job) await job.remove();
  } catch (err) {
    logger.warn(`[followup-queue] cancel job ${jobId} lỗi: ${(err as Error)?.message ?? err}`);
  }
}

// ── Worker ────────────────────────────────────────────────────────────────
let workerInstance: Worker<AdvanceJob> | null = null;
let workerConnection: Redis | null = null;

export function startFollowupWorker(): Worker<AdvanceJob> {
  if (workerInstance) { logger.warn('[followup-worker] already started'); return workerInstance; }
  workerConnection = getConnection().duplicate();
  workerInstance = new Worker<AdvanceJob>(
    FOLLOWUP_QUEUE,
    async (job: Job<AdvanceJob>) => {
      if (job.data.kind !== 'advance') return;
      // Import động để tránh vòng import ở tầng module (engine ↔ queue).
      const { advanceEnrollment } = await import('./followup-engine.js');
      await advanceEnrollment(job.data.enrollmentId);
    },
    {
      connection: workerConnection as ConnectionOptions,
      concurrency: 3, // vài enrollment song song; mỗi enrollment tự tuần tự.
    },
  );
  workerInstance.on('failed', (job, err) => {
    logger.error(`[followup-worker] failed job=${job?.id} attempt=${job?.attemptsMade}: ${err.message}`);
  });
  workerInstance.on('error', (err) => logger.error(`[followup-worker] error: ${err.message}`));
  logger.info('[followup-worker] started');
  return workerInstance;
}

export async function stopFollowupWorker(): Promise<void> {
  if (workerInstance) { await workerInstance.close(); workerInstance = null; }
  if (workerConnection) { await workerConnection.quit(); workerConnection = null; }
  if (queueInstance) { await queueInstance.close(); queueInstance = null; }
  if (connection) { await connection.quit(); connection = null; }
}
