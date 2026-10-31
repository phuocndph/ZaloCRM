// SPDX-License-Identifier: AGPL-3.0-or-later
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { prisma } from '../../../shared/database/prisma-client.js';
import { runSystemQuery, withTenant } from '../../../shared/tenant/tenant-context.js';
import { logger } from '../../../shared/utils/logger.js';
import { ResearchError } from './research-domain.js';

type JobData = { orgId: string; projectId: string; taskId: string };
let connection: Redis | undefined;
let workerConnection: Redis | undefined;
let queue: Queue<JobData> | undefined;
let worker: Worker<JobData> | undefined;
let recoveryTimer: ReturnType<typeof setInterval> | undefined;
let recovering = false;
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
    // Stable delivery IDs deduplicate recovery across app instances; the DB lease
    // fences execution. Terminal queue deliveries are removed so an explicit retry can run.
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        getQueue().add('research', { orgId, projectId, taskId }, { jobId: `research-${taskId}`, attempts: 1, removeOnComplete: true, removeOnFail: true }),
        new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('Queue timeout')), 5000); }),
      ]);
    } finally { if (timeout) clearTimeout(timeout); }
  } catch {
    throw new ResearchError('Chưa đưa được công việc vào hàng đợi. Có thể gửi lại cùng mã chống lặp.', 503, 'RESEARCH_QUEUE_UNAVAILABLE');
  }
}
export async function recoverResearchTasks() {
  if (recovering) return;
  recovering = true;
  try {
    // Cross-org scheduling reads identifiers only. Every actual job executes in
    // its own tenant scope and rechecks the creator, task token and cancellation.
    const tasks = await runSystemQuery(() => prisma.customerResearchTask.findMany({
      where: {
        cancelRequested: false, project: { executor: 'internal' },
        OR: [
          { status: 'queued', createdAt: { lt: new Date(Date.now() - 10_000) } },
          { status: 'running', OR: [{ leaseUntil: { lt: new Date() } }, { leaseUntil: null }] },
        ],
      },
      select: { id: true, orgId: true, projectId: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 100,
    }));
    for (const task of tasks) await enqueueResearchTask(task.orgId, task.projectId, task.id);
  } catch { logger.warn('[research] Recovery will resume on the next check'); }
  finally { recovering = false; }
}

export function startResearchWorker() {
  if (worker) return;
  getQueue(); workerConnection = connection!.duplicate();
  worker = new Worker<JobData>('customer-research', (job) => withTenant(job.data.orgId, async () => {
    const { processResearchTask } = await import('./research-service.js');
    await processResearchTask(job.data);
  }), { connection: workerConnection as ConnectionOptions, concurrency: 2, lockDuration: 120000 });
  void recoverResearchTasks();
  recoveryTimer = setInterval(() => { void recoverResearchTasks(); }, 30_000);
  recoveryTimer.unref();
  worker.on('error', () => logger.warn('[research] Worker error'));
  worker.on('failed', (job) => logger.warn(`[research] Task delivery failed id=${job?.data.taskId}`));
}
export async function stopResearchWorker() {
  if (recoveryTimer) clearInterval(recoveryTimer); recoveryTimer = undefined;
  if (worker) await worker.close(); worker = undefined;
  if (workerConnection) await workerConnection.quit(); workerConnection = undefined;
  if (queue) await queue.close(); queue = undefined;
  if (connection) await connection.quit(); connection = undefined;
}
