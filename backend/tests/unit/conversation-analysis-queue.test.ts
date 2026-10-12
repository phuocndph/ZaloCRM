import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  add: vi.fn(),
  getDeduplicationJobId: vi.fn(),
  getJob: vi.fn(),
}));

vi.mock('../../src/config/index.js', () => ({ config: { nodeEnv: 'production' } }));
vi.mock('../../src/shared/database/prisma-client.js', () => ({
  prisma: { conversation: { findMany: mocks.findMany } },
}));
vi.mock('../../src/shared/bridge-bus.js', () => ({ bridgeBus: { on: vi.fn(), off: vi.fn() } }));
vi.mock('../../src/shared/tenant/tenant-context.js', () => ({ withTenant: vi.fn() }));
vi.mock('../../src/shared/utils/logger.js', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('../../src/modules/ai/conversation-analysis-service.js', () => ({ processConversationAnalysis: vi.fn() }));
vi.mock('../../src/modules/ai/customer-automation-orchestrator.js', () => ({ backfillCustomerAutomations: vi.fn() }));
vi.mock('ioredis', () => ({
  Redis: class RedisMock {
    on() {}
    duplicate() { return this; }
    async quit() {}
  },
}));
vi.mock('bullmq', () => ({
  Queue: class QueueMock {
    on() {}
    add = mocks.add;
    getDeduplicationJobId = mocks.getDeduplicationJobId;
    getJob = mocks.getJob;
    async close() {}
  },
  Worker: class WorkerMock {
    on() {}
    async close() {}
  },
}));

import {
  backfillConversationAnalyses,
  getConversationAnalysisQueueState,
  resolveConversationAnalysisWorkerSettings,
} from '../../src/modules/ai/conversation-analysis-queue.js';
import { COUNTERPARTY_CLASSIFIER_VERSION } from '../../src/modules/ai/counterparty-role.js';

function fresh(id: string) {
  return {
    id,
    orgId: 'org-1',
    messages: [{ id: `message-${id}` }],
    aiInsights: [{
      sourceThroughMessageId: `message-${id}`,
      signals: { counterpartyClassifierVersion: COUNTERPARTY_CLASSIFIER_VERSION },
    }],
  };
}

describe('conversation analysis backfill', () => {
  it('bounds configurable parallelism and worker start rate', () => {
    expect(resolveConversationAnalysisWorkerSettings({
      AI_CONVERSATION_ANALYSIS_CONCURRENCY: '4',
      AI_CONVERSATION_ANALYSIS_STARTS_PER_MINUTE: '30',
    })).toEqual({ concurrency: 4, startsPerMinute: 30 });
    expect(resolveConversationAnalysisWorkerSettings({
      AI_CONVERSATION_ANALYSIS_CONCURRENCY: '99',
      AI_CONVERSATION_ANALYSIS_STARTS_PER_MINUTE: '0',
    })).toEqual({ concurrency: 8, startsPerMinute: 1 });
  });
  it('reads only the pending job matching the organization and newest message', async () => {
    mocks.getDeduplicationJobId.mockResolvedValue('job-1');
    mocks.getJob.mockResolvedValue({ data: { orgId: 'org-1', conversationId: 'conv', messageId: 'new' }, getState: vi.fn().mockResolvedValue('delayed') });
    expect(await getConversationAnalysisQueueState('org-1', 'conv', 'new')).toBe('delayed');
    expect(await getConversationAnalysisQueueState('org-2', 'conv', 'new')).toBeNull();
    expect(await getConversationAnalysisQueueState('org-1', 'conv', 'old')).toBeNull();
  });

  it('does not present a completed job as queued', async () => {
    mocks.getDeduplicationJobId.mockResolvedValue('job-1');
    mocks.getJob.mockResolvedValue({ data: { orgId: 'org-1', conversationId: 'conv', messageId: 'new' }, getState: vi.fn().mockResolvedValue('completed') });
    expect(await getConversationAnalysisQueueState('org-1', 'conv', 'new')).toBeNull();
  });

  it('keeps the read endpoint available if Redis is unavailable', async () => {
    mocks.getDeduplicationJobId.mockRejectedValueOnce(new Error('Redis unavailable'));
    expect(await getConversationAnalysisQueueState('org-1', 'conv', 'new')).toBeNull();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.add.mockResolvedValue({ id: 'job-1' });
  });

  it('continues past 200 fresh rows to find an older stale conversation', async () => {
    mocks.findMany
      .mockResolvedValueOnce(Array.from({ length: 200 }, (_, index) => fresh(String(index).padStart(3, '0'))))
      .mockResolvedValueOnce([{
        id: 'stale-201',
        orgId: 'org-1',
        messages: [{ id: 'message-stale' }],
        aiInsights: [],
      }]);

    await expect(backfillConversationAnalyses({ batchSize: 1 })).resolves.toEqual({ scanned: 201, queued: 1 });
    expect(mocks.findMany).toHaveBeenCalledTimes(2);
    expect(mocks.add).toHaveBeenCalledWith(
      'analyze',
      expect.objectContaining({ conversationId: 'stale-201', messageId: 'message-stale', force: true }),
      expect.any(Object),
    );
  });

  it('reanalyzes an insight produced by an older counterparty classifier', async () => {
    mocks.findMany.mockResolvedValueOnce([{
      id: 'stale-classifier',
      orgId: 'org-1',
      messages: [{ id: 'message-current' }],
      aiInsights: [{
        sourceThroughMessageId: 'message-current',
        signals: { counterpartyClassifierVersion: COUNTERPARTY_CLASSIFIER_VERSION - 1 },
      }],
    }]);

    await expect(backfillConversationAnalyses({ batchSize: 1 })).resolves.toEqual({ scanned: 1, queued: 1 });
    expect(mocks.add).toHaveBeenCalledWith(
      'analyze',
      expect.objectContaining({ conversationId: 'stale-classifier', messageId: 'message-current', force: true }),
      expect.any(Object),
    );
  });
});
