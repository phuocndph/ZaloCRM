import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from '../../config/index.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { bridgeBus, type MessagePersistedEvent } from '../../shared/bridge-bus.js';
import { withTenant } from '../../shared/tenant/tenant-context.js';
import { logger } from '../../shared/utils/logger.js';
import {
  processConversationAnalysis,
  type ConversationAnalysisJobData,
} from './conversation-analysis-service.js';
import { backfillCustomerAutomations } from './customer-automation-orchestrator.js';

export const CONVERSATION_ANALYSIS_QUEUE = 'conversation-analysis';
const configuredDebounceMs = Number(process.env.AI_CONVERSATION_ANALYSIS_DEBOUNCE_MS);
export const CONVERSATION_ANALYSIS_DEBOUNCE_MS = Number.isFinite(configuredDebounceMs)
  ? Math.max(5_000, configuredDebounceMs)
  : 2 * 60 * 1000;

const DEFAULT_JOB_OPTIONS = {
  removeOnComplete: { age: 24 * 60 * 60, count: 5000 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 5000 },
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 30_000 },
};

let connection: Redis | null = null;
let queueInstance: Queue<ConversationAnalysisJobData> | null = null;
let workerConnection: Redis | null = null;
let workerInstance: Worker<ConversationAnalysisJobData> | null = null;
let persistedListener: ((event: MessagePersistedEvent) => void) | null = null;

function getConnection(): Redis {
  if (!connection) {
    connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: false,
      retryStrategy: (times: number) => Math.min(times * 200, 5000),
    });
    connection.on('error', (error: Error) => logger.error(`[conversation-analysis-queue] redis error: ${error.message}`));
  }
  return connection;
}

