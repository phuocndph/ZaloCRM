// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomUUID } from 'node:crypto';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { withTenant } from '../../../shared/tenant/tenant-context.js';
import { logger } from '../../../shared/utils/logger.js';
import { ResearchError } from './research-domain.js';

type JobData = { orgId: string; projectId: string; taskId: string };
let connection: Redis | undefined;
let workerConnection: Redis | undefined;
let queue: Queue<JobData> | undefined;
let worker: Worker<JobData> | undefined;
function getQueue() {
  if (!connection) {
    connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null, enableReadyCheck: false });
    connection.on('error', () => logger.warn('[research] Redis connection error'));
  }
  if (!queue) {
    queue = new Queue<JobData>('customer-research', { connection: connection as ConnectionOptions });
    queue.on('error', () => logger.warn('[research] Queue error'));
  }
  return queue;
}
export async function enqueueResearchTask(orgId: string, projectId: string, taskId: string) {
  try {
    // DB task claim provides idempotency. Unique deliveries allow an explicit retry after a crash.
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        getQueue().add('research', { orgId, projectId, taskId }, { jobId: `${taskId}-${randomUUID()}`, attempts: 1, removeOnComplete: true, removeOnFail: { age: 86400, count: 100 } }),
        new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('Queue timeout')), 5000); }),
      ]);
    } finally { if (timeout) clearTimeout(timeout); }
  } catch {
    throw new ResearchError('Chưa đưa được công việc vào hàng đợi. Có thể gửi lại cùng mã chống lặp.', 503, 'RESEARCH_QUEUE_UNAVAILABLE');
  }
}
export function startResearchWorker() {
  if (worker) return;
  getQueue(); workerConnection = connection!.duplicate();
  worker = new Worker<JobData>('customer-research', (job) => withTenant(job.data.orgId, async () => {
    const { processResearchTask } = await import('./research-service.js');
    await processResearchTask(job.data);
  }), { connection: workerConnection as ConnectionOptions, concurrency: 2, lockDuration: 120000 });
  worker.on('error', () => logger.warn('[research] Worker error'));
  worker.on('failed', (job) => logger.warn(`[research] Task delivery failed id=${job?.data.taskId}`));
}
export async function stopResearchWorker() {
  if (worker) await worker.close(); worker = undefined;
  if (workerConnection) await workerConnection.quit(); workerConnection = undefined;
  if (queue) await queue.close(); queue = undefined;
  if (connection) await connection.quit(); connection = undefined;
}
