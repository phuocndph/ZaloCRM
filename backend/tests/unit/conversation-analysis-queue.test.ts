import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  add: vi.fn(),
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
    async close() {}
  },
  Worker: class WorkerMock {
    on() {}
    async close() {}
  },
}));

import { backfillConversationAnalyses } from '../../src/modules/ai/conversation-analysis-queue.js';
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