function getQueue() {
  if (!queueInstance) {
    queueInstance = new Queue<ConversationAnalysisJobData>(CONVERSATION_ANALYSIS_QUEUE, {
      connection: getConnection() as ConnectionOptions,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    queueInstance.on('error', (error) => logger.error(`[conversation-analysis-queue] queue error: ${error.message}`));
  }
  return queueInstance;
}

export async function enqueueConversationAnalysis(
  data: ConversationAnalysisJobData,
  options: { immediate?: boolean } = {},
) {
  if (config.nodeEnv === 'test') return { queued: false, reason: 'test_environment' };
  const delay = options.immediate ? 0 : CONVERSATION_ANALYSIS_DEBOUNCE_MS;
  const job = await getQueue().add('analyze', data, {
    delay,
    deduplication: {
      id: data.conversationId,
      ttl: CONVERSATION_ANALYSIS_DEBOUNCE_MS,
      extend: true,
      replace: true,
      keepLastIfActive: true,
    },
  });
  return { queued: true, jobId: job.id, delayMs: delay };
}

/**
 * Queue a bounded batch of conversations whose latest activity has not been
 * analyzed yet. This is deliberately incremental: enabling AI on an existing
 * organization must not enqueue thousands of expensive model calls at once.
 */
export async function backfillConversationAnalyses(options: { orgId?: string; batchSize?: number } = {}) {
  if (config.nodeEnv === 'test') return { scanned: 0, queued: 0 };
  const batchSize = Math.max(1, Math.min(200, Math.floor(options.batchSize ?? 50)));
  const conversations = await prisma.conversation.findMany({
    where: {
      ...(options.orgId ? { orgId: options.orgId } : {}),
      threadType: 'user',
      contactId: { not: null },
      deletedAt: null,
      isPrivate: false,
      zaloAccount: { archivedAt: null, privacyMode: { not: 'main' } },
      messages: { some: { isDeleted: false, senderType: 'contact' } },
    },
    orderBy: { lastMessageAt: { sort: 'desc', nulls: 'last' } },
    take: batchSize * 4,
    select: {
      id: true,
      orgId: true,
      messages: {
        where: { isDeleted: false },
        orderBy: [{ sentAt: 'desc' }, { createdAt: 'desc' }],
        take: 1,
        select: { id: true },
      },
      aiInsights: {
        where: { status: 'active' },
        orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
        take: 1,
        select: { sourceThroughMessageId: true },
      },
    },
  });

  let queued = 0;
  for (const conversation of conversations) {
    const latest = conversation.messages[0];
    if (!latest || conversation.aiInsights[0]?.sourceThroughMessageId === latest.id) continue;
    try {
      const result = await enqueueConversationAnalysis(
        { orgId: conversation.orgId, conversationId: conversation.id, messageId: latest.id },
      );
      if (result.queued) queued += 1;
    } catch (error) {
      logger.warn(`[conversation-analysis-backfill] enqueue failed conversation=${conversation.id}: ${(error as Error).message}`);
    }
    if (queued >= batchSize) break;
  }
  return { scanned: conversations.length, queued };
}

let backfillTimer: ReturnType<typeof setInterval> | null = null;

export function startConversationAnalysisBackfill() {
  if (backfillTimer || config.nodeEnv === 'test') return;
  const run = async () => {
    try {
      const result = await backfillConversationAnalyses({
        batchSize: Number(process.env.AI_CONVERSATION_ANALYSIS_BACKFILL_BATCH ?? 50),
      });
      if (result.queued > 0) logger.info(`[conversation-analysis-backfill] scanned=${result.scanned} queued=${result.queued}`);
      if ((process.env.AI_CUSTOMER_AUTOMATION_ENABLED ?? 'false').toLowerCase() === 'true') {
        const automation = await backfillCustomerAutomations({
          batchSize: Number(process.env.AI_CUSTOMER_AUTOMATION_BACKFILL_BATCH ?? 25),
        });
        if (automation.reconciled > 0) {
          logger.info(`[customer-automation-backfill] scanned=${automation.scanned} reconciled=${automation.reconciled}`);
        }
      }
    } catch (error) {
      logger.warn(`[conversation-analysis-backfill] cycle failed: ${(error as Error).message}`);
    }
  };
  void run();
  backfillTimer = setInterval(() => void run(), 10 * 60_000);
  logger.info('[conversation-analysis-backfill] started (every 10 minutes)');
}

export function stopConversationAnalysisBackfill() {
  if (backfillTimer) clearInterval(backfillTimer);
  backfillTimer = null;
}

export function startConversationAnalysisWorker() {
  if (workerInstance) return workerInstance;
  persistedListener = (event) => {
    void (async () => {
      const activity = await prisma.message.findFirst({
        where: { id: event.messageId, conversationId: event.conversationId, isDeleted: false },
        select: {
          id: true,
          conversation: { select: { id: true, orgId: true, threadType: true, contactId: true, isPrivate: true } },
        },
      }).catch(() => null);
      if (!activity?.conversation || activity.conversation.threadType !== 'user' || !activity.conversation.contactId) return;
      if (activity.conversation.isPrivate) return;
      await enqueueConversationAnalysis({
        orgId: activity.conversation.orgId,
        conversationId: activity.conversation.id,
        messageId: activity.id,
      });
    })().catch((error) => logger.warn(
      `[conversation-analysis] persisted event enqueue failed message=${event.messageId}: ${(error as Error).message}`,
    ));
  };
  bridgeBus.on('message.persisted', persistedListener);
  workerConnection = getConnection().duplicate();
  workerInstance = new Worker<ConversationAnalysisJobData>(
    CONVERSATION_ANALYSIS_QUEUE,
    async (job: Job<ConversationAnalysisJobData>) => {
      if (job.name !== 'analyze') return;
      return withTenant(
        job.data.orgId,
        () => processConversationAnalysis(job.data),
        { userId: 'system', role: 'system' },
      );
    },
    { connection: workerConnection as ConnectionOptions, concurrency: 2 },
  );
  workerInstance.on('failed', (job, error) => {
    logger.error(`[conversation-analysis-worker] failed job=${job?.id} attempt=${job?.attemptsMade}: ${error.message}`);
  });
  workerInstance.on('error', (error) => logger.error(`[conversation-analysis-worker] error: ${error.message}`));
  logger.info('[conversation-analysis-worker] started with customer automation reconciliation');
  return workerInstance;
}

export async function stopConversationAnalysisWorker() {
  if (persistedListener) bridgeBus.off('message.persisted', persistedListener);
  persistedListener = null;
  if (workerInstance) { await workerInstance.close(); workerInstance = null; }
  if (workerConnection) { await workerConnection.quit(); workerConnection = null; }
  if (queueInstance) { await queueInstance.close(); queueInstance = null; }
  if (connection) { await connection.quit(); connection = null; }
}
